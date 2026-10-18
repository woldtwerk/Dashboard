<script setup lang="ts">
import type { AddressBook, Contact } from '#layers/contacts/shared/types/contacts'
import { contactFormFromContact, contactFormToDraft, contactFormValid, emptyContactForm } from '../utils/contact-form'
import type { ContactDraft, ContactFormModel } from '../utils/contact-form'

const props = withDefaults(defineProps<{
  contact?: Contact | null
  addressBooks: AddressBook[]
  /** Values a brand new contact starts with, e.g. a person opened from mail */
  prefill?: { name?: string, email?: string }
  saving?: boolean
  showActions?: boolean
}>(), {
  contact: null,
  prefill: undefined,
  saving: false,
  showActions: true
})

const emit = defineEmits<{
  submit: [draft: ContactDraft]
  remove: []
  cancel: []
}>()

const form = reactive<ContactFormModel>(emptyContactForm())

function reset() {
  Object.assign(form, props.contact
    ? contactFormFromContact(props.contact)
    : emptyContactForm(props.addressBooks[0]?.url ?? '', props.prefill))
}

watch(
  [() => props.contact, () => props.prefill?.name, () => props.prefill?.email, () => props.addressBooks.length],
  reset,
  { immediate: true }
)

const bookItems = computed(() => props.addressBooks.map(book => ({ label: book.name, value: book.url })))
const canSave = computed(() => contactFormValid(form))

function submit() {
  if (canSave.value) {
    emit('submit', contactFormToDraft(form))
  }
}

defineExpose({ toDraft: () => contactFormToDraft(form), canSave, submit })
</script>

<template>
  <div class="space-y-4">
    <UFormField label="Address book" required>
      <USelect v-model="form.addressBook" :items="bookItems" class="w-full" />
    </UFormField>

    <div class="grid grid-cols-2 gap-3">
      <UFormField label="First name">
        <UInput v-model="form.firstName" class="w-full" />
      </UFormField>
      <UFormField label="Last name">
        <UInput v-model="form.lastName" class="w-full" />
      </UFormField>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <UFormField label="Organization">
        <UInput v-model="form.organization" class="w-full" />
      </UFormField>
      <UFormField label="Job title">
        <UInput v-model="form.jobTitle" class="w-full" />
      </UFormField>
    </div>

    <UFormField label="Birthday">
      <UInput v-model="form.birthday" type="date" class="w-full" />
    </UFormField>

    <UFormField label="Email">
      <div class="space-y-2">
        <div v-for="(email, index) in form.emails" :key="index" class="flex gap-2">
          <UInput
            v-model="email.value"
            type="email"
            placeholder="name@example.com"
            class="flex-1"
          />
          <UInput v-model="email.label" placeholder="label" class="w-24" />
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            aria-label="Remove email"
            @click="form.emails.splice(index, 1)"
          />
        </div>
        <UButton
          label="Add email"
          icon="i-lucide-plus"
          size="xs"
          color="neutral"
          variant="ghost"
          @click="form.emails.push({ value: '', label: '' })"
        />
      </div>
    </UFormField>

    <UFormField label="Phone">
      <div class="space-y-2">
        <div v-for="(phone, index) in form.phones" :key="index" class="flex gap-2">
          <UInput v-model="phone.value" type="tel" class="flex-1" />
          <UInput v-model="phone.label" placeholder="label" class="w-24" />
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            aria-label="Remove phone"
            @click="form.phones.splice(index, 1)"
          />
        </div>
        <UButton
          label="Add phone"
          icon="i-lucide-plus"
          size="xs"
          color="neutral"
          variant="ghost"
          @click="form.phones.push({ value: '', label: '' })"
        />
      </div>
    </UFormField>

    <UFormField label="Address">
      <div class="space-y-2">
        <div v-for="(address, index) in form.addresses" :key="index" class="space-y-2 rounded border border-default p-2">
          <UInput v-model="address.street" placeholder="Street" class="w-full" />
          <div class="flex gap-2">
            <UInput v-model="address.city" placeholder="City" class="flex-1" />
            <UInput v-model="address.country" placeholder="Country" class="flex-1" />
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              aria-label="Remove address"
              @click="form.addresses.splice(index, 1)"
            />
          </div>
        </div>
        <UButton
          label="Add address"
          icon="i-lucide-plus"
          size="xs"
          color="neutral"
          variant="ghost"
          @click="form.addresses.push({ street: '', city: '', country: '', label: '' })"
        />
      </div>
    </UFormField>

    <UFormField label="Notes">
      <UTextarea v-model="form.notes" :rows="3" class="w-full" />
    </UFormField>

    <div v-if="showActions" class="flex items-center justify-between gap-2 pt-2">
      <UButton
        v-if="contact"
        label="Delete"
        icon="i-lucide-trash-2"
        color="error"
        variant="ghost"
        @click="emit('remove')"
      />
      <span v-else />
      <div class="flex gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          @click="emit('cancel')"
        />
        <UButton
          label="Save"
          :loading="saving"
          :disabled="!canSave"
          @click="submit"
        />
      </div>
    </div>
  </div>
</template>
