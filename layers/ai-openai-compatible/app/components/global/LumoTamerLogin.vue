<script setup lang="ts">
import type { SetupValues } from '#layers/core/shared/types/setup'

// Wizard step of the Lumo connector: signs a Proton account in through lumo-tamer
const props = defineProps<{
  values: SetupValues
}>()

const emit = defineEmits<{
  'update:values': [values: SetupValues]
}>()

const form = reactive({ email: '', password: '', totp: '' })
const need = ref<string>()
const error = ref<string>()
const status = ref<'signingIn' | 'starting'>()

const signedIn = computed(() => props.values.email ? String(props.values.email) : undefined)
const buttonLabel = computed(() => status.value === 'signingIn'
  ? 'Signing in…'
  : status.value === 'starting' ? 'Starting the proxy…' : 'Sign in to Lumo')

const captchaHint = 'Proton asks for a captcha, which the proxy cannot solve. Sign in with the container\'s browser method or import a session instead.'

// The proxy restarts once the tokens land, so it stops answering for a moment
async function waitForProxy(): Promise<boolean> {
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const session = await $fetch<{ signedIn?: boolean }>('/api/ai/lumo-tamer/status')
      if (session.signedIn === true) {
        return true
      }
    } catch {
      // Expected while the proxy restarts; try again shortly
    }
    await new Promise(resolve => setTimeout(resolve, 1_000))
  }
  return false
}

async function signIn() {
  status.value = 'signingIn'
  error.value = undefined
  try {
    const values = await $fetch<SetupValues>('/api/ai/lumo-tamer/login', {
      method: 'POST',
      body: { ...form, totp: form.totp || undefined }
    })
    status.value = 'starting'
    const ready = await waitForProxy()
    emit('update:values', values)
    Object.assign(form, { password: '', totp: '' })
    need.value = undefined
    if (!ready) {
      error.value = 'Signed in, but the proxy is not answering yet. Check the container\'s log.'
    }
  } catch (failure) {
    const { data } = failure as { data?: { statusMessage?: string, message?: string, data?: { need?: string } } }
    error.value = data?.statusMessage || data?.message || 'Could not sign in'
    need.value = data?.data?.need ?? need.value
    // A code is only valid once
    form.totp = ''
  } finally {
    status.value = undefined
  }
}

function signInAgain() {
  error.value = undefined
  emit('update:values', { baseUrl: undefined, apiKey: undefined, email: undefined })
}
</script>

<template>
  <div v-if="signedIn" class="flex items-center justify-between gap-4">
    <div class="space-y-2">
      <UAlert
        color="success"
        variant="subtle"
        icon="i-lucide-check-circle"
        :title="`Signed in as ${signedIn}`"
        description="The proxy keeps this account. Continue to save the service."
      />
      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="error"
      />
    </div>
    <UButton
      label="Use another account"
      color="neutral"
      variant="ghost"
      @click="signInAgain"
    />
  </div>

  <form v-else class="space-y-4" @submit.prevent="signIn">
    <UFormField label="Proton address" required>
      <UInput
        v-model="form.email"
        type="email"
        autocomplete="username"
        class="w-full"
      />
    </UFormField>

    <UFormField label="Password" description="Your Proton account password. It goes to the proxy only and is not stored." required>
      <UInput
        v-model="form.password"
        type="password"
        autocomplete="current-password"
        class="w-full"
      />
    </UFormField>

    <UFormField
      v-if="need === 'totp'"
      label="Two-factor code"
      description="From your authenticator app."
      required
    >
      <UInput
        v-model="form.totp"
        inputmode="numeric"
        autocomplete="one-time-code"
        class="w-full"
      />
    </UFormField>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="error"
      :description="need === 'captcha' ? captchaHint : undefined"
    />

    <UButton
      type="submit"
      :label="buttonLabel"
      icon="i-lucide-log-in"
      :loading="status !== undefined"
      :disabled="!form.email || !form.password"
    />
  </form>
</template>
