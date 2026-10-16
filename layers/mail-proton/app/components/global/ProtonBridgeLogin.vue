<script setup lang="ts">
import type { SetupValues } from '#layers/core/shared/types/setup'

// Wizard step of the Proton connector: signs an account in to the Bridge container
const props = defineProps<{
  values: SetupValues
}>()

const emit = defineEmits<{
  'update:values': [values: SetupValues]
}>()

const form = reactive({ username: '', password: '', totp: '', mailboxPassword: '' })
const need = ref<string>()
const error = ref<string>()
const signingIn = ref(false)

const signedIn = computed(() => props.values.account ? String(props.values.user ?? props.values.account) : undefined)

async function signIn() {
  signingIn.value = true
  error.value = undefined
  try {
    const values = await $fetch<SetupValues>('/api/proton/bridge/login', {
      method: 'POST',
      body: { ...form, totp: form.totp || undefined, mailboxPassword: form.mailboxPassword || undefined }
    })
    emit('update:values', values)
    Object.assign(form, { password: '', totp: '', mailboxPassword: '' })
    need.value = undefined
  } catch (failure) {
    const { data } = failure as { data?: { statusMessage?: string, message?: string, data?: { need?: string } } }
    error.value = data?.statusMessage || data?.message || 'Could not sign in'
    need.value = data?.data?.need ?? need.value
    // A code is only valid once
    form.totp = ''
  } finally {
    signingIn.value = false
  }
}

function signInAgain() {
  emit('update:values', { account: undefined, user: undefined, host: undefined, port: undefined, tlsCert: undefined })
}
</script>

<template>
  <div v-if="signedIn" class="flex items-center justify-between gap-4">
    <UAlert
      color="success"
      variant="subtle"
      icon="i-lucide-check-circle"
      :title="`Signed in as ${signedIn}`"
      description="Bridge keeps this account. Continue to save the service."
    />
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
        v-model="form.username"
        autocomplete="username"
        class="w-full"
      />
    </UFormField>

    <UFormField label="Password" description="Your Proton account password. It goes to Bridge only and is not stored." required>
      <UInput
        v-model="form.password"
        type="password"
        autocomplete="current-password"
        class="w-full"
      />
    </UFormField>

    <UFormField label="Two-factor code" description="If two-factor authentication is on, from your authenticator app." :required="need === 'totp'">
      <UInput
        v-model="form.totp"
        inputmode="numeric"
        autocomplete="one-time-code"
        class="w-full"
      />
    </UFormField>

    <UFormField
      v-if="need === 'mailboxPassword'"
      label="Mailbox password"
      description="Accounts in two-password mode need it to decrypt mail."
      required
    >
      <UInput
        v-model="form.mailboxPassword"
        type="password"
        autocomplete="off"
        class="w-full"
      />
    </UFormField>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="error"
    />

    <UButton
      type="submit"
      label="Sign in to Bridge"
      icon="i-lucide-log-in"
      :loading="signingIn"
      :disabled="!form.username || !form.password"
    />
  </form>
</template>
