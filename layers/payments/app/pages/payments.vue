<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'
import type { TableColumn } from '@nuxt/ui'
import { encodeQR } from 'qr'
import type { PaymentCreateResponse, PaymentQrPayload, PaymentRequest } from '#layers/payments/shared/types/payments'
import { formatMoney } from '#layers/payments/shared/money'
import { formatZoned } from '#layers/core/shared/date-format'
import {
  cancelOptimistically,
  markPaidOptimistically,
  markUnpaidOptimistically,
  paymentErrorMessage,
  paymentStatusFromQuery,
  paymentStatusToQuery,
  paymentsRefreshFor,
  restorePaymentRequest
} from '../utils/payments'
import type { PaymentStatusFilter } from '../utils/payments'

defineOptions({ name: 'PaymentsPage' })

useSeoMeta({ title: 'Payments' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const zone = useTimeZone()

const { data: allServices } = await useServices()
const services = computed(() => allServices.value.filter(service => service.domain === 'payments'))

if (!services.value.length) {
  await navigateTo('/services/new', { replace: true })
}

// --- Status filter (URL state) --------------------------------------------

const status = computed(() => paymentStatusFromQuery(route.query))
const statusItems = [
  { label: 'Open', value: 'open' },
  { label: 'Paid', value: 'paid' },
  { label: 'Cancelled', value: 'cancelled' },
  { label: 'All', value: 'all' }
]

function setStatus(value: string | number) {
  router.replace({ query: { ...route.query, ...paymentStatusToQuery(value as PaymentStatusFilter) } })
}

// --- Requests -------------------------------------------------------------

const { data: requests, refresh, pending } = await useFetch<PaymentRequest[]>('/api/payments', {
  key: 'payments',
  query: computed(() => ({ status: status.value === 'all' ? undefined : status.value })),
  default: () => []
})

const refreshFromEvents = useDebounceFn(() => refresh(), 300)
useDomainEvents({ domains: ['payments'] }, (event) => {
  if (paymentsRefreshFor(event)) {
    refreshFromEvents()
  }
}, {
  onReconnect: () => refreshFromEvents()
})

const columns: TableColumn<PaymentRequest>[] = [
  { accessorKey: 'payerName', header: 'Payer' },
  { id: 'payee', header: 'Payee' },
  { accessorKey: 'title', header: 'Title' },
  { id: 'amount', header: 'Amount' },
  { id: 'status', header: 'Status' },
  { id: 'dates', header: 'Sent / paid' },
  { accessorKey: 'reference', header: 'Reference' },
  { id: 'actions', header: '' }
]

function statusColor(request: PaymentRequest) {
  if (request.status === 'paid') {
    return 'success' as const
  }
  if (request.status === 'cancelled') {
    return 'neutral' as const
  }
  return request.paidCents > 0 ? 'info' as const : 'warning' as const
}

function statusLabel(request: PaymentRequest): string {
  if (request.status === 'paid') {
    return 'Paid'
  }
  if (request.status === 'cancelled') {
    return 'Cancelled'
  }
  return request.paidCents > 0 ? 'Partly paid' : 'Open'
}

function moment(value: string | null): string {
  return value ? formatZoned(value, zone.value, 'dd MMM yyyy') : '—'
}

// --- QR payloads (prefetched on hover, rendered with qr) ------------------

const qrCache = new Map<string, PaymentQrPayload>()
const qrOpen = ref(false)
const qrLoading = ref(false)
const qrRequest = ref<PaymentRequest | null>(null)
const qrPayload = ref<PaymentQrPayload | null>(null)
type QrTab = 'epc' | 'paypal' | 'wero'
const qrTab = ref<QrTab>('epc')

async function fetchQr(id: string): Promise<PaymentQrPayload | undefined> {
  const cached = qrCache.get(id)
  if (cached) {
    return cached
  }

  try {
    const payload = await $fetch<PaymentQrPayload>(`/api/payments/${encodeURIComponent(id)}/qr`)
    qrCache.set(id, payload)
    return payload
  } catch {
    return undefined
  }
}

function prefetchQr(request: PaymentRequest) {
  void fetchQr(request.id)
}

async function openQr(request: PaymentRequest) {
  qrRequest.value = request
  qrPayload.value = null
  qrTab.value = 'epc'
  qrOpen.value = true
  qrLoading.value = true

  const payload = await fetchQr(request.id)
  qrLoading.value = false
  if (!payload) {
    toast.add({ title: 'Could not load the QR code', color: 'error', icon: 'i-lucide-circle-alert' })
    return
  }

  qrPayload.value = payload
  qrTab.value = payload.epc ? 'epc' : payload.paypal ? 'paypal' : 'wero'
}

const qrTabs = computed(() => [
  ...(qrPayload.value?.epc ? [{ label: 'GiroCode', value: 'epc' }] : []),
  ...(qrPayload.value?.paypal ? [{ label: 'PayPal', value: 'paypal' }] : []),
  ...(qrPayload.value?.wero ? [{ label: 'Wero', value: 'wero' }] : [])
])

const qrSvg = computed(() => {
  const data = qrPayload.value?.[qrTab.value]
  return data ? encodeQR(data, 'svg', { scale: 5 }) : ''
})

const qrSrc = computed(() => qrSvg.value ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg.value)}` : '')

/** The link behind the active tab, shown so it can be copied by hand. */
const qrLink = computed(() => qrTab.value === 'epc' ? undefined : qrPayload.value?.[qrTab.value])

const methodLabel = { paypal: 'PayPal', wero: 'Wero' } as const

async function copyLink(request: PaymentRequest, method: keyof typeof methodLabel) {
  const payload = await fetchQr(request.id)
  const link = payload?.[method]
  if (!link) {
    toast.add({ title: `No ${methodLabel[method]} link is configured`, color: 'warning', icon: 'i-lucide-circle-alert' })
    return
  }

  try {
    await navigator.clipboard.writeText(link)
    toast.add({ title: `${methodLabel[method]} link copied`, color: 'success', icon: 'i-lucide-copy' })
  } catch {
    toast.add({ title: 'Could not copy the link', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

// --- Actions (optimistic where the row changes) ---------------------------

const busy = ref(new Set<string>())

async function send(request: PaymentRequest) {
  busy.value = new Set(busy.value).add(request.id)
  try {
    await $fetch(`/api/payments/${encodeURIComponent(request.id)}/send`, { method: 'POST' })
    toast.add({ title: request.sentAt ? 'Payment request sent again' : 'Payment request sent', color: 'success', icon: 'i-lucide-send' })
    await refresh()
  } catch (error) {
    toast.add({ title: paymentErrorMessage(error, 'Could not send the payment request'), color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    const next = new Set(busy.value)
    next.delete(request.id)
    busy.value = next
  }
}

async function mutate(
  request: PaymentRequest,
  next: PaymentRequest[],
  path: 'paid' | 'unpaid' | 'cancel',
  message: string
) {
  const previous = requests.value.find(item => item.id === request.id)
  if (!previous) {
    return
  }

  requests.value = next
  busy.value = new Set(busy.value).add(request.id)

  try {
    await $fetch(`/api/payments/${encodeURIComponent(request.id)}/${path}`, { method: 'POST', body: path === 'paid' ? {} : undefined })
    toast.add({ title: message, color: 'success', icon: 'i-lucide-check-circle' })
    await refresh()
  } catch (error) {
    requests.value = restorePaymentRequest(requests.value, previous, request.id)
    toast.add({ title: paymentErrorMessage(error, 'Could not update the payment request'), color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    const nextBusy = new Set(busy.value)
    nextBusy.delete(request.id)
    busy.value = nextBusy
  }
}

function markPaid(request: PaymentRequest) {
  const cents = Math.max(request.amountCents - request.paidCents, 1)
  return mutate(request, markPaidOptimistically(requests.value, request.id, cents), 'paid', 'Payment recorded')
}

function markUnpaid(request: PaymentRequest) {
  return mutate(request, markUnpaidOptimistically(requests.value, request.id), 'unpaid', 'Payment reverted')
}

function cancel(request: PaymentRequest) {
  return mutate(request, cancelOptimistically(requests.value, request.id), 'cancel', 'Payment request cancelled')
}

function rowItems(request: PaymentRequest) {
  return [
    { label: 'Show QR code', icon: 'i-lucide-qr-code', onSelect: () => openQr(request) },
    { label: 'Copy PayPal link', icon: 'i-lucide-copy', onSelect: () => copyLink(request, 'paypal') },
    { label: 'Copy Wero link', icon: 'i-lucide-copy', onSelect: () => copyLink(request, 'wero') },
    { type: 'separator' as const },
    ...(request.status === 'open'
      ? [
          { label: 'Send email', icon: 'i-lucide-send', onSelect: () => send(request) },
          { label: 'Mark paid', icon: 'i-lucide-check', onSelect: () => markPaid(request) }
        ]
      : []),
    ...(request.status === 'paid' || request.paidCents > 0
      ? [{ label: 'Mark unpaid', icon: 'i-lucide-undo-2', onSelect: () => markUnpaid(request) }]
      : []),
    ...(request.status !== 'cancelled'
      ? [{ label: 'Cancel', icon: 'i-lucide-x-circle', color: 'error' as const, onSelect: () => cancel(request) }]
      : [])
  ]
}

// --- New request ----------------------------------------------------------

const formOpen = ref(false)

async function onCreated(response: PaymentCreateResponse) {
  formOpen.value = false
  await refresh()
  if (response.errors.length) {
    toast.add({
      title: `${response.errors.length} request${response.errors.length === 1 ? '' : 's'} created, but not sent`,
      color: 'warning',
      icon: 'i-lucide-circle-alert'
    })
  }
}
</script>

<template>
  <UDashboardPanel id="payments">
    <UDashboardNavbar title="Payments">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
      <template #trailing>
        <UBadge :label="requests.length" variant="subtle" />
      </template>
      <template #right>
        <UButton
          icon="i-lucide-plus"
          label="New"
          size="sm"
          @click="formOpen = true"
        />
      </template>
    </UDashboardNavbar>

    <UDashboardToolbar class="justify-start">
      <UTabs
        :model-value="status"
        :items="statusItems"
        :content="false"
        size="xs"
        @update:model-value="setStatus"
      />
    </UDashboardToolbar>

    <div class="flex-1 overflow-auto">
      <UTable
        :data="requests"
        :columns="columns"
        :loading="pending"
        sticky
      >
        <template #payerName-cell="{ row }">
          <div class="min-w-0">
            <p class="truncate font-medium text-highlighted">
              {{ row.original.payerName }}
            </p>
            <p v-if="row.original.payerEmail" class="truncate text-xs text-muted">
              {{ row.original.payerEmail }}
            </p>
          </div>
        </template>

        <template #title-cell="{ row }">
          <span class="text-sm">{{ row.original.title }}</span>
        </template>

        <template #payee-cell="{ row }">
          <span class="text-xs text-muted">{{ row.original.payeeName ?? 'Removed payee' }}</span>
        </template>

        <template #amount-cell="{ row }">
          <span class="tabular-nums">{{ formatMoney(row.original.amountCents) }}</span>
          <span v-if="row.original.paidCents > 0 && row.original.status !== 'paid'" class="block text-xs text-muted">
            {{ formatMoney(row.original.paidCents) }} received
          </span>
        </template>

        <template #status-cell="{ row }">
          <UBadge
            :label="statusLabel(row.original)"
            :color="statusColor(row.original)"
            variant="subtle"
            size="sm"
          />
        </template>

        <template #dates-cell="{ row }">
          <div class="space-y-0.5 text-xs text-muted">
            <p>Sent {{ moment(row.original.sentAt) }}</p>
            <p>Paid {{ moment(row.original.paidAt) }}</p>
          </div>
        </template>

        <template #reference-cell="{ row }">
          <span class="font-mono text-xs">{{ row.original.reference }}</span>
        </template>

        <template #actions-cell="{ row }">
          <div class="flex justify-end gap-1">
            <UButton
              icon="i-lucide-qr-code"
              color="neutral"
              variant="ghost"
              size="sm"
              aria-label="Show QR code"
              @mouseenter="prefetchQr(row.original)"
              @focus="prefetchQr(row.original)"
              @click="openQr(row.original)"
            />
            <UDropdownMenu :items="rowItems(row.original)">
              <UButton
                icon="i-lucide-ellipsis-vertical"
                color="neutral"
                variant="ghost"
                size="sm"
                aria-label="Payment request actions"
                :loading="busy.has(row.original.id)"
                @mouseenter="prefetchQr(row.original)"
              />
            </UDropdownMenu>
          </div>
        </template>

        <template #empty>
          <UEmpty
            icon="i-lucide-hand-coins"
            title="No payment requests"
            description="Create one to send a reference and every way to pay you configured."
            variant="naked"
            class="py-12"
          />
        </template>
      </UTable>
    </div>
  </UDashboardPanel>

  <USlideover v-model:open="formOpen" title="New payment request">
    <template #body>
      <PaymentRequestForm :services="services" @created="onCreated" />
    </template>
  </USlideover>

  <UModal
    v-model:open="qrOpen"
    :title="qrRequest ? `${qrRequest.title} · ${qrRequest.reference}` : 'QR code'"
  >
    <template #body>
      <div class="space-y-4">
        <UTabs
          v-if="qrTabs.length > 1"
          :model-value="qrTab"
          :items="qrTabs"
          :content="false"
          size="sm"
          @update:model-value="value => qrTab = value as QrTab"
        />

        <div v-if="qrLoading" class="flex justify-center py-12">
          <UIcon name="i-lucide-loader-circle" class="size-8 animate-spin text-muted" />
        </div>
        <div v-else-if="qrSrc" class="flex justify-center rounded-lg bg-white p-4">
          <img :src="qrSrc" alt="Payment QR code" class="size-64">
        </div>
        <p v-else class="py-8 text-center text-sm text-muted">
          No QR code is available.
        </p>

        <UInput
          v-if="qrLink"
          :model-value="qrLink"
          readonly
          class="w-full font-mono text-xs"
        />

        <p v-if="qrTab === 'epc'" class="text-xs text-muted">
          Scan this with a banking app to fill the transfer and its reference.
        </p>
        <p v-else-if="qrTab === 'paypal'" class="text-xs text-muted">
          The reference goes into the PayPal note.
        </p>
        <p v-else class="text-xs text-muted">
          The amount and reference travel with the Wero link.
        </p>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          v-if="qrPayload?.paypal && qrRequest"
          label="Copy PayPal link"
          icon="i-lucide-copy"
          color="neutral"
          variant="soft"
          @click="copyLink(qrRequest, 'paypal')"
        />
        <UButton
          v-if="qrPayload?.wero && qrRequest"
          label="Copy Wero link"
          icon="i-lucide-copy"
          color="neutral"
          variant="soft"
          @click="copyLink(qrRequest, 'wero')"
        />
      </div>
    </template>
  </UModal>
</template>
