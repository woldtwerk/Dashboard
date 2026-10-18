<script setup lang="ts">
import type { Contact, ContactList } from '#layers/contacts/shared/types/contacts'
import type { ContactDraft } from '../utils/contact-form'
import type { EntityRef, Relation } from '#layers/core/shared/types/entities'
import { contactDisplayName } from '../utils/contact-form'
import { usePerson } from '#layers/core/app/composables/usePerson'

const props = defineProps<{
  relations: Relation[]
  entity: EntityRef
}>()

const toast = useToast()

const contactRef = computed(() => props.relations.find(relation => relation.item.ref.type === 'contact')?.item.ref)
const email = computed(() => props.entity.type === 'person' ? props.entity.id : '')

const { data: contacts } = await useFetch<Contact[]>('/api/contacts' as string, {
  key: 'contacts:related',
  lazy: true,
  default: () => []
})
const { data: addressBooks } = await useFetch<ContactList[]>('/api/contacts/addressbooks' as string, {
  key: 'contacts:related-addressbooks',
  lazy: true,
  default: () => []
})
const { data: person } = await usePerson(() => email.value)

const books = computed(() => addressBooks.value.flatMap(list => list.addressBooks))
const contact = computed(() => {
  const ref = contactRef.value
  return ref ? contacts.value.find(item => item.uid === ref.id) ?? null : null
})
const prefill = computed(() => ({ name: person.value?.name, email: email.value }))
const adding = ref(false)
const saving = ref(false)

function serviceOf(addressBook: string): string | undefined {
  return books.value.find(book => book.url === addressBook)?.service
}

// Optimistic: the list changes at once, the server is told after; a rejection rolls back
async function save(draft: ContactDraft) {
  saving.value = true
  const existing = contact.value
  const input = draft.input
  try {
    if (existing) {
      const snapshot = { ...existing }
      Object.assign(existing, input, { name: contactDisplayName(input) })
      try {
        await $fetch(`/api/contacts/${encodeURIComponent(existing.uid)}` as string, {
          method: 'PUT',
          body: { ...input, service: existing.service, addressBook: existing.addressBook, url: existing.url, etag: existing.etag }
        })
      } catch {
        Object.assign(existing, snapshot)
        throw new Error('update')
      }
    } else {
      const service = serviceOf(draft.addressBook)
      const created = await $fetch<Contact>('/api/contacts' as string, {
        method: 'POST',
        body: { ...input, service, addressBook: draft.addressBook }
      })
      contacts.value = [...contacts.value, created]
    }
    adding.value = false
    toast.add({ title: existing ? 'Contact updated' : 'Contact created', color: 'success', icon: 'i-lucide-check-circle' })
  } catch {
    toast.add({ title: 'Could not save the contact', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    saving.value = false
  }
}

async function remove() {
  const target = contact.value
  if (!target) {
    return
  }
  const snapshot = contacts.value
  contacts.value = contacts.value.filter(item => item.uid !== target.uid)
  adding.value = false
  try {
    await $fetch(`/api/contacts/${encodeURIComponent(target.uid)}` as string, {
      method: 'DELETE',
      body: { service: target.service, addressBook: target.addressBook, url: target.url, etag: target.etag }
    })
    toast.add({ title: 'Contact deleted', color: 'success', icon: 'i-lucide-trash-2' })
  } catch {
    contacts.value = snapshot
    toast.add({ title: 'Could not delete the contact', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}
</script>

<template>
  <div class="rounded-lg border border-default p-3">
    <template v-if="contact || adding">
      <ContactForm
        :contact="contact"
        :address-books="books"
        :prefill="prefill"
        :saving="saving"
        @submit="save"
        @remove="remove"
        @cancel="adding = false"
      />
    </template>

    <div v-else class="space-y-2">
      <p class="text-sm text-muted">
        Not in any address book.
      </p>
      <UButton
        label="Add contact"
        icon="i-lucide-user-plus"
        size="sm"
        :disabled="!books.length"
        @click="adding = true"
      />
    </div>
  </div>
</template>
