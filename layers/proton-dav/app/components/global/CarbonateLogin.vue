<script setup lang="ts">
import type { SetupValues } from '#layers/core/shared/types/setup'

// Wizard step shared by the Proton Calendar and Contacts connectors: signs an
// account in to the carbonate container and hands back the DAV credentials.
const props = defineProps<{
  values: SetupValues
}>()

const emit = defineEmits<{
  'update:values': [values: SetupValues]
}>()

const form = reactive({ username: '', password: '', totp: '', mailboxPassword: '', verificationToken: '' })
const need = ref<string>()
const verificationUrl = ref<string>()
const error = ref<string>()
const signingIn = ref(false)

const signedIn = computed(() => props.values.account ? String(props.values.account) : undefined)

async function signIn() {
  signingIn.value = true
  error.value = undefined
  try {
    const values = await $fetch<SetupValues>('/api/carbonate/login', {
      method: 'POST',
      body: {
        username: form.username,
        password: form.password,
        totp: form.totp || undefined,
        mailboxPassword: form.mailboxPassword || undefined,
        verificationToken: form.verificationToken || undefined
      }
    })
    emit('update:values', values)
    Object.assign(form, { password: '', totp: '', mailboxPassword: '', verificationToken: '' })
    need.value = undefined
    verificationUrl.value = undefined
  } catch (failure) {
    const { data } = failure as { data?: { statusMessage?: string, message?: string, data?: { need?: string, verificationUrl?: string } } }
    error.value = data?.statusMessage || data?.message || 'Could not sign in'
    need.value = data?.data?.need ?? need.value
    verificationUrl.value = data?.data?.verificationUrl ?? verificationUrl.value
    // A code is only valid once
    form.totp = ''
    form.verificationToken = ''
  } finally {
    signingIn.value = false
  }
}

function signInAgain() {
  emit('update:values', { account: undefined, url: undefined, username: undefined, password: undefined })
}
</script>

<template>
  <div v-if="signedIn" class="flex items-center justify-between gap-4">
    <UAlert
      color="success"
      variant="subtle"
      icon="i-lucide-check-circle"
      :title="`Signed in as ${signedIn}`"
      description="carbonate keeps this session in its container. Continue to save the service."
    />
    <UButton
      label="Use another account"
      color="neutral"
      variant="ghost"
      @click="signInAgain"
    />
  </div>

  <form v-else class="space-y-4" @submit.prevent="signIn">
    <UAlert
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Unreleased bridge"
      description="carbonate is third-party software that talks to Proton's private API. It may break without warning."
    />

    <UFormField label="Proton address" required>
      <UInput v-model="form.username" autocomplete="username" class="w-full" />
    </UFormField>

    <UFormField label="Password" description="Your Proton account password. It goes to carbonate only and is not stored." required>
      <UInput
        v-model="form.password"
        type="password"
        autocomplete="current-password"
        class="w-full"
      />
    </UFormField>

    <UFormField label="Two-factor code" description="If two-factor authentication is on, from your authenticator app.">
      <UInput
        v-model="form.totp"
        inputmode="numeric"
        autocomplete="one-time-code"
        class="w-full"
      />
    </UFormField>

    <UFormField label="Mailbox password" description="Only for accounts in two-password mode; it decrypts your data.">
      <UInput
        v-model="form.mailboxPassword"
        type="password"
        autocomplete="off"
        class="w-full"
      />
    </UFormField>

    <div v-if="need === 'verificationToken'" class="space-y-2">
      <UAlert
        v-if="verificationUrl"
        color="info"
        variant="subtle"
        icon="i-lucide-shield-question"
        title="Proton wants human verification"
        description="Open the link, solve the challenge, and paste the token it gives you."
      >
        <template #actions>
          <UButton
            :to="verificationUrl"
            target="_blank"
            label="Open verification"
            icon="i-lucide-external-link"
            color="info"
            variant="outline"
            size="xs"
          />
        </template>
      </UAlert>

      <UFormField label="Verification token" required>
        <UInput v-model="form.verificationToken" autocomplete="off" class="w-full" />
      </UFormField>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="error"
    />

    <UButton
      type="submit"
      label="Sign in via carbonate"
      icon="i-lucide-log-in"
      :loading="signingIn"
      :disabled="!form.username || !form.password"
    />
  </form>
</template>
