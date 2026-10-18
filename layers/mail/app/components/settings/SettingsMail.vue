<script setup lang="ts">
import { normalizeTrustedImageSender } from '#layers/mail/shared/mail-images'

const { trustedImageSenders, trust, untrust } = useTrustedImageSenders()

const entry = ref('')
const error = ref('')

function add() {
  const normalized = normalizeTrustedImageSender(entry.value)
  if (!normalized) {
    error.value = 'Enter an email address or a domain such as @example.com.'
    return
  }
  if (trustedImageSenders.value.includes(normalized)) {
    error.value = 'This sender is already trusted.'
    return
  }

  error.value = ''
  entry.value = ''
  void trust(normalized)
}

function remove(value: string) {
  void untrust(value)
}
</script>

<template>
  <div class="max-w-xl space-y-6">
    <UCard>
      <template #header>
        <div>
          <h2 class="font-semibold text-highlighted">
            Remote images
          </h2>
          <p class="text-sm text-muted">
            Loading remote images tells the sender that you opened the mail, and when. The images are
            fetched from the sender's server, which can identify you. Trusted senders and domains load
            their images automatically; scripts and plain HTTP content stay blocked either way.
          </p>
        </div>
      </template>

      <div class="space-y-4">
        <div v-if="trustedImageSenders.length" class="divide-y divide-default">
          <div
            v-for="trusted in trustedImageSenders"
            :key="trusted"
            class="flex items-center justify-between gap-2 py-2"
          >
            <span class="min-w-0 truncate text-sm text-highlighted">{{ trusted }}</span>
            <UButton
              label="Remove"
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              size="xs"
              :aria-label="`Stop trusting ${trusted}`"
              @click="remove(trusted)"
            />
          </div>
        </div>
        <p v-else class="text-sm text-muted">
          No senders or domains are trusted yet.
        </p>

        <div class="flex items-start gap-2">
          <UFormField
            label="Add a sender or domain"
            :error="error || undefined"
            class="min-w-0 flex-1"
          >
            <UInput
              v-model="entry"
              icon="i-lucide-at-sign"
              placeholder="someone@example.com or @example.com"
              class="w-full"
              @keyup.enter="add"
            />
          </UFormField>
          <UButton
            label="Add"
            icon="i-lucide-plus"
            :disabled="!entry.trim()"
            class="mt-6"
            @click="add"
          />
        </div>
      </div>
    </UCard>
  </div>
</template>
