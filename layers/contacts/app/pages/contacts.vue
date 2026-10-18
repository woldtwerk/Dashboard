<script setup lang="ts">
import { breakpointsTailwind, refDebounced, useDebounceFn } from '@vueuse/core'
import type { Contact, ContactList } from '#layers/contacts/shared/types/contacts'
import { contactDisplayName } from '../utils/contact-form'
import type { ContactDraft } from '../utils/contact-form'

defineOptions({ name: 'ContactsPage' })

useSeoMeta({ title: 'Contacts' })

const route = useRoute()
const router = useRouter()
const toast = useToast()

const { data: allServices } = await useServices()
const services = computed(() => allServices.value.filter(item => item.domain === 'contacts'))

if (!services.value.length) {
  await navigateTo('/services/new', { replace: true })
}

const queryString = (key: string) => typeof route.query[key] === 'string' ? route.query[key] as string : undefined

function updateQuery(patch: Record<string, string | null>) {
  router.replace({ query: Object.fromEntries(Object.entries({ ...route.query, ...patch }).filter(([, value]) => value)) })
}

const { data: contactLists } = await useFetch<ContactList[]>('/api/contacts/addressbooks', { default: () => [] })
const addressBooks = computed(() => contactLists.value.flatMap(list => list.addressBooks))

const { data: contacts, refresh } = await useFetch<Contact[]>('/api/contacts', { default: () => [] })

const refreshFromEvents = useDebounceFn(() => refresh(), 300)
useDomainEvents({ domains: ['contacts'] }, (event) => {
  if (contactsRefreshFor(event)) {
    refreshFromEvents()
  }
}, {
  onReconnect: () => refreshFromEvents()
})

// Search lives in the URL; typing is debounced so the history stays clean
const search = ref(queryString('q') ?? '')
const debouncedSearch = refDebounced(search, 300)
watch(debouncedSearch, value => updateQuery({ q: value.trim() || null }))
watch(() => queryString('q'), (value) => {
  if ((value ?? '') !== debouncedSearch.value.trim()) {
    search.value = value ?? ''
  }
})

const filtered = computed(() => contacts.value.filter(contact => matchContact(contact, queryString('q') ?? '')))
const groups = computed(() => groupContacts(filtered.value))

// --- Selection and editor (in the URL) ---

const editorKey = computed(() => queryString('contact'))
const isEditorOpen = computed({
  get: () => !!editorKey.value,
  set: (open: boolean) => {
    if (!open) {
      updateQuery({ contact: null })
    }
  }
})
const selected = computed(() => {
  const key = editorKey.value
  return key && key !== 'new' ? contacts.value.find(contact => contact.uid === key) ?? null : null
})
const saving = ref(false)

const contactForm = useTemplateRef<{
  toDraft: () => ContactDraft
  canSave: boolean
  submit: () => void
}>('contactForm')

function openContact(contact: Contact) {
  updateQuery({ contact: contact.uid })
}

function openNew() {
  updateQuery({ contact: 'new' })
}

async function save() {
  const draft = contactForm.value?.toDraft()
  if (!draft) {
    return
  }
  const input = draft.input
  saving.value = true
  try {
    const existing = selected.value
    if (existing) {
      const snapshot = { ...existing }
      Object.assign(existing, input, { name: contactDisplayName(input) })
      try {
        await $fetch(`/api/contacts/${encodeURIComponent(existing.uid)}`, {
          method: 'PUT',
          body: { ...input, service: existing.service, addressBook: existing.addressBook, url: existing.url, etag: existing.etag }
        })
        await refresh()
      } catch {
        Object.assign(existing, snapshot)
        throw new Error('update')
      }
    } else {
      const service = addressBooks.value.find(book => book.url === draft.addressBook)?.service
      const temp: Contact = {
        uid: `temp-${Date.now()}`,
        addressBook: draft.addressBook,
        service,
        name: contactDisplayName(input),
        ...input,
        emails: input.emails,
        phones: input.phones,
        addresses: input.addresses
      }
      contacts.value = [...contacts.value, temp]
      try {
        const created = await $fetch<Contact>('/api/contacts', { method: 'POST', body: { ...input, service, addressBook: draft.addressBook } })
        contacts.value = contacts.value.map(contact => contact.uid === temp.uid ? created : contact)
        await refresh()
      } catch {
        contacts.value = contacts.value.filter(contact => contact.uid !== temp.uid)
        throw new Error('create')
      }
    }
    isEditorOpen.value = false
    toast.add({ title: existing ? 'Contact updated' : 'Contact created', color: 'success', icon: 'i-lucide-check-circle' })
  } catch {
    toast.add({ title: 'Could not save the contact', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    saving.value = false
  }
}

async function remove() {
  const contact = selected.value
  if (!contact) {
    return
  }
  const snapshot = contacts.value
  contacts.value = contacts.value.filter(item => item.uid !== contact.uid)
  isEditorOpen.value = false
  try {
    await $fetch(`/api/contacts/${encodeURIComponent(contact.uid)}`, {
      method: 'DELETE',
      body: { service: contact.service, addressBook: contact.addressBook, url: contact.url, etag: contact.etag }
    })
    await refresh()
    toast.add({ title: 'Contact deleted', color: 'success', icon: 'i-lucide-trash-2' })
  } catch {
    contacts.value = snapshot
    toast.add({ title: 'Could not delete the contact', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

function initials(contact: Contact): string {
  return contact.name.split(/\s+/).slice(0, 2).map(part => part.charAt(0).toUpperCase()).join('')
}

const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('lg')
</script>

<template>
  <UDashboardPanel
    id="contacts-list"
    :default-size="30"
    :min-size="24"
    :max-size="45"
    resizable
  >
    <UDashboardNavbar title="Contacts">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
      <template #trailing>
        <UBadge :label="filtered.length" variant="subtle" />
      </template>
      <template #right>
        <UButton
          icon="i-lucide-plus"
          label="New"
          size="sm"
          :disabled="!addressBooks.length"
          @click="openNew"
        />
      </template>
    </UDashboardNavbar>

    <UDashboardToolbar>
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="Search contacts..."
        size="sm"
        class="min-w-0 flex-1"
      >
        <template v-if="search" #trailing>
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
    </UDashboardToolbar>

    <UEmpty
      v-if="!contacts.length"
      icon="i-lucide-contact"
      title="No contacts"
      description="Add a contacts service to see your address books here."
      :actions="[{ label: 'Add service', to: '/services/new', color: 'primary', variant: 'soft' }]"
      variant="naked"
      class="py-12"
    />
    <UEmpty
      v-else-if="!filtered.length"
      icon="i-lucide-search-x"
      title="No matching contacts"
      variant="naked"
      class="py-12"
    />
    <div v-else class="flex-1 overflow-y-auto">
      <template v-for="group in groups" :key="group.letter">
        <div class="sticky top-0 z-10 border-b border-default bg-default/80 px-4 py-1 text-xs font-semibold text-muted backdrop-blur sm:px-6">
          {{ group.letter }}
        </div>
        <button
          v-for="contact in group.contacts"
          :key="contact.uid"
          class="flex w-full items-center gap-3 border-l-2 px-4 py-3 text-left text-sm transition-colors sm:px-6"
          :class="editorKey === contact.uid ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-elevated/50'"
          @click="openContact(contact)"
        >
          <UAvatar :alt="initials(contact)" :src="contact.photo" size="sm" />
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium">{{ contact.name }}</span>
            <span class="block truncate text-xs text-dimmed">{{ contactSubtitle(contact) }}</span>
          </span>
        </button>
      </template>
    </div>
  </UDashboardPanel>

  <div v-if="!isMobile" class="flex flex-1 flex-col overflow-y-auto">
    <div v-if="selected" class="mx-auto w-full max-w-2xl p-6">
      <div class="mb-6 flex items-start gap-4">
        <UAvatar :alt="initials(selected)" :src="selected.photo" size="3xl" />
        <div class="min-w-0 flex-1">
          <h1 class="truncate text-xl font-semibold">
            {{ selected.name }}
          </h1>
          <p v-if="contactSubtitle(selected)" class="text-sm text-muted">
            {{ contactSubtitle(selected) }}
          </p>
        </div>
        <GraphLinkButton :entity="{ type: 'contact', service: selected.service, id: selected.uid }" />
        <UButton
          label="Edit"
          icon="i-lucide-pencil"
          color="neutral"
          variant="outline"
          size="sm"
          @click="openContact(selected)"
        />
      </div>

      <dl class="space-y-4 text-sm">
        <div v-if="selected.emails.length">
          <dt class="mb-1 font-medium text-muted">
            Email
          </dt>
          <dd v-for="email in selected.emails" :key="email.value">
            <a :href="`mailto:${email.value}`" class="text-primary hover:underline">{{ email.value }}</a>
            <span v-if="email.label" class="ms-2 text-xs text-dimmed">{{ email.label }}</span>
          </dd>
        </div>
        <div v-if="selected.phones.length">
          <dt class="mb-1 font-medium text-muted">
            Phone
          </dt>
          <dd v-for="phone in selected.phones" :key="phone.value">
            <a :href="`tel:${phone.value}`" class="hover:underline">{{ phone.value }}</a>
            <span v-if="phone.label" class="ms-2 text-xs text-dimmed">{{ phone.label }}</span>
          </dd>
        </div>
        <div v-if="selected.addresses.length">
          <dt class="mb-1 font-medium text-muted">
            Address
          </dt>
          <dd v-for="(address, index) in selected.addresses" :key="index">
            {{ [address.street, address.city, address.region, address.postalCode, address.country].filter(Boolean).join(', ') }}
          </dd>
        </div>
        <div v-if="selected.birthday">
          <dt class="font-medium text-muted">
            Birthday
          </dt>
          <dd>{{ selected.birthday }}</dd>
        </div>
        <div v-if="selected.notes">
          <dt class="font-medium text-muted">
            Notes
          </dt>
          <dd class="whitespace-pre-wrap">
            {{ selected.notes }}
          </dd>
        </div>
      </dl>
    </div>
    <div v-else class="flex flex-1 items-center justify-center">
      <UIcon name="i-lucide-contact" class="size-32 text-dimmed" />
    </div>
  </div>

  <USlideover v-model:open="isEditorOpen" :title="selected ? 'Edit contact' : 'New contact'">
    <template #body>
      <ContactForm
        ref="contactForm"
        :contact="selected"
        :address-books="addressBooks"
        :saving="saving"
        :show-actions="false"
      />
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-between">
        <UButton
          v-if="selected"
          label="Delete"
          icon="i-lucide-trash-2"
          color="error"
          variant="ghost"
          @click="remove"
        />
        <span v-else />
        <div class="flex gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="isEditorOpen = false"
          />
          <UButton
            label="Save"
            :loading="saving"
            :disabled="!contactForm?.canSave"
            @click="save"
          />
        </div>
      </div>
    </template>
  </USlideover>
</template>
