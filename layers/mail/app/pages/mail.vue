<script setup lang="ts">
import { breakpointsTailwind, refDebounced, useDebounceFn } from '@vueuse/core'
import type { LocationQuery } from 'vue-router'
import type { MailConversation, MailSummary } from '#layers/mail/shared/types/mail'
import type { SetupState } from '#layers/core/shared/types/setup'

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

// A changed filter starts a fresh list; opening a mail or loading more keeps the loaded pages
function updateFilters(patch: LocationQuery) {
  updateQuery({ ...patch, pages: null })
}

const service = computed(() => services.value.find(item => item.id === queryString('service'))?.id ?? services.value[0]?.id ?? '')
const mailbox = computed(() => queryString('mailbox') ?? 'INBOX')

const list = computed(() => mailListFromQuery(route.query))
const allFolders = computed({
  get: () => list.value.allFolders,
  set: (value: boolean) => updateFilters({ scope: value ? 'all' : null })
})

const folderName = computed(() => {
  if (allFolders.value) {
    const account = services.value.find(item => item.id === service.value)
    return services.value.length > 1 && account ? `All folders · ${account.name}` : 'All folders'
  }
  const entry = folders.value.find(item => item.service.id === service.value)
  const current = entry?.mailboxes.find(item => item.path === mailbox.value)
  const name = current ? mailboxLabel(current) : mailbox.value
  return services.value.length > 1 && entry ? `${name} · ${entry.service.name}` : name
})

// Folder display name for hits that can come from any folder (scope=all), by `service/mailbox`
const mailboxNames = computed(() => {
  const names: Record<string, string> = {}
  for (const entry of folders.value) {
    for (const item of entry.mailboxes) {
      names[`${entry.service.id}/${item.path}`] = mailboxLabel(item)
    }
  }
  return names
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
  set: value => updateFilters({ unread: value === 'unread' ? 'true' : null })
})

const search = ref(queryString('q') ?? '')
const debouncedSearch = refDebounced(search, 400)
watch(debouncedSearch, value => updateFilters({ q: value.trim() || null }))
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

function setPeriod(value?: number) {
  updateFilters({ days: value ? String(value) : null, since: null, before: null })
}

// Sender, date range and toggles have controls of their own and keep the URL authoritative
const from = computed({
  get: () => queryString('from') ?? '',
  set: value => updateFilters({ from: value?.trim() || null })
})
const since = computed({
  get: () => queryString('since') ?? '',
  set: value => updateFilters({ since: value || null, days: null })
})
const before = computed({
  get: () => queryString('before') ?? '',
  set: value => updateFilters({ before: value || null, days: null })
})
const starred = computed({
  get: () => !!criteria.value.flagged,
  set: (value: boolean) => updateFilters({ flagged: value ? 'true' : null })
})
const hasAttachment = computed({
  get: () => !!criteria.value.hasAttachment,
  set: (value: boolean) => updateFilters({ attachment: value ? 'true' : null })
})

// Set criteria, shown as removable chips
const criteriaChips = computed(() => [
  queryString('from') && { key: 'from', label: `From: ${queryString('from')}` },
  queryString('since') && { key: 'since', label: `Since ${queryString('since')}` },
  queryString('before') && { key: 'before', label: `Before ${queryString('before')}` },
  queryString('attachment') === 'true' && { key: 'attachment', label: 'Has attachment' },
  queryString('scope') === 'all' && { key: 'scope', label: 'All folders' }
].filter(chip => !!chip))

const activeFilters = computed(() => Number(!!criteria.value.flagged) + Number(!!period.value) + criteriaChips.value.length)
const isFiltered = computed(() => !!(criteria.value.text || criteria.value.unread || activeFilters.value))

function resetFilters() {
  search.value = ''
  updateFilters({ ...mailSearchToQuery({}), scope: null })
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
    updateFilters(mailSearchToQuery(result))
  } catch {
    toast.add({ title: 'Could not interpret the search', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    assisting.value = false
  }
}

const { data: mails, status, error, refresh } = await useFetch('/api/mail/messages', {
  query: computed(() => ({
    service: service.value,
    scope: allFolders.value ? 'all' : undefined,
    mailbox: allFolders.value ? undefined : mailbox.value,
    limit: list.value.pages * MAIL_PAGE_SIZE,
    ...mailSearchToApiQuery(criteria.value)
  })),
  default: () => []
})

// Search index status (null without an index); refreshed when a sync finishes
const { data: indexStatus, refresh: refreshIndexStatus } = await useFetch('/api/mail/index-status')
const currentIndex = computed(() => indexStatus.value?.find(item => item.service === service.value))
const indexAvailable = computed(() => !!indexStatus.value)
const indexing = computed(() => !!currentIndex.value && (currentIndex.value.syncing || !currentIndex.value.complete))

// Conversations view; the toggle only shows while a search index is configured
const view = computed(() => mailViewFromQuery(route.query))
const conversationKey = computed(() => mailConversationFromQuery(route.query))
const showThreads = computed(() => indexAvailable.value && view.value === 'threads')

const viewItems = [{
  label: 'Mails',
  value: 'mails'
}, {
  label: 'Conversations',
  value: 'threads'
}]

const selectedView = computed({
  get: () => view.value,
  set: value => updateQuery(mailViewToQuery(value === 'threads' ? 'threads' : 'mails'))
})

// The account's own address, so a conversation can align own mails to the right
const { data: serviceSetup } = await useFetch<SetupState>(() => `/api/services/${service.value}`, { lazy: true })
const ownAddress = computed(() => String(serviceSetup.value?.values.user ?? '') || undefined)
const sentMailboxes = computed(() => (folders.value.find(entry => entry.service.id === service.value)?.mailboxes ?? [])
  .filter(item => item.specialUse === '\\Sent')
  .map(item => item.path))

const conversationParams = computed(() => ({
  service: service.value,
  mailbox: mailbox.value,
  ...mailSearchToApiQuery(criteria.value),
  limit: 50
}))

const { data: conversations, status: conversationsStatus, refresh: refreshConversations } = await useAsyncData<MailConversation[]>(
  'mail-conversations',
  // A mailbox that is not indexed yet answers 409 and has no conversations
  () => $fetch<MailConversation[]>('/api/mail/conversations', { query: conversationParams.value }).catch(() => []),
  { default: () => [], immediate: false }
)

// Fetch once the view is switched, and again whenever the filters change while it is open
watch([showThreads, conversationParams], () => {
  if (showThreads.value) {
    refreshConversations()
  }
}, { immediate: true })

function openConversation(key: string) {
  updateQuery(mailConversationToQuery(key))
}

function closeConversation() {
  updateQuery(mailConversationToQuery(null))
}

function prefetchConversation(key: string) {
  $fetch(`/api/mail/conversations/${encodeURIComponent(key)}`, { query: { service: service.value } }).catch(() => {})
}

function openConversationMail(mail: MailSummary) {
  updateQuery(mailSelectionToQuery({ uid: mail.uid, mailbox: mail.mailbox }, mailbox.value))
}

function onConversationSeen() {
  refreshConversations()
  refreshNuxtData('mail-folders')
}

const refreshListFromEvents = useDebounceFn(() => refresh(), 300)
const refreshFoldersFromEvents = useDebounceFn(() => refreshNuxtData('mail-folders'), 300)

useDomainEvents({ domains: ['mail'] }, (event) => {
  const plan = mailRefreshFor(event, { service: service.value, mailbox: mailbox.value })
  if (plan.list) {
    refreshListFromEvents()
    if (showThreads.value) {
      refreshConversations()
    }
  }
  if (plan.folders) {
    refreshFoldersFromEvents()
  }
  if (plan.indexStatus) {
    refreshIndexStatus()
  }
}, {
  onReconnect: () => {
    refreshListFromEvents()
    refreshFoldersFromEvents()
    refreshIndexStatus()
  }
})

// Sender suggestions for the `from` control, from the index facets; null without an index
const { data: facets } = await useFetch('/api/mail/facets', {
  query: computed(() => ({
    service: service.value,
    scope: allFolders.value ? 'all' : undefined,
    mailbox: allFolders.value ? undefined : mailbox.value,
    ...mailSearchToApiQuery({ ...criteria.value, from: undefined })
  })),
  default: () => null,
  lazy: true
})
const fromItems = computed(() => (facets.value?.from ?? []).map(item => item.value))

// Only searches and cross-folder listing come from the index and can page; browsing does not
const loadedLimit = computed(() => list.value.pages * MAIL_PAGE_SIZE)
const canLoadMore = computed(() => !!currentIndex.value?.complete && (isFiltered.value || allFolders.value) && (mails.value?.length ?? 0) >= loadedLimit.value)

function loadMore() {
  updateQuery({ pages: String(list.value.pages + 1) })
}

// The open mail lives in the URL (`?uid=&in=`); `in` names a folder outside the current one
const selection = computed(() => mailSelectionFromQuery(route.query, mailbox.value))
const selectionKey = computed(() => selection.value && `${selection.value.mailbox}:${selection.value.uid}`)

// A linked mail may not be in the current list, e.g. outside the loaded pages
const { data: linkedMail } = await useAsyncData(
  () => `mail-linked:${service.value}:${selectionKey.value ?? ''}`,
  () => selection.value && !mails.value.some(mail => isSelectedMail(mail, selection.value))
    ? $fetch(`/api/mail/messages/${selection.value.uid}`, { query: { service: service.value, mailbox: selection.value.mailbox } }).catch(() => null)
    : Promise.resolve(null)
)

const selectedMail = computed<MailSummary | null>({
  get: () => mails.value.find(mail => isSelectedMail(mail, selection.value)) ?? linkedMail.value ?? null,
  set: mail => updateQuery(mailSelectionToQuery(mail ? { uid: mail.uid, mailbox: mail.mailbox } : null, mailbox.value))
})

const isMailPanelOpen = computed({
  get() {
    return !!selectedMail.value || (showThreads.value && !!conversationKey.value)
  },
  set(value: boolean) {
    if (!value) {
      updateQuery({ uid: null, in: null, conversation: null })
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

watch(() => selectedMail.value && mailKey(selectedMail.value), () => {
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
        <UBadge :label="showThreads ? conversations.length : mails.length" variant="subtle" />
      </template>

      <template #right>
        <UTabs
          v-if="indexAvailable"
          v-model="selectedView"
          :items="viewItems"
          :content="false"
          size="xs"
        />
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

      <UPopover :content="{ align: 'end' }">
        <UChip :show="activeFilters > 0" :text="activeFilters" size="xl">
          <UButton
            icon="i-lucide-list-filter"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Filters"
          />
        </UChip>

        <template #content>
          <div class="w-72 space-y-4 p-4">
            <UFormField label="From">
              <UInputMenu
                v-if="indexAvailable"
                v-model="from"
                :items="fromItems"
                :create-item="true"
                icon="i-lucide-user"
                placeholder="Name, address or domain"
                size="sm"
                class="w-full"
              />
              <UInput
                v-else
                v-model="from"
                icon="i-lucide-user"
                placeholder="Name, address or domain"
                size="sm"
                class="w-full"
              />
            </UFormField>

            <UFormField label="Received">
              <div class="flex items-center gap-2">
                <UInput
                  v-model="since"
                  type="date"
                  size="sm"
                  class="flex-1"
                  aria-label="Since"
                />
                <span class="text-dimmed">–</span>
                <UInput
                  v-model="before"
                  type="date"
                  size="sm"
                  class="flex-1"
                  aria-label="Before"
                />
              </div>
            </UFormField>

            <div class="flex flex-wrap gap-1">
              <UButton
                v-for="item in periods"
                :key="item.label"
                :label="item.label"
                :color="period === item.value ? 'primary' : 'neutral'"
                :variant="period === item.value ? 'soft' : 'ghost'"
                size="xs"
                @click="setPeriod(item.value)"
              />
            </div>

            <div class="space-y-2">
              <UCheckbox v-model="starred" label="Starred" />
              <UCheckbox v-if="indexAvailable" v-model="hasAttachment" label="Has attachment" />
              <UCheckbox v-if="indexAvailable" v-model="allFolders" label="Search all folders" />
            </div>
          </div>
        </template>
      </UPopover>

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
            @click="updateFilters({ [chip.key]: null })"
          />
        </template>
      </UBadge>
    </div>

    <template v-if="showThreads">
      <div v-if="conversationsStatus === 'pending' && !conversations.length" class="flex items-center justify-center p-8">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-dimmed" />
      </div>
      <UEmpty
        v-else-if="!conversations.length"
        icon="i-lucide-messages-square"
        title="No conversations"
        description="Nothing matches the current filters."
        variant="naked"
        class="py-12"
      />
      <MailConversationList
        v-else
        :conversations="conversations"
        :selected-key="conversationKey"
        :own-address="ownAddress"
        @select="openConversation"
        @prefetch="prefetchConversation"
      />
    </template>
    <template v-else>
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
      <MailList
        v-else
        v-model="selectedMail"
        :mails="mails"
        :show-mailbox="allFolders"
        :mailbox-names="mailboxNames"
      >
        <template #more>
          <div v-if="canLoadMore" class="p-4 text-center">
            <UButton
              label="Load more"
              color="neutral"
              variant="outline"
              :loading="status === 'pending'"
              @click="loadMore"
            />
          </div>
        </template>
      </MailList>
    </template>
  </UDashboardPanel>

  <MailView
    v-if="selectedMail && !isMobile"
    :key="selectedMail.uid"
    :mail="selectedMail"
    :service="service"
    @close="selectedMail = null"
    @mark-unread="markUnread"
  />
  <MailConversation
    v-else-if="showThreads && conversationKey && !isMobile"
    :key="conversationKey"
    :conversation-key="conversationKey"
    :service="service"
    :own-address="ownAddress"
    :sent-mailboxes="sentMailboxes"
    @open="openConversationMail"
    @seen="onConversationSeen"
    @close="closeConversation"
  />
  <div v-else class="hidden lg:flex flex-1 items-center justify-center">
    <UIcon name="i-lucide-inbox" class="size-32 text-dimmed" />
  </div>

  <ClientOnly>
    <USlideover v-if="isMobile" v-model:open="isMailPanelOpen">
      <template #content>
        <MailConversation
          v-if="showThreads && conversationKey"
          :key="conversationKey"
          :conversation-key="conversationKey"
          :service="service"
          :own-address="ownAddress"
          :sent-mailboxes="sentMailboxes"
          @open="openConversationMail"
          @seen="onConversationSeen"
          @close="closeConversation"
        />
        <MailView
          v-else-if="selectedMail"
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
