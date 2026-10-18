<script setup lang="ts">
import type { AuthFormField, FormSubmitEvent } from '@nuxt/ui'
import { z } from 'zod'
import type { AuthState } from '#layers/core/shared/types/auth'
import { postLoginRedirect } from '../utils/auth'

definePageMeta({ layout: false })

const route = useRoute()
const { fetch: fetchSession } = useUserSession()

const { data: state } = await useFetch<AuthState>('/api/auth/state', {
  key: 'auth-state',
  default: () => ({ hasUser: false })
})
const hasUser = computed(() => state.value?.hasUser ?? false)

useSeoMeta({ title: () => hasUser.value ? 'Sign in' : 'Create your account' })

const loginSchema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password')
})

const setupSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(100),
  email: z.email('Enter a valid email address'),
  password: z.string().min(12, 'Use at least 12 characters').max(200),
  repeatPassword: z.string().min(1, 'Repeat your password')
}).refine(values => values.password === values.repeatPassword, {
  message: 'Passwords do not match',
  path: ['repeatPassword']
})

type LoginInput = z.output<typeof loginSchema>
type SetupInput = z.output<typeof setupSchema>

const loginFields: AuthFormField[] = [
  { name: 'email', type: 'email', label: 'Email', placeholder: 'you@example.com', required: true },
  { name: 'password', type: 'password', label: 'Password', required: true }
]

const setupFields: AuthFormField[] = [
  { name: 'name', type: 'text', label: 'Name', placeholder: 'Your name', required: true },
  { name: 'email', type: 'email', label: 'Email', placeholder: 'you@example.com', required: true },
  { name: 'password', type: 'password', label: 'Password', help: 'At least 12 characters', required: true },
  { name: 'repeatPassword', type: 'password', label: 'Repeat password', required: true }
]

const pending = ref(false)
const error = ref('')

/** h3 puts the message the route threw into `statusMessage`. */
function errorMessage(cause: unknown): string {
  const body = (cause as { data?: { statusMessage?: string, message?: string } } | undefined)?.data
  return body?.statusMessage || body?.message || 'Something went wrong'
}

async function send(path: string, body: Record<string, unknown>) {
  error.value = ''
  pending.value = true

  try {
    await $fetch(path, { method: 'POST', body })
    await fetchSession()
    await navigateTo(postLoginRedirect(route.query.redirect))
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    pending.value = false
  }
}

async function submitLogin(event: FormSubmitEvent<LoginInput>) {
  await send('/api/auth/login', event.data)
}

async function submitSetup(event: FormSubmitEvent<SetupInput>) {
  await send('/api/auth/setup', event.data)
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-elevated/50 p-4">
    <UAuthForm
      v-if="hasUser"
      class="w-full max-w-sm"
      icon="i-lucide-lock"
      title="Sign in"
      description="Welcome back to Allmight."
      :fields="loginFields"
      :schema="loginSchema"
      :loading="pending"
      :disabled="pending"
      :submit="{ label: 'Sign in' }"
      :on-submit="submitLogin"
    >
      <template #validation>
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :description="error"
        />
      </template>
    </UAuthForm>

    <UAuthForm
      v-else
      class="w-full max-w-sm"
      icon="i-lucide-user-plus"
      title="Create your account"
      description="This account owns the dashboard. It is created once."
      :fields="setupFields"
      :schema="setupSchema"
      :loading="pending"
      :disabled="pending"
      :submit="{ label: 'Create account' }"
      :on-submit="submitSetup"
    >
      <template #validation>
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :description="error"
        />
      </template>
    </UAuthForm>
  </div>
</template>
