<script setup lang="ts">
import type { SetupValues } from '#layers/core/shared/types/setup'

// Wizard step of the Proton Drive connector: starts the CLI sign-in and shows
// the browser URL it prints, then polls until the account is signed in.
const props = defineProps<{
  values: SetupValues
}>()

const emit = defineEmits<{
  'update:values': [values: SetupValues]
}>()

const toast = useToast()
const { copy, copied } = useClipboard()

const signInUrl = ref<string>()
const error = ref<string>()
const starting = ref(false)
let timer: ReturnType<typeof setInterval> | undefined

const signedIn = computed(() => Boolean(props.values.account))

function stopPolling() {
  if (timer) {
    clearInterval(timer)
    timer = undefined
  }
}

async function start() {
  stopPolling()
  starting.value = true
  error.value = undefined
  try {
    const result = await $fetch<{ signInUrl: string }>('/api/proton/drive/login', { method: 'POST' })
    signInUrl.value = result.signInUrl
    poll()
  } catch (failure) {
    error.value = messageOf(failure)
  } finally {
    starting.value = false
  }
}

function poll() {
  stopPolling()
  timer = setInterval(async () => {
    try {
      const status = await $fetch<{ pending: boolean, signedIn: boolean, error?: string | null }>('/api/proton/drive/login-status')
      if (status.signedIn) {
        stopPolling()
        emit('update:values', { account: 'Proton Drive' })
        toast.add({ title: 'Signed in to Proton Drive', color: 'success', icon: 'i-lucide-check-circle' })
      } else if (!status.pending && status.error) {
        stopPolling()
        error.value = status.error
      }
    } catch (failure) {
      stopPolling()
      error.value = messageOf(failure)
    }
  }, 2000)
}

function signInAgain() {
  stopPolling()
  signInUrl.value = undefined
  emit('update:values', { account: undefined })
  start()
}

function messageOf(failure: unknown): string {
  const { data, statusMessage } = failure as { data?: { statusMessage?: string, message?: string }, statusMessage?: string }
  return data?.statusMessage || data?.message || statusMessage || 'Could not start the sign-in'
}

onMounted(() => {
  if (!signedIn.value) {
    start()
  }
})

onBeforeUnmount(stopPolling)
</script>

<template>
  <div v-if="signedIn" class="flex items-center justify-between gap-4">
    <UAlert
      color="success"
      variant="subtle"
      icon="i-lucide-check-circle"
      title="Signed in to Proton Drive"
      description="The CLI container keeps this session. Continue to save the service."
    />
    <UButton
      label="Use another account"
      color="neutral"
      variant="ghost"
      @click="signInAgain"
    />
  </div>

  <div v-else class="space-y-4">
    <div v-if="signInUrl" class="space-y-3">
      <UAlert
        color="info"
        variant="subtle"
        icon="i-lucide-external-link"
        title="Sign in on another device"
        description="Open the link, sign in to Proton, and approve the sign-in. This page continues on its own."
      >
        <template #actions>
          <UButton
            :to="signInUrl"
            target="_blank"
            label="Open sign-in page"
            icon="i-lucide-external-link"
            color="info"
            variant="outline"
            size="xs"
          />
          <UButton
            :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
            :label="copied ? 'Copied' : 'Copy link'"
            color="info"
            variant="ghost"
            size="xs"
            @click="copy(signInUrl)"
          />
        </template>
      </UAlert>

      <div class="flex items-center gap-2 text-sm text-muted">
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
        Waiting for you to finish signing in…
      </div>
    </div>

    <div v-else-if="starting" class="flex items-center gap-2 text-sm text-muted">
      <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
      Starting the sign-in…
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="error"
    />

    <UButton
      label="Start sign-in"
      icon="i-lucide-log-in"
      :loading="starting"
      @click="start"
    />
  </div>
</template>
