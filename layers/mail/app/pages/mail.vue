<script setup lang="ts">
import { breakpointsTailwind, refDebounced, useIntervalFn } from '@vueuse/core'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { LocationQuery } from 'vue-router'
import type { MailSummary } from '#layers/mail/shared/types/mail'

useSeoMeta({ title: 'Mail' })

const route = useRoute()
const router = useRouter()
const toast = useToast()

const { data: allServices } = await useServices()
const services = computed(() => allServices.value.filter(item => item.domain === 'mail'))

if (!services.value.length) {
  await navigateTo('/services/new', { replace: true })
}

const { data: folders } = await useMailFolders()

// Account, folder, search and filters live in the URL, so the sidebar and links can drive them
const queryString = (key: string) => typeof route.query[key] === 'string' ? route.query[key] : undefined

function updateQuery(patch: LocationQuery) {
  router.replace({ query: Object.fromEntries(Object.entries({ ...route.query, ...patch }).filter(([, value]) => value)) })
}

const service = computed(() => services.value.find(item => item.id === queryString('service'))?.id ?? services.value[0]?.id ?? '')
const mailbox = computed(() => queryString('mailbox') ?? 'INBOX')

const folderName = computed(() => {
  const entry = folders.value.find(item => item.service.id === service.value)
  const current = entry?.mailboxes.find(item => item.path === mailbox.value)
  const name = current ? mailboxLabel(current) : mailbox.value
  return services.value.length > 1 && entry ? `${name} · ${entry.service.name}` : name
})

const tabItems = [{
  label: 'All',
  value: 'all'
}, {
  label: 'Unread',
  value: 'unread'
}]

const selectedTab = computed({
  get: () => queryString('unread') ? 'unread' : 'all',
  set: value => updateQuery({ unread: value === 'unread' ? 'true' : null })
})

const search = ref(queryString('q') ?? '')
const debouncedSearch = refDebounced(search, 400)
watch(debouncedSearch, value => updateQuery({ q: value.trim() || null }))
// Folder links in the sidebar drop the search from the URL
watch(() => queryString('q'), (value) => {
  if ((value ?? '') !== debouncedSearch.value.trim()) {
    search.value = value ?? ''
  }
})

const criteria = computed(() => mailSearchFromQuery(route.query))

const periods = [
  { label: 'Any time', value: undefined },
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 30 days', value: 30 },
  { label: 'Last year', value: 365 }
]
const period = computed(() => Number(queryString('days')) || undefined)

const filterItems = computed<DropdownMenuItem[][]>(() => [[{
  label: 'Starred',
  icon: 'i-lucide-star',
  type: 'checkbox',
  checked: !!criteria.value.flagged,
  onUpdateChecked: (checked: boolean) => updateQuery({ flagged: checked ? 'true' : null })
}], periods.map(item => ({
  label: item.label,
  type: 'checkbox' as const,
  checked: period.value === item.value && !queryString('since'),
  onSelect: () => updateQuery({ days: item.value ? String(item.value) : null, since: null, before: null })
}))])

// Criteria without a control of their own (e.g. set by the search assistant), shown as removable chips
const criteriaChips = computed(() => [
  queryString('from') && { key: 'from', label: `From: ${queryString('from')}` },
  queryString('since') && { key: 'since', label: `Since ${queryString('since')}` },
  queryString('before') && { key: 'before', label: `Before ${queryString('before')}` }
].filter(chip => !!chip))

const activeFilters = computed(() => Number(!!criteria.value.flagged) + Number(!!period.value) + criteriaChips.value.length)
const isFiltered = computed(() => !!(criteria.value.text || criteria.value.unread || activeFilters.value))

function resetFilters() {
  search.value = ''
  updateQuery(mailSearchToQuery({}))
}

// Optional: another layer may turn free text into criteria (see mail-search-assistant.ts)
const assistant = getMailSearchAssistant()
const assistantAvailable = computed(() => !!assistant?.isAvailable(allServices.value))
const assisting = ref(false)

async function applyAssistant() {
  if (!assistant || !search.value.trim()) {
    return
  }
  assisting.value = true
  try {
    const result = await assistant.toSearch(search.value)
    search.value = result.text ?? ''
    updateQuery(mailSearchToQuery(result))
  } catch {
    toast.add({ title: 'Could not interpret the search', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    assisting.value = false
  }
}

const { data: mails, status, error, refresh } = await useFetch('/api/mail/messages', {
  query: computed(() => ({
    service: service.value,
    mailbox: mailbox.value,
    ...mailSearchToApiQuery(criteria.value)
  })),
  default: () => []
})

// Search index status (null without an index); polled while it's being built
const { data: indexStatus, refresh: refreshIndexStatus } = await useFetch('/api/mail/index-status')
const currentIndex = computed(() => indexStatus.value?.find(item => item.service === service.value))
const indexing = computed(() => !!currentIndex.value && (currentIndex.value.syncing || !currentIndex.value.complete))
const { pause, resume } = useIntervalFn(() => refreshIndexStatus(), 5000, { immediate: false })
watch(indexing, value => value ? resume() : pause(), { immediate: true })

// The open mail lives in the URL (?uid=), so links (e.g. from the assistant) can open it
const selectedUid = computed(() => Number(queryString('uid')) || undefined)

// A linked mail may not be in the current list, e.g. older than the loaded page
const { data: linkedMail } = await useAsyncData(
  () => `mail-linked:${service.value}:${mailbox.value}:${selectedUid.value ?? ''}`,
  () => selectedUid.value && !mails.value.some(mail => mail.uid === selectedUid.value)
    ? $fetch(`/api/mail/messages/${selectedUid.value}`, { query: { service: service.value, mailbox: mailbox.value } }).catch(() => null)
    : Promise.resolve(null)
)

const selectedMail = computed<MailSummary | null>({
  get: () => mails.value.find(mail => mail.uid === selectedUid.value) ?? linkedMail.value ?? null,
  set: mail => updateQuery({ uid: mail ? String(mail.uid) : null })
})

const isMailPanelOpen = computed({
  get() {
    return !!selectedMail.value
  },
  set(value: boolean) {
    if (!value) {
      selectedMail.value = null
    }
  }
})

const setUnread = (uid: number, unread: boolean) => {
  mails.value = mails.value.map(item => item.uid === uid ? { ...item, unread } : item)
}

// Optimistic: update the list first, roll back if the server rejects it
async function setSeen(mail: MailSummary, seen: boolean) {
  setUnread(mail.uid, !seen)
  try {
    await $fetch(`/api/mail/messages/${mail.uid}`, {
      method: 'PATCH',
      query: { service: service.value, mailbox: mail.mailbox },
      body: { seen }
    })
    // Update unread counts in the sidebar
    refreshNuxtData('mail-folders')
  } catch {
    setUnread(mail.uid, seen)
    toast.add({ title: 'Could not update message', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

watch(() => selectedMail.value?.uid, () => {
  if (selectedMail.value?.unread) {
    setSeen(selectedMail.value, true)
  }
}, { immediate: import.meta.client })

function markUnread() {
  const mail = selectedMail.value
  if (!mail) {
    return
  }
  selectedMail.value = null
  setSeen(mail, false)
}

const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('lg')
</script>

<template>
  <UDashboardPanel
    id="mail-1"
    :default-size="25"
    :min-size="20"
    :max-size="35"
    resizable
  >
    <UDashboardNavbar :title="folderName">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
      <template #trailing>
        <UBadge :label="mails.length" variant="subtle" />
      </template>

      <template #right>
        <UTabs
          v-model="selectedTab"
          :items="tabItems"
          :content="false"
          size="xs"
        />
      </template>
    </UDashboardNavbar>

    <UDashboardToolbar>
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="Search mail..."
        size="sm"
        class="min-w-0 flex-1"
        :loading="status === 'pending' && !!search"
      >
        <template v-if="search" #trailing>
          <UTooltip v-if="assistant && assistantAvailable" :text="assistant.label">
            <UButton
              :icon="assistant.icon"
              color="primary"
              variant="link"
              size="xs"
              :loading="assisting"
              :aria-label="assistant.label"
              @click="applyAssistant"
            />
          </UTooltip>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="link"
            size="xs"
            aria-label="Clear search"
            @click="search = ''"
          />
        </template>
      </UInput>

      <UTooltip
        v-if="indexing"
        :text="`Building search index (${currentIndex?.messages ?? 0} messages). Until then, search goes to the mail server.`"
      >
        <UIcon name="i-lucide-loader-circle" class="size-4 shrink-0 animate-spin text-dimmed" />
      </UTooltip>

      <UDropdownMenu :items="filterItems" :content="{ align: 'end' }">
        <UChip :show="activeFilters > 0" :text="activeFilters" size="xl">
          <UButton
            icon="i-lucide-list-filter"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Filters"
          />
        </UChip>
      </UDropdownMenu>

      <UTooltip text="Refresh">
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          size="sm"
          :loading="status === 'pending'"
          @click="refresh()"
        />
      </UTooltip>
      <UTooltip text="Account settings">
        <UButton
          :to="`/services/${service}`"
          icon="i-lucide-settings"
          color="neutral"
          variant="ghost"
          size="sm"
        />
      </UTooltip>
    </UDashboardToolbar>

    <div v-if="criteriaChips.length" class="flex flex-wrap gap-1.5 border-b border-default px-4 py-2 sm:px-6">
      <UBadge
        v-for="chip in criteriaChips"
        :key="chip.key"
        :label="chip.label"
        color="neutral"
        variant="subtle"
        class="gap-1 pe-1"
      >
        <template #trailing>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="link"
            size="xs"
            class="p-0"
            :aria-label="`Remove ${chip.label}`"
            @click="updateQuery({ [chip.key]: null })"
          />
        </template>
      </UBadge>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Could not load mail"
      :description="error.statusMessage || error.message"
      :actions="[{ label: 'Account settings', to: `/services/${service}`, color: 'error', variant: 'outline' }]"
      class="m-4 w-auto"
    />
    <UEmpty
      v-else-if="!mails.length && status !== 'pending'"
      :icon="isFiltered ? 'i-lucide-search-x' : 'i-lucide-inbox'"
      :title="isFiltered ? 'No matching messages' : 'No messages'"
      :actions="isFiltered ? [{ label: 'Reset filters', color: 'neutral', variant: 'outline', onClick: resetFilters }] : undefined"
      variant="naked"
      class="py-12"
    />
    <MailList v-else v-model="selectedMail" :mails="mails" />
  </UDashboardPanel>

  <MailView
    v-if="selectedMail && !isMobile"
    :key="selectedMail.uid"
    :mail="selectedMail"
    :service="service"
    @close="selectedMail = null"
    @mark-unread="markUnread"
  />
  <div v-else class="hidden lg:flex flex-1 items-center justify-center">
    <UIcon name="i-lucide-inbox" class="size-32 text-dimmed" />
  </div>

  <ClientOnly>
    <USlideover v-if="isMobile" v-model:open="isMailPanelOpen">
      <template #content>
        <MailView
          v-if="selectedMail"
          :key="selectedMail.uid"
          :mail="selectedMail"
          :service="service"
          @close="selectedMail = null"
          @mark-unread="markUnread"
        />
      </template>
    </USlideover>
  </ClientOnly>
</template>
