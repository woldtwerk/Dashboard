<script setup lang="ts">
import type { EntityRef } from '#layers/core/shared/types/entities'
import { normalizeEmail } from '#layers/core/shared/entities'
import { usePerson } from '../composables/usePerson'

const props = withDefaults(defineProps<{
  email: string
  /** Hide the link to the full people page when already on it */
  linkToPage?: boolean
}>(), {
  linkToPage: true
})

const key = computed(() => normalizeEmail(props.email) ?? props.email)
const { data: person, status } = await usePerson(() => key.value)

const entity = computed<EntityRef>(() => ({ type: 'person', id: key.value }))
const name = computed(() => person.value?.name || key.value)
const emails = computed(() => person.value?.emails?.length ? person.value.emails : [key.value])
const contacts = computed(() => person.value?.contacts ?? [])
const loading = computed(() => status.value === 'pending')
const unknown = computed(() => !loading.value && !person.value)
const initials = computed(() => name.value.split(/\s+/).slice(0, 2).map(part => part.charAt(0).toUpperCase()).join('') || '@')
</script>

<template>
  <div class="space-y-5">
    <div class="flex items-start gap-4">
      <UAvatar :alt="initials" size="3xl" />
      <div class="min-w-0 flex-1">
        <p class="truncate text-lg font-semibold text-highlighted">
          {{ name }}
        </p>
        <ul class="mt-0.5 space-y-0.5">
          <li v-for="address in emails" :key="address" class="truncate text-sm text-muted">
            {{ address }}
          </li>
        </ul>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <GraphLinkButton :entity="entity" />
        <UButton
          v-if="linkToPage"
          label="Open"
          icon="i-lucide-arrow-up-right"
          color="neutral"
          variant="ghost"
          size="sm"
          :to="`/people/${encodeURIComponent(key)}`"
        />
      </div>
    </div>

    <USkeleton v-if="loading" class="h-24 w-full" />

    <template v-else>
      <UAlert
        v-if="unknown || !contacts.length"
        color="neutral"
        variant="subtle"
        icon="i-lucide-contact"
        title="No contact card"
        description="This address is not in any of your address books yet."
        :actions="[{ label: 'Add contact', color: 'primary', variant: 'soft', to: '/contacts?contact=new' }]"
      />

      <div>
        <h3 class="mb-2 text-xs font-semibold uppercase text-muted">
          Related
        </h3>
        <RelatedPanel :entity="entity" />
      </div>
    </template>
  </div>
</template>
