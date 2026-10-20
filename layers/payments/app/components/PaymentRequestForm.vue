<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import type { Contact } from '#layers/contacts/shared/types/contacts'
import type { PaymentCreateResponse } from '#layers/payments/shared/types/payments'
import { formatMoney, parseMoney } from '#layers/payments/shared/money'
import { splitAmount } from '#layers/payments/shared/split'
import { paymentErrorMessage } from '../utils/payments'

const props = defineProps<{
  services: { id: string, name: string, icon?: string }[]
}>()

const emit = defineEmits<{
  created: [response: PaymentCreateResponse]
}>()

const toast = useToast()
const saving = ref(false)
const mode = ref<'single' | 'split'>('single')

interface PayerDraft {
  name: string
  email: string
  contactService?: string
  contactUid?: string
}

const service = ref(props.services[0]?.id ?? '')
const title = ref('')
const amountText = ref('')
const totalText = ref('')
const sharesText = ref('2')
const sendNow = ref(false)
const payers = ref<PayerDraft[]>([{ name: '', email: '' }])

const modeItems = [
  { label: 'Single payment', value: 'single' },
  { label: 'Split', value: 'split' }
]

const serviceItems = computed(() => props.services.map(item => ({ label: item.name, value: item.id })))

const shares = computed(() => {
  const value = Math.floor(Number(sharesText.value))
  return Number.isFinite(value) && value >= 1 ? Math.min(value, 100) : 1
})

const amountCents = computed(() => parseMoney(amountText.value))
const totalCents = computed(() => parseMoney(totalText.value))

/** What each payer of the split owes, per `splitAmount`; empty until valid. */
const payerAmounts = computed(() => {
  if (!totalCents.value || payers.value.length < 1 || payers.value.length > shares.value) {
    return []
  }
  return splitAmount(totalCents.value, shares.value, payers.value.length)
})

const ownerCents = computed(() => {
  const total = totalCents.value ?? 0
  return total - payerAmounts.value.reduce((sum, cents) => sum + cents, 0)
})

const tooManyPayers = computed(() => mode.value === 'split' && payers.value.length > shares.value)

const canSubmit = computed(() => {
  if (!service.value || !title.value.trim() || payers.value.some(payer => !payer.name.trim())) {
    return false
  }
  return mode.value === 'single'
    ? !!amountCents.value
    : !!totalCents.value && payers.value.length >= 1 && !tooManyPayers.value
})

// Switching back to one payer keeps the first; the split-only rows would never post
watch(mode, (value) => {
  if (value === 'single' && payers.value.length > 1) {
    payers.value = payers.value.slice(0, 1)
  }
})

// --- Payers from contacts (or typed by hand) ------------------------------

const search = ref('')
const debouncedSearch = refDebounced(search, 300)
const results = ref<Contact[]>([])
let searchRun = 0

watch(debouncedSearch, async (query) => {
  const text = query.trim()
  const run = ++searchRun
  if (!text) {
    results.value = []
    return
  }

  try {
    const found = await $fetch<Contact[]>('/api/contacts', { query: { q: text } })
    if (run === searchRun) {
      results.value = found
    }
  } catch {
    if (run === searchRun) {
      results.value = []
    }
  }
})

function payerFromContact(contact: Contact): PayerDraft {
  return {
    name: contact.name,
    email: contact.emails[0]?.value ?? '',
    contactService: contact.service,
    contactUid: contact.uid
  }
}

function addContact(contact: Contact) {
  const draft = payerFromContact(contact)
  const empty = payers.value.findIndex(payer => !payer.name.trim() && !payer.email.trim())

  if (mode.value === 'single' || empty >= 0) {
    payers.value.splice(empty >= 0 ? empty : 0, 1, draft)
  } else if (payers.value.length < shares.value) {
    payers.value.push(draft)
  } else {
    toast.add({ title: 'There are already as many payers as shares', color: 'warning', icon: 'i-lucide-circle-alert' })
    return
  }

  search.value = ''
  results.value = []
}

function addPayer() {
  if (payers.value.length >= shares.value) {
    return
  }
  payers.value.push({ name: '', email: '' })
}

/** Typing over a picked contact means the link to it no longer describes the payer. */
function clearContactLink(payer: PayerDraft) {
  payer.contactService = undefined
  payer.contactUid = undefined
}

function removePayer(index: number) {
  if (payers.value.length > 1) {
    payers.value.splice(index, 1)
  }
}

// --- Submit ---------------------------------------------------------------

function payerBody(payer: PayerDraft) {
  return {
    name: payer.name.trim(),
    email: payer.email.trim() || undefined,
    contact: payer.contactUid ? { service: payer.contactService, uid: payer.contactUid } : undefined
  }
}

async function submit() {
  if (!canSubmit.value || saving.value) {
    return
  }

  const body = mode.value === 'single'
    ? {
        service: service.value,
        title: title.value.trim(),
        payer: payerBody(payers.value[0]!),
        amountCents: amountCents.value!,
        send: sendNow.value
      }
    : {
        service: service.value,
        title: title.value.trim(),
        totalCents: totalCents.value!,
        shares: shares.value,
        payers: payers.value.map(payerBody),
        send: sendNow.value
      }

  saving.value = true
  try {
    const response = await $fetch<PaymentCreateResponse>('/api/payments', { method: 'POST', body })
    toast.add({
      title: response.errors.length ? 'Created, but not every mail was sent' : 'Payment request created',
      color: response.errors.length ? 'warning' : 'success',
      icon: response.errors.length ? 'i-lucide-circle-alert' : 'i-lucide-check-circle'
    })
    emit('created', response)
  } catch (error) {
    toast.add({ title: paymentErrorMessage(error, 'Could not create the payment request'), color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-5">
    <UFormField label="Payee" required>
      <USelect v-model="service" :items="serviceItems" class="w-full" />
    </UFormField>

    <UTabs
      :model-value="mode"
      :items="modeItems"
      :content="false"
      size="sm"
      @update:model-value="value => mode = value as 'single' | 'split'"
    />

    <UFormField label="Title" required>
      <UInput v-model="title" class="w-full" placeholder="Dinner, concert ticket, ..." />
    </UFormField>

    <UFormField
      v-if="mode === 'single'"
      label="Amount"
      required
      :error="amountText && !amountCents ? 'Enter an amount like 17,99 €' : undefined"
    >
      <UInput
        v-model="amountText"
        class="w-full"
        placeholder="17,99 €"
        inputmode="decimal"
      />
    </UFormField>

    <div v-else class="grid grid-cols-2 gap-3">
      <UFormField
        label="Total"
        required
        :error="totalText && !totalCents ? 'Enter an amount like 17,99 €' : undefined"
      >
        <UInput
          v-model="totalText"
          class="w-full"
          placeholder="17,99 €"
          inputmode="decimal"
        />
      </UFormField>
      <UFormField label="Shares" required :description="`Owner covers ${formatMoney(ownerCents)}`">
        <UInput
          v-model="sharesText"
          type="number"
          min="1"
          max="100"
          class="w-full"
        />
      </UFormField>
    </div>

    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <p class="text-sm font-medium">
          {{ mode === 'single' ? 'Payer' : `Payers (${payers.length} of ${shares})` }}
        </p>
        <UButton
          v-if="mode === 'split'"
          label="Add payer"
          icon="i-lucide-plus"
          size="xs"
          color="neutral"
          variant="ghost"
          :disabled="payers.length >= shares"
          @click="addPayer"
        />
      </div>

      <div
        v-for="(payer, index) in payers"
        :key="index"
        class="rounded-lg border border-default p-3"
      >
        <div class="flex gap-2">
          <UInput
            v-model="payer.name"
            class="flex-1"
            placeholder="Name"
            @update:model-value="clearContactLink(payer)"
          />
          <UInput
            v-model="payer.email"
            class="flex-1"
            type="email"
            placeholder="Email (optional)"
            @update:model-value="clearContactLink(payer)"
          />
          <UButton
            v-if="mode === 'split' && payers.length > 1"
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            aria-label="Remove payer"
            @click="removePayer(index)"
          />
        </div>
        <p v-if="mode === 'split' && payerAmounts[index] !== undefined" class="mt-2 text-xs text-muted">
          Pays {{ formatMoney(payerAmounts[index]!) }}
        </p>
      </div>

      <p v-if="tooManyPayers" class="text-xs text-error">
        There are more payers than shares. Raise the shares or remove a payer.
      </p>
    </div>

    <UFormField label="Find a contact">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        class="w-full"
        placeholder="Search contacts..."
      />
    </UFormField>

    <div v-if="results.length" class="max-h-44 overflow-y-auto rounded-lg border border-default">
      <button
        v-for="contact in results"
        :key="`${contact.service}-${contact.uid}`"
        type="button"
        class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-elevated/50"
        @click="addContact(contact)"
      >
        <span class="truncate">{{ contact.name }}</span>
        <span class="truncate text-xs text-dimmed">{{ contact.emails[0]?.value }}</span>
      </button>
    </div>

    <p v-else-if="search.trim()" class="text-xs text-muted">
      No contacts match. Typing a name and email above works too.
    </p>

    <div class="flex items-center justify-between gap-4 rounded-lg border border-default p-3">
      <div>
        <p class="text-sm font-medium">
          Send the mail now
        </p>
        <p class="text-xs text-muted">
          A failed send keeps the request; you can resend it from the list.
        </p>
      </div>
      <USwitch v-model="sendNow" />
    </div>

    <div class="flex justify-end gap-2 border-t border-default pt-4">
      <UButton
        label="Create"
        icon="i-lucide-plus"
        :loading="saving"
        :disabled="!canSubmit"
        @click="submit"
      />
    </div>
  </div>
</template>
