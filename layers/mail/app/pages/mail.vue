<script setup lang="ts">
import { breakpointsTailwind, refDebounced, useDebounceFn, useDocumentVisibility, useIntervalFn } from '@vueuse/core'
import type { LocationQuery } from 'vue-router'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { MailConversation, MailMessage, MailSummary } from '#layers/mail/shared/types/mail'
import { buildReply, emptyOutgoingMail, type OutgoingMail } from '#layers/mail/shared/mail-compose'
import { trashTarget } from '#layers/mail/shared/mail-delete'
import type { MailComposeMode } from '#layers/mail/app/utils/mail-query'
import type { RetainedConversations, RetainedMail, RetainedMails } from '#layers/mail/app/utils/mail-retention'
import type { SetupState } from '#layers/core/shared/types/setup'
import type { MailListView, MailSettings } from '#layers/mail/shared/types/settings'

useSeoMeta({ title: 'Mail' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const nuxtApp = useNuxtApp()
// Forwards the browser's cookies on the server; plain `$fetch` on the client
const requestFetch = useRequestFetch()

// Read in setup, before the first list request, so SSR and hydration already use
// the saved view; ?view= still wins for a shared link.
const { data: mailSettings, save: saveMailSettings } = useSettings<MailSettings>('mail')
const savedListView = computed<MailListView>(() => mailSettings.value.listView === 'conversations' ? 'conversations' : 'mails')

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

// Search index status (null without an index); refreshed when a sync finishes
const { data: indexStatus, refresh: refreshIndexStatus } = await useFetch('/api/mail/index-status')
const currentIndex = computed(() => indexStatus.value?.find(item => item.service === service.value))
const indexAvailable = computed(() => !!indexStatus.value)
const indexing = computed(() => !!currentIndex.value && (currentIndex.value.syncing || !currentIndex.value.complete))

// Conversations view; the option only shows while a search index is configured.
// An explicit ?view= wins for this visit, otherwise the saved listView applies.
const viewParam = computed(() => mailViewParamFromQuery(route.query))
const effectiveView = computed(() => effectiveListView(viewParam.value, savedListView.value, indexAvailable.value))
const conversationKey = computed(() => mailConversationFromQuery(route.query))
const showThreads = computed(() => effectiveView.value === 'conversations')

// The URL `?pages=N` restores the loaded depth. A provider caps one request, so
// the depth is restored page by page in parallel and merged newest first.
const basePages = ref(list.value.pages)
// The messages API accepts at most 1000 per request
const MAIL_REQUEST_MAX = 1000

const baseQuery = computed(() => ({
  service: service.value,
  scope: allFolders.value ? 'all' : undefined,
  mailbox: allFolders.value ? undefined : mailbox.value,
  ...mailSearchToApiQuery(criteria.value)
}))

const { data: baseResult, status, error, refresh } = await useAsyncData('mail-restore', async () => {
  // The conversations view never shows the mails list, so fetching it there is a
  // second, unused request. It loads when the view switches back to mails.
  if (showThreads.value) {
    return { mails: [] as MailSummary[], done: false }
  }

  const pages = Math.min(basePages.value, Math.ceil(MAIL_REQUEST_MAX / MAIL_PAGE_SIZE))
  const results = await Promise.all(restoreRequests(pages, MAIL_PAGE_SIZE).map(offset => requestFetch<MailSummary[]>('/api/mail/messages', {
    query: { ...baseQuery.value, limit: MAIL_PAGE_SIZE, offset }
  })))

  return {
    mails: results.reduce<MailSummary[]>((merged, page) => mergePage(merged, page), []),
    done: (results.at(-1)?.length ?? 0) < MAIL_PAGE_SIZE
  }
}, { default: () => ({ mails: [] as MailSummary[], done: false }) })

// Everything loaded so far; appended pages keep the newest-first order
const mails = ref<MailSummary[]>([])
const pageState = ref({ offset: 0, done: false })
const loadingMore = ref(false)

watch(baseResult, (value) => {
  mails.value = value.mails
  pageState.value = { offset: value.mails.length, done: value.done }

  // Only the pages that really arrived belong in the URL
  if (import.meta.client) {
    const pages = Math.max(1, Math.ceil(value.mails.length / MAIL_PAGE_SIZE))
    if (pages !== list.value.pages) {
      updateQuery({ pages: pages > 1 ? String(pages) : null })
    }
  }
}, { immediate: true })

// Mails and conversations the unread filter dropped but that stay visible: while
// one is open, and for a moment after it was left. Client-only UI state per tab.
const retained = ref<RetainedMails>(new Map())
const retainedConversations = ref<RetainedConversations>(new Map())
const retentionTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** The retained mail that is open right now, by `mailKey` */
let openRetainedKey: string | null = null
/** The retained conversation that is open right now, by conversation key */
let openRetainedConversationKey: string | null = null

function scheduleRetentionExpire(key: string) {
  const pending = retentionTimers.get(key)
  if (pending) {
    clearTimeout(pending)
  }
  retentionTimers.set(key, setTimeout(() => {
    retentionTimers.delete(key)
    expire(retained.value, Date.now())
    expire(retainedConversations.value, Date.now())
    // expire() mutates the maps in place; hand the computed a fresh map so it re-runs
    retained.value = new Map(retained.value)
    retainedConversations.value = new Map(retainedConversations.value)
  }, MAIL_RETENTION_MS))
}

/** Drop everything held; a changed folder, search or filter starts over */
function clearRetention() {
  for (const timer of retentionTimers.values()) {
    clearTimeout(timer)
  }
  retentionTimers.clear()
  retained.value = new Map()
  retainedConversations.value = new Map()
  openRetainedKey = null
  openRetainedConversationKey = null
}

onBeforeUnmount(clearRetention)

const listRef = ref<{ scrollToTop: () => void } | null>(null)

// The list's own params: account, folder, view and search filters start a fresh
// list. The selection (uid/in/conversation/compose) is deliberately not part of
// it, so opening a mail or a conversation leaves the list and its scroll alone.
const listIdentity = computed(() => listIdentityFromQuery(route.query))

// Multi-select of list rows; ordered mail keys in `?sel=`, one entry is no selection
const selectedMailKeys = computed(() => selectionFromQuery(route.query))

function setSelectedMails(keys: string[]) {
  updateQuery({ sel: selectionToQuery(keys) })
}

// A filter, folder, account or view change starts the visible list over
watch(listIdentity, () => {
  clearRetention()

  // The selection belongs to the list that was shown, not to the next one
  if (queryString('sel')) {
    updateQuery({ sel: null })
  }

  if (showThreads.value) {
    // The conversations watcher below reloads the list that is actually shown
    return
  }

  basePages.value = 1
  refresh()
  listRef.value?.scrollToTop()
})

// Index progress: poll while any account is still incomplete, and only on a
// visible tab. A complete service stops the poll; an event refresh catches the rest.
const serviceNames = computed(() => new Map(services.value.map(item => [item.id, item.name])))
const anyIndexing = computed(() => (indexStatus.value ?? []).some(item => !item.complete))
const documentVisible = useDocumentVisibility()

const { pause: pauseIndexPolling, resume: resumeIndexPolling } = useIntervalFn(() => {
  refreshIndexStatus()
}, 3000, { immediate: false })

watch([anyIndexing, documentVisible], ([pending, visibility]) => {
  // resume() would start a server timer during SSR; polling belongs to the client
  if (import.meta.client && pending && visibility === 'visible') {
    resumeIndexPolling()
  } else {
    pauseIndexPolling()
  }
}, { immediate: true })

// The checkbox mirrors the effective view; toggling writes both the URL and the
// saved default, so a reload without ?view= keeps the chosen view.
const conversationsView = computed({
  get: () => effectiveView.value === 'conversations',
  set: (value: boolean) => {
    updateQuery(mailViewToQuery(value ? 'threads' : 'mails'))
    void saveMailSettings({
      trustedImageSenders: mailSettings.value.trustedImageSenders ?? [],
      listView: value ? 'conversations' : 'mails'
    })
  }
})

// "View options" menu of the search toolbar; the checkbox mirrors `?view=threads`
// and keeps the menu open, so the active view can be read off the button itself
const viewItems = computed<DropdownMenuItem[][]>(() => [[{
  label: 'Conversations',
  icon: 'i-lucide-messages-square',
  type: 'checkbox',
  checked: conversationsView.value,
  onUpdateChecked: (checked: boolean) => {
    conversationsView.value = checked
  },
  onSelect: (event: Event) => event.preventDefault()
}]])

// The account's own address, so a conversation can align own mails to the right
const { data: serviceSetup } = await useFetch<SetupState>(() => `/api/services/${service.value}`, { lazy: true })
const ownAddress = computed(() => String(serviceSetup.value?.values.user ?? '') || undefined)

// Every address the account may send from, for the composer's From control and
// reply prefills; cached per service and warmed on the compose hover.
const { data: mailAddresses, refresh: refreshMailAddresses } = await useFetch<{ addresses: string[], default?: string }>(
  '/api/mail/addresses',
  {
    query: computed(() => ({ service: service.value })),
    key: () => `mail-addresses:${service.value}`,
    lazy: true,
    default: () => ({ addresses: [] as string[], default: undefined })
  }
)
const sentMailboxes = computed(() => (folders.value.find(entry => entry.service.id === service.value)?.mailboxes ?? [])
  .filter(item => item.specialUse === '\\Sent')
  .map(item => item.path))

const conversationListRef = ref<{ scrollToTop: () => void } | null>(null)

const conversationParams = computed(() => ({
  service: service.value,
  mailbox: mailbox.value,
  ...mailSearchToApiQuery(criteria.value)
}))

// Conversations page over the grouped result, one page at a time (index only)
const conversations = ref<MailConversation[]>([])
const conversationsStatus = ref<'idle' | 'pending' | 'success'>('idle')
const conversationsLoading = ref(false)
const conversationState = ref({ offset: 0, done: false })

// The conversations list with the unread filter's drop-outs kept visible
const visibleConversationList = computed(() => visibleConversations(conversations.value, retainedConversations.value, criteria.value))

// The open conversation once the loaded list or the retention state can supply it
const selectedConversationKey = computed(() => {
  const key = conversationKey.value
  if (!key) {
    return undefined
  }
  return conversations.value.some(item => item.key === key) || retainedConversations.value.has(key) ? key : undefined
})

// Keep the open conversation in the list while it is unread-filtered, then let it go
watch(selectedConversationKey, (key) => {
  const previous = openRetainedConversationKey
  if (previous && previous !== key) {
    release(retainedConversations.value, previous, Date.now())
    scheduleRetentionExpire(previous)
    openRetainedConversationKey = null
  }

  if (key && criteria.value.unread) {
    const conversation = conversations.value.find(item => item.key === key)
      ?? retainedConversations.value.get(key)?.conversation
    if (conversation) {
      retainConversation(retainedConversations.value, conversation)
      openRetainedConversationKey = key
    }
  }
}, { immediate: import.meta.client })

async function fetchConversations(offset: number, limit: number) {
  return $fetch<MailConversation[]>('/api/mail/conversations', {
    query: { ...conversationParams.value, limit, offset }
  })
}

async function loadConversations(reset = false) {
  if (!showThreads.value || (!reset && (conversationState.value.done || conversationsLoading.value))) {
    return
  }

  const offset = reset ? 0 : conversationState.value.offset
  conversationsLoading.value = true
  conversationsStatus.value = 'pending'
  try {
    const page = await fetchConversations(offset, MAIL_PAGE_SIZE)
    conversations.value = reset ? page : mergeConversations(conversations.value, page)
    conversationState.value = nextPageState({ offset, done: false }, page.length, MAIL_PAGE_SIZE)
    conversationsStatus.value = 'success'
  } catch {
    // A mailbox that is not indexed yet answers 409 and has no conversations
    if (reset) {
      conversations.value = []
      conversationState.value = { offset: 0, done: true }
    }
    conversationsStatus.value = 'success'
  } finally {
    conversationsLoading.value = false
  }
}

/** Reload the depth already loaded, page by page, e.g. after unread flags changed */
async function reloadConversations() {
  if (!showThreads.value) {
    return
  }

  const pages = Math.max(1, Math.ceil(conversationState.value.offset / MAIL_PAGE_SIZE))
  conversationsLoading.value = true
  conversationsStatus.value = 'pending'
  try {
    const results = await Promise.all(restoreRequests(pages, MAIL_PAGE_SIZE).map(offset => fetchConversations(offset, MAIL_PAGE_SIZE)))
    conversations.value = results.reduce<MailConversation[]>((merged, page) => mergeConversations(merged, page), [])
    conversationState.value = {
      offset: conversations.value.length,
      done: (results.at(-1)?.length ?? 0) < MAIL_PAGE_SIZE
    }
    conversationsStatus.value = 'success'
  } catch {
    conversationsStatus.value = 'success'
  } finally {
    conversationsLoading.value = false
  }
}

// Fetch once the view is switched, and again from the start whenever the list
// identity changes. Selection params are not part of it, so opening a
// conversation neither reloads the list nor scrolls it back to the top.
watch([showThreads, listIdentity], () => {
  if (import.meta.client && showThreads.value) {
    conversationListRef.value?.scrollToTop()
    loadConversations(true)
  }
}, { immediate: true })

function openConversation(key: string) {
  updateQuery(mailConversationToQuery(key))
}

function closeConversation() {
  updateQuery(mailConversationToQuery(null))
}

// The panel fetches the same conversation through the same cache, so the hover
// prefetch and the click are one request, not two.
function prefetchConversation(key: string) {
  prefetchMailConversation(nuxtApp, requestFetch, service.value, key)
}

function onConversationSeen() {
  reloadConversationsFromEvents()
  refreshFoldersFromEvents()
}

// Reloading keeps the loaded depth: fetch as many pages as the URL says are shown
function reloadList() {
  basePages.value = list.value.pages
  return refresh()
}

// The refresh button spins while anything runs on its behalf, and its tooltip
// names which one it is
const reloading = computed(() => showThreads.value ? conversationsLoading.value : status.value === 'pending')
const syncing = computed(() => !!currentIndex.value?.syncing)
const refreshing = computed(() => reloading.value || syncing.value || indexing.value)
const refreshTooltip = computed(() => mailRefreshTooltip({
  syncing: syncing.value,
  indexing: indexing.value,
  messages: currentIndex.value?.messages ?? 0,
  reloading: reloading.value
}))

/**
 * Starts a full index sync of the service in the background. The server's
 * per-service lock keeps a second run from starting while one is in flight.
 */
async function startSync(serviceId: string) {
  try {
    await $fetch('/api/mail/sync', { method: 'POST', query: { service: serviceId } })
  } catch (error) {
    toast.add({ title: 'Could not start the sync', description: mailErrorMessage(error), color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

/**
 * Asks the server for new mail, then reloads what the page shows. The lists are
 * read from the local index, so reloading them alone would not fetch new mail;
 * the background sync does that and publishes the events that reload again.
 */
async function refreshMail() {
  // A running sync is left alone; its lock would refuse a second one, and the
  // click still reloads the list on screen
  const sync = indexAvailable.value && !syncing.value ? startSync(service.value) : Promise.resolve()

  await Promise.all([
    showThreads.value ? reloadConversations() : reloadList(),
    refreshNuxtData('mail-folders'),
    sync.then(() => refreshIndexStatus())
  ])
}

const refreshListFromEvents = useDebounceFn(() => reloadList(), 300)
const refreshFoldersFromEvents = useDebounceFn(() => refreshNuxtData('mail-folders'), 300)
const refreshIndexFromEvents = useDebounceFn(() => refreshIndexStatus(), 300)
// A seen-update and the server's own change event both ask for a reload; debounced,
// the two become one and the conversations list is fetched once.
const reloadConversationsFromEvents = useDebounceFn(() => reloadConversations(), 300)

useDomainEvents({ domains: ['mail'] }, (event) => {
  const plan = mailRefreshFor(event, {
    service: service.value,
    mailbox: mailbox.value,
    allFolders: allFolders.value
  })
  if (plan.list) {
    // Refresh only the list on screen; the other view fetches fresh when opened
    if (showThreads.value) {
      reloadConversationsFromEvents()
    } else {
      refreshListFromEvents()
    }
  }
  if (plan.folders) {
    refreshFoldersFromEvents()
  }
  if (plan.indexStatus) {
    refreshIndexFromEvents()
  }
}, {
  onReconnect: () => {
    refreshListFromEvents()
    refreshFoldersFromEvents()
    refreshIndexStatus()
  }
})

// Sender suggestions for the `from` control, from the index facets; null without an index
const facetsQuery = computed(() => ({
  service: service.value,
  scope: allFolders.value ? 'all' : undefined,
  mailbox: allFolders.value ? undefined : mailbox.value,
  ...mailSearchToApiQuery({ ...criteria.value, from: undefined })
}))

const { data: facets, refresh: refreshFacets } = await useFetch('/api/mail/facets', {
  query: facetsQuery,
  // The automatic query watcher cannot tell a filter change from a selection
  // change (both rewrite `route.query`), so it is off; the list identity drives it.
  watch: false,
  default: () => null,
  lazy: true
})

watch(listIdentity, () => refreshFacets())
const fromItems = computed(() => (facets.value?.from ?? []).map(item => item.value))

// Append the next page; the loaded depth goes back into the URL so a reload restores it
async function loadMore() {
  if (loadingMore.value || pageState.value.done || !mails.value.length) {
    return
  }

  loadingMore.value = true
  try {
    const page = await $fetch<MailSummary[]>('/api/mail/messages', {
      query: {
        service: service.value,
        scope: allFolders.value ? 'all' : undefined,
        mailbox: allFolders.value ? undefined : mailbox.value,
        limit: MAIL_PAGE_SIZE,
        offset: pageState.value.offset,
        ...mailSearchToApiQuery(criteria.value)
      }
    })
    mails.value = mergePage(mails.value, page)
    pageState.value = nextPageState(pageState.value, page.length, MAIL_PAGE_SIZE)
    const pages = Math.ceil(mails.value.length / MAIL_PAGE_SIZE)
    updateQuery({ pages: pages > 1 ? String(pages) : null })
  } catch {
    // Keep the page state, so the next scroll retries the same page
  } finally {
    loadingMore.value = false
  }
}

// The open mail lives in the URL (`?uid=&in=`); `in` names a folder outside the current one
const selection = computed(() => mailSelectionFromQuery(route.query, mailbox.value))
const selectionKey = computed(() => selection.value && `${selection.value.mailbox}:${selection.value.uid}`)

// The list as it should render: fetched mails plus the ones the unread filter dropped
const visibleList = computed(() => visibleMails(mails.value, retained.value, criteria.value))

// A linked mail may not be in the current list, e.g. outside the loaded pages
const { data: linkedMail } = await useAsyncData(
  () => `mail-linked:${service.value}:${selectionKey.value ?? ''}`,
  () => selection.value && !mails.value.some(mail => isSelectedMail(mail, selection.value))
    ? requestFetch(`/api/mail/messages/${selection.value.uid}`, { query: { service: service.value, mailbox: selection.value.mailbox } }).catch(() => null)
    : Promise.resolve(null)
)

const selectedMail = computed<MailSummary | null>({
  get: () => visibleList.value.find(mail => isSelectedMail(mail, selection.value)) ?? linkedMail.value ?? null,
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

watch(() => selectedMail.value && mailKey(selectedMail.value), (key) => {
  // Leaving the previously open mail: let it go after the delay
  const previous = openRetainedKey
  if (previous && previous !== key) {
    release(retained.value, previous, Date.now())
    scheduleRetentionExpire(previous)
    openRetainedKey = null
  }

  const mail = selectedMail.value
  const held = key ? retained.value.get(key) : undefined

  // Keep it visible while open; also when a released mail is opened again
  if (key && criteria.value.unread && mail && (mail.unread || held)) {
    retain(retained.value, mail)
    openRetainedKey = key
  }

  if (mail?.unread) {
    setSeen(mail, true)
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

/**
 * Flip the read state of a mail picked from a list's context menu. The open
 * mail going to unread closes the reader, like the reader's own "Mark as
 * unread" does; any other mail is set to seen = was unread.
 */
function toggleUnread(mail: MailSummary) {
  const open = selectedMail.value
  if (open && mailKey(open) === mailKey(mail) && !mail.unread) {
    markUnread()
    return
  }

  setSeen(mail, mail.unread)
  if (showThreads.value) {
    reloadConversationsFromEvents()
  }
}

// --- Composing ---

// The composer rides on `?compose=` and, for a reply, the `uid`/`in` of the mail it answers
const composeQuery = computed(() => mailComposeFromQuery(route.query, mailbox.value))
const composeStorageKey = computed(() => composeQuery.value ? composeDraftKey(composeQuery.value) : undefined)
const composeTitle = computed(() => {
  const mode = composeQuery.value?.mode
  return mode === 'reply' || mode === 'replyAll' ? 'Reply' : mode === 'forward' ? 'Forward' : 'New mail'
})
const composeDraft = ref<OutgoingMail | null>(null)
const sending = ref(false)

const isComposerOpen = computed({
  get: () => !!composeQuery.value,
  set: (value: boolean) => {
    if (!value) {
      closeCompose()
    }
  }
})

const ownAddresses = computed(() => mailAddresses.value?.addresses.length
  ? mailAddresses.value.addresses
  : (ownAddress.value ? [ownAddress.value] : []))

/** The From address a fresh mail starts from: the setup address */
const defaultFrom = computed(() => mailAddresses.value?.default ?? ownAddress.value)

/**
 * Loads the account's sendable addresses when they are not in yet. A lazy
 * useFetch may still be on its way when the composer opens — a reload with
 * `?compose=reply…` in the URL, or a quick click — and building a draft from the
 * half list would send from the login and let a reply-all address an own alias.
 * Errors are swallowed; the setup-address fallback stands.
 */
async function ensureMailAddresses(): Promise<void> {
  if (mailAddresses.value?.addresses.length) {
    return
  }
  try {
    await refreshMailAddresses()
  } catch {
    // The setup address is the fallback
  }
}

// One full-message request per mail, shared by the reader, the composer and its
// hover prefetch; the cache lives in `useMailMessage`
function mailMessage(uid: number, fromMailbox: string): Promise<MailMessage> {
  return loadMailMessage(nuxtApp, requestFetch, service.value, fromMailbox, uid)
}

/** Warm the reader for a mail the list points at, on hover and around the arrow keys */
function prefetchMessage(mail: MailSummary) {
  prefetchMailMessage(nuxtApp, requestFetch, service.value, mail.mailbox, mail.uid)
}

function openCompose(mode: MailComposeMode, mail?: MailSummary) {
  updateQuery(mailComposeToQuery(
    mode === 'new' || !mail ? { mode: 'new' } : { mode, uid: mail.uid, mailbox: mail.mailbox },
    mailbox.value
  ))
}

/** The unsent draft stays in sessionStorage, so reopening restores it */
function closeCompose() {
  composeDraft.value = null
  updateQuery(mailComposeToQuery(null, mailbox.value))
}

function discardCompose() {
  if (composeStorageKey.value) {
    clearMailDraft(composeStorageKey.value)
  }
  closeCompose()
}

function prefetchCompose(mode: MailComposeMode) {
  // Warm the From list with the mail itself, so opening the composer is instant
  void ensureMailAddresses()

  const mail = selectedMail.value
  if (!mail || mode === 'new') {
    return
  }
  mailMessage(mail.uid, mail.mailbox).catch(() => {})
}

watch(composeQuery, async (compose) => {
  if (!compose) {
    composeDraft.value = null
    return
  }

  // The address list decides the reply sender and which own addresses a
  // reply-all drops, so it must be there before either draft is built
  await ensureMailAddresses()

  if (compose.mode === 'new' || !compose.uid) {
    composeDraft.value = { ...emptyOutgoingMail(), from: defaultFrom.value }
    return
  }

  composeDraft.value = null
  try {
    const message = await mailMessage(compose.uid, compose.mailbox ?? mailbox.value)
    composeDraft.value = buildReply(message, ownAddresses.value, compose.mode)
  } catch {
    toast.add({ title: 'Could not load the mail', color: 'error', icon: 'i-lucide-circle-alert' })
    closeCompose()
  }
}, { immediate: true })

async function sendCompose(mail: OutgoingMail) {
  const compose = composeQuery.value
  sending.value = true
  try {
    await $fetch('/api/mail/send', {
      method: 'POST',
      query: { service: service.value },
      body: {
        ...mail,
        reply: compose && compose.uid && compose.mode !== 'new'
          ? { mailbox: compose.mailbox ?? mailbox.value, uid: compose.uid }
          : undefined
      }
    })
    toast.add({ title: 'Mail sent', color: 'success', icon: 'i-lucide-send' })
    if (composeStorageKey.value) {
      clearMailDraft(composeStorageKey.value)
    }
    closeCompose()
  } catch (error) {
    toast.add({ title: 'Could not send mail', description: mailErrorMessage(error), color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    sending.value = false
  }
}

// --- Deleting ---

// The mailboxes of the account the list is showing. The trash of the deleted
// mail's mailbox decides whether a delete moves it or removes it for good.
const mailboxes = computed(() => folders.value.find(entry => entry.service.id === service.value)?.mailboxes ?? [])

/** Whether deleting this mail is permanent: its mailbox is the trash, or the account has none */
function isPermanentDelete(mail: MailSummary): boolean {
  return !trashTarget(mailboxes.value, mail.mailbox)
}

/** What an optimistic delete took away, so a failure or an undo can put it back */
interface DeleteSnapshot {
  mail: MailSummary
  /** Its place in the loaded list; -1 when it was not in it, e.g. a linked mail */
  listIndex: number
  /** The unread-retention entry it had, if any */
  retained?: RetainedMail
  /** Its place among the conversations, for the single-mail conversation it emptied */
  conversationIndex: number
  conversation?: MailConversation
}

/** Forget a retained mail: its timer and its entry */
function forgetRetention(key: string) {
  const timer = retentionTimers.get(key)
  if (timer) {
    clearTimeout(timer)
    retentionTimers.delete(key)
  }
  if (retained.value.has(key)) {
    retained.value.delete(key)
    // delete() mutates the map in place; hand the computed a fresh map so it re-runs
    retained.value = new Map(retained.value)
  }
}

/** Put back what an optimistic delete removed: the list entry, its retention and its conversation */
function restoreMail(snapshot: DeleteSnapshot, mail = snapshot.mail) {
  const key = mailKey(mail)

  if (snapshot.listIndex >= 0 && !mails.value.some(item => mailKey(item) === key)) {
    const next = [...mails.value]
    next.splice(Math.min(snapshot.listIndex, next.length), 0, mail)
    mails.value = next
  }

  if (snapshot.retained && !retained.value.has(key)) {
    retained.value.set(key, { ...snapshot.retained, mail })
    retained.value = new Map(retained.value)
  }

  if (snapshot.conversation && !conversations.value.some(item => item.key === snapshot.conversation!.key)) {
    const next = [...conversations.value]
    next.splice(Math.min(snapshot.conversationIndex, next.length), 0, snapshot.conversation)
    conversations.value = next
  }
}

const confirmState = reactive({ open: false, title: '', description: '', confirmLabel: 'Confirm', action: undefined as (() => void) | undefined })

function askConfirm(title: string, description: string, confirmLabel: string, action: () => void) {
  Object.assign(confirmState, { open: true, title, description, confirmLabel, action })
}

function runConfirm() {
  confirmState.action?.()
  confirmState.open = false
}

/** Moves a trashed mail back to where it came from and puts it back in the list */
async function undoDelete(snapshot: DeleteSnapshot, result: { trashMailbox?: string, trashUid?: number }): Promise<void> {
  if (!result.trashMailbox || !result.trashUid) {
    // Without the trash UID the moved mail cannot be addressed; reloading shows it back
    reloadList()
    return
  }

  try {
    const moved = await $fetch<{ uid?: number }>(`/api/mail/messages/${result.trashUid}/move`, {
      method: 'POST',
      query: { service: service.value, mailbox: result.trashMailbox },
      body: { target: snapshot.mail.mailbox }
    })
    restoreMail(snapshot, { ...snapshot.mail, uid: moved.uid ?? snapshot.mail.uid })
    refreshNuxtData('mail-folders')
  } catch (error) {
    toast.add({ title: 'Could not undo', description: mailErrorMessage(error), color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

/**
 * Deletes one mail, optimistically: it leaves the list (and the unread-retention
 * state and the conversations) at once, the neighbour opens, and only then the
 * API is asked. A failure puts the mail and the selection back; a move to the
 * trash offers an undo for five seconds. A permanent delete is confirmed first
 * and has no undo.
 */
async function deleteMail(mail: MailSummary, confirmed = false): Promise<void> {
  if (isPermanentDelete(mail) && !confirmed) {
    askConfirm('Delete forever?', 'This mail will be removed permanently and cannot be restored.', 'Delete forever', () => void deleteMail(mail, true))
    return
  }

  const key = mailKey(mail)
  // The neighbour is read before the list changes
  const next = nextSelection(visibleList.value, key)
  const conversationIndex = conversations.value.findIndex(item => item.count === 1 && mailKey(item.latest) === key)
  const snapshot: DeleteSnapshot = {
    mail,
    listIndex: mails.value.findIndex(item => mailKey(item) === key),
    retained: retained.value.get(key),
    conversationIndex,
    conversation: conversationIndex >= 0 ? conversations.value[conversationIndex] : undefined
  }

  mails.value = removeFromList(mails.value, key)
  forgetRetention(key)
  if (snapshot.conversation) {
    conversations.value = conversations.value.filter(item => item !== snapshot.conversation)
  }
  selectedMail.value = next

  try {
    const result = await $fetch<{ action: 'trashed' | 'deleted', trashMailbox?: string, trashUid?: number }>(
      `/api/mail/messages/${mail.uid}/delete`,
      { method: 'POST', query: { service: service.value, mailbox: mail.mailbox }, body: { permanent: confirmed } }
    )

    refreshNuxtData('mail-folders')

    if (result.action === 'deleted') {
      toast.add({ title: 'Deleted permanently', color: 'success', icon: 'i-lucide-trash-2' })
      return
    }

    toast.add({
      title: 'Moved to Trash',
      color: 'success',
      icon: 'i-lucide-trash-2',
      duration: 5000,
      actions: [{ label: 'Undo', color: 'neutral', variant: 'link', onClick: () => void undoDelete(snapshot, result) }]
    })
  } catch (error) {
    restoreMail(snapshot)
    selectedMail.value = mail

    // The server refused a permanent delete it was not told to do — ask and retry
    if (mailErrorStatus(error) === 409) {
      askConfirm('Delete forever?', 'This mail will be removed permanently and cannot be restored.', 'Delete forever', () => void deleteMail(mail, true))
      return
    }

    toast.add({ title: 'Could not delete message', description: mailErrorMessage(error), color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

/**
 * # / Delete remove the selected mail, in the list or the reader. A whole
 * conversation is out of scope: with no single mail open there is nothing
 * selected to delete. Backspace does the same; Nuxt UI's defineShortcuts
 * already ignores a focused input, so typing in the search box or the composer
 * never deletes a mail.
 */
function deleteSelectedMail() {
  const mail = selectedMail.value
  if (!mail || isComposerOpen.value) {
    return
  }
  void deleteMail(mail)
}

defineShortcuts({
  '#': deleteSelectedMail,
  'delete': deleteSelectedMail,
  'backspace': deleteSelectedMail
})

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
        <UButton
          label="New mail"
          icon="i-lucide-square-pen"
          size="xs"
          @click="openCompose('new')"
        />
      </template>
    </UDashboardNavbar>

    <UDashboardToolbar class="justify-start">
      <UTabs
        v-model="selectedTab"
        :items="tabItems"
        :content="false"
        size="xs"
      />
    </UDashboardToolbar>

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

      <UDropdownMenu v-if="indexAvailable" :items="viewItems">
        <UTooltip text="View options">
          <UButton
            icon="i-lucide-sliders-horizontal"
            :color="conversationsView ? 'primary' : 'neutral'"
            :variant="conversationsView ? 'soft' : 'ghost'"
            size="sm"
            aria-label="View options"
          />
        </UTooltip>
      </UDropdownMenu>

      <UTooltip :text="refreshTooltip">
        <UButton
          icon="i-lucide-refresh-cw"
          :ui="{ leadingIcon: refreshing ? 'animate-spin' : undefined }"
          color="neutral"
          variant="ghost"
          size="sm"
          aria-label="Refresh"
          @click="refreshMail()"
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

    <MailIndexProgress
      v-for="indexState in indexStatus ?? []"
      :key="indexState.service"
      :status="indexState"
      :name="services.length > 1 ? serviceNames.get(indexState.service) : undefined"
    />

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
      <div v-if="conversationsStatus === 'pending' && !visibleConversationList.length" class="flex items-center justify-center p-8">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-dimmed" />
      </div>
      <UEmpty
        v-else-if="!visibleConversationList.length"
        icon="i-lucide-messages-square"
        title="No conversations"
        description="Nothing matches the current filters."
        variant="naked"
        class="py-12"
      />
      <MailConversationList
        v-else
        ref="conversationListRef"
        :conversations="visibleConversationList"
        :selected-key="conversationKey"
        :service="service"
        :own-address="ownAddress"
        :loading-more="conversationsLoading"
        :done="conversationState.done"
        :is-permanent="isPermanentDelete"
        @select="openConversation"
        @prefetch="prefetchConversation"
        @load-more="loadConversations(false)"
        @compose="(mode, mail) => openCompose(mode, mail)"
        @toggle-unread="toggleUnread"
        @delete="deleteMail($event)"
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
        v-else-if="!visibleList.length && status !== 'pending'"
        :icon="isFiltered ? 'i-lucide-search-x' : 'i-lucide-inbox'"
        :title="isFiltered ? 'No matching messages' : 'No messages'"
        :actions="isFiltered ? [{ label: 'Reset filters', color: 'neutral', variant: 'outline', onClick: resetFilters }] : undefined"
        variant="naked"
        class="py-12"
      />
      <MailList
        v-else
        ref="listRef"
        v-model="selectedMail"
        :mails="visibleList"
        :service="service"
        :selection="selectedMailKeys"
        :show-mailbox="allFolders"
        :mailbox-names="mailboxNames"
        :loading-more="loadingMore"
        :done="pageState.done"
        :is-permanent="isPermanentDelete"
        @load-more="loadMore"
        @update-selection="setSelectedMails"
        @prefetch="prefetchMessage"
        @compose="(mode, mail) => openCompose(mode, mail)"
        @toggle-unread="toggleUnread"
        @delete="deleteMail($event)"
      />
    </template>
  </UDashboardPanel>

  <MailConversation
    v-if="showThreads && conversationKey && !isMobile"
    :key="conversationKey"
    :conversation-key="conversationKey"
    :service="service"
    :own-address="ownAddress"
    :addresses="ownAddresses"
    :sent-mailboxes="sentMailboxes"
    @seen="onConversationSeen"
    @close="closeConversation"
    @compose="(mode, mail) => openCompose(mode, mail)"
    @delete="deleteMail($event)"
  />
  <MailView
    v-else-if="selectedMail && !isMobile"
    :key="selectedMail.uid"
    :mail="selectedMail"
    :service="service"
    :permanent="isPermanentDelete(selectedMail)"
    @close="selectedMail = null"
    @mark-unread="markUnread"
    @delete="selectedMail && deleteMail(selectedMail)"
    @compose="openCompose($event, selectedMail ?? undefined)"
    @prefetch="prefetchCompose"
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
          :addresses="ownAddresses"
          :sent-mailboxes="sentMailboxes"
          @seen="onConversationSeen"
          @close="closeConversation"
          @compose="(mode, mail) => openCompose(mode, mail)"
          @delete="deleteMail($event)"
        />
        <MailView
          v-else-if="selectedMail"
          :key="selectedMail.uid"
          :mail="selectedMail"
          :service="service"
          :permanent="isPermanentDelete(selectedMail)"
          @close="selectedMail = null"
          @mark-unread="markUnread"
          @delete="selectedMail && deleteMail(selectedMail)"
          @compose="openCompose($event, selectedMail ?? undefined)"
          @prefetch="prefetchCompose"
        />
      </template>
    </USlideover>
  </ClientOnly>

  <MailComposer
    v-if="composeDraft"
    :open="isComposerOpen"
    :mail="composeDraft"
    :addresses="ownAddresses"
    :title="composeTitle"
    :draft-key="composeStorageKey"
    :sending="sending"
    @update:open="isComposerOpen = $event"
    @send="sendCompose"
    @discard="discardCompose"
  />

  <UModal v-model:open="confirmState.open" :title="confirmState.title">
    <template #body>
      <p class="text-sm text-muted">
        {{ confirmState.description }}
      </p>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          @click="confirmState.open = false"
        />
        <UButton :label="confirmState.confirmLabel" color="error" @click="runConfirm" />
      </div>
    </template>
  </UModal>
</template>
