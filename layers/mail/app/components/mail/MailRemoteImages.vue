<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui'
import { normalizeEmail } from '#layers/core/shared/entities'
import { hasRemoteImages, trustedImageSender } from '#layers/mail/shared/mail-images'

const props = withDefaults(defineProps<{
  html?: string
  /** The sender's address, e.g. `news@example.com` */
  sender?: string
  /** Entries from the `mail` settings section */
  trusted?: string[]
  /** Loaded for this view only, e.g. after "Load images" */
  allowRemote?: boolean
}>(), {
  trusted: () => [],
  allowRemote: false
})

const emits = defineEmits<{
  'update:allowRemote': [value: boolean]
  'trust': [entry: string]
  'untrust': [entry: string]
}>()

const address = computed(() => normalizeEmail(props.sender))
const domain = computed(() => address.value?.slice(address.value.indexOf('@') + 1))

// The matching entry is shown in the "always loaded" line and stopped again
const trustedEntry = computed(() => trustedImageSender(address.value, props.trusted))
const hasRemote = computed(() => hasRemoteImages(props.html))
const allowed = computed(() => props.allowRemote || !!trustedEntry.value)

const actions = computed<ButtonProps[]>(() => {
  if (!hasRemote.value || allowed.value) {
    return []
  }

  const items: ButtonProps[] = [{
    label: 'Load images',
    color: 'neutral',
    variant: 'outline',
    onClick: () => emits('update:allowRemote', true)
  }]

  if (address.value) {
    items.push({
      label: `Always from ${address.value}`,
      color: 'neutral',
      variant: 'outline',
      onClick: () => emits('trust', address.value!)
    })
  }

  if (domain.value) {
    items.push({
      label: `Always from @${domain.value}`,
      color: 'neutral',
      variant: 'outline',
      onClick: () => emits('trust', `@${domain.value}`)
    })
  }

  return items
})

function stopTrusting() {
  if (trustedEntry.value) {
    emits('untrust', trustedEntry.value)
  }
}
</script>

<template>
  <UAlert
    v-if="hasRemote && !allowed"
    color="neutral"
    variant="subtle"
    icon="i-lucide-image-off"
    title="Remote images are blocked to protect your privacy."
    :actions="actions"
    orientation="horizontal"
    class="rounded-none"
  />
  <p
    v-else-if="trustedEntry"
    class="flex flex-wrap items-center gap-1 border-b border-default py-1.5 text-xs text-dimmed"
  >
    <UIcon name="i-lucide-image" class="size-3.5 shrink-0" />
    <span>Images from <span class="font-medium text-toned">{{ trustedEntry }}</span> are always loaded.</span>
    <UButton
      label="Stop"
      color="neutral"
      variant="link"
      size="xs"
      class="p-0"
      @click="stopTrusting"
    />
  </p>
</template>
