<script setup lang="ts">
import { APP_PASSWORD_SCOPES } from '#layers/core/shared/types/app-passwords'
import type { AppPasswordInfo, AppPasswordScope, CreatedAppPassword } from '#layers/core/shared/types/app-passwords'
import { formatRelative } from '#layers/core/app/utils/time'

const toast = useToast()
const { user } = useUserSession()
const now = new Date()

// Fixed locale, so the server and the client render the same date
const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' })
const formatDate = (value: string) => dateFormat.format(new Date(value))

const { data: passwords, refresh } = await useFetch<AppPasswordInfo[]>('/api/app-passwords', { default: () => [] })

const email = computed(() => user.value?.email ?? '')

const isCreateOpen = ref(false)
const name = ref('')
const scopeSelection = reactive<Record<AppPasswordScope, boolean>>({ dav: true, mail: true })
const creating = ref(false)
const created = ref<CreatedAppPassword | null>(null)

const selectedScopes = computed(() => APP_PASSWORD_SCOPES.filter(scope => scopeSelection[scope]))

const isCreatedOpen = computed({
  get: () => !!created.value,
  set: (open: boolean) => {
    if (!open) {
      created.value = null
    }
  }
})

const revoking = ref<AppPasswordInfo | null>(null)
const isRevokeOpen = computed({
  get: () => !!revoking.value,
  set: (open: boolean) => {
    if (!open) {
      revoking.value = null
    }
  }
})

function openCreate() {
  name.value = ''
  scopeSelection.dav = true
  scopeSelection.mail = true
  isCreateOpen.value = true
}

async function create() {
  creating.value = true
  try {
    const response = await $fetch<CreatedAppPassword>('/api/app-passwords', {
      method: 'POST',
      body: { name: name.value, scopes: selectedScopes.value }
    })
    created.value = response
    isCreateOpen.value = false
    await refresh()
  } catch {
    toast.add({ title: 'Could not create the app password', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    creating.value = false
  }
}

async function revoke() {
  const password = revoking.value
  if (!password) {
    return
  }
  try {
    await $fetch(`/api/app-passwords/${password.id}`, { method: 'DELETE' })
    toast.add({ title: `${password.name} revoked`, icon: 'i-lucide-ban' })
    await refresh()
  } catch {
    toast.add({ title: 'Could not revoke the app password', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    revoking.value = null
  }
}

async function copy(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.add({ title: `${label} copied`, icon: 'i-lucide-clipboard-check' })
  } catch {
    toast.add({ title: 'Could not copy', color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

const scopeColor = (scope: AppPasswordScope) => scope === 'mail' ? 'info' : 'neutral'
</script>

<template>
  <div class="max-w-3xl space-y-6">
    <UCard>
      <template #header>
        <div>
          <h2 class="font-semibold text-highlighted">
            App passwords
          </h2>
          <p class="text-sm text-muted">
            Let other clients on this machine — Thunderbird, Evolution, GNOME Calendar — use your
            calendars, contacts and mail. Each device gets its own password, which you can revoke
            without touching the others. The real Proton passwords never leave the containers.
          </p>
        </div>
      </template>

      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-muted">
          A password is shown once when it is created; only its hash is stored here.
        </p>
        <UButton icon="i-lucide-plus" label="Create app password" @click="openCreate" />
      </div>
    </UCard>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div v-if="!passwords.length" class="flex flex-col items-center gap-2 px-6 py-12 text-center">
        <UIcon name="i-lucide-key-round" class="size-8 text-dimmed" />
        <p class="text-muted">
          No app passwords yet. Create one for each device you connect.
        </p>
      </div>

      <ul v-else class="divide-y divide-default">
        <li
          v-for="password in passwords"
          :key="password.id"
          class="flex items-center justify-between gap-3 px-4 py-3 sm:px-6"
        >
          <div class="flex min-w-0 flex-col gap-1">
            <div class="flex flex-wrap items-center gap-2">
              <p class="truncate font-medium text-highlighted">
                {{ password.name }}
              </p>
              <UBadge
                v-for="scope in password.scopes"
                :key="scope"
                :color="scopeColor(scope)"
                variant="subtle"
                size="sm"
                class="capitalize"
              >
                {{ scope }}
              </UBadge>
              <UBadge
                v-if="password.revokedAt"
                color="error"
                variant="subtle"
                size="sm"
              >
                revoked
              </UBadge>
            </div>
            <p class="truncate font-mono text-xs text-muted">
              {{ password.prefix }}…
            </p>
            <p class="text-sm text-muted">
              Created {{ formatDate(password.createdAt) }}
              · Last used {{ formatRelative(password.lastUsedAt, now) }}
            </p>
          </div>

          <UButton
            icon="i-lucide-ban"
            label="Revoke"
            color="error"
            variant="ghost"
            :disabled="!!password.revokedAt"
            @click="revoking = password"
          />
        </li>
      </ul>
    </UCard>

    <UCard>
      <template #header>
        <div>
          <h2 class="font-semibold text-highlighted">
            How to connect
          </h2>
          <p class="text-sm text-muted">
            Settings for a CalDAV/CardDAV or mail client. The username is always your account email.
          </p>
        </div>
      </template>

      <div class="space-y-4 text-sm">
        <div>
          <p class="font-medium text-highlighted">
            Calendars and contacts (CalDAV / CardDAV)
          </p>
          <dl class="mt-1 grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 gap-y-1">
            <dt class="text-muted">
              Server URL
            </dt>
            <dd><code>https://dav.allmight.localhost/</code></dd>
            <dt class="text-muted">
              Username
            </dt>
            <dd class="break-all">
              <code>{{ email }}</code>
            </dd>
            <dt class="text-muted">
              Password
            </dt>
            <dd>an app password with the <strong>dav</strong> scope</dd>
          </dl>
        </div>

        <div class="border-t border-default pt-4">
          <p class="font-medium text-highlighted">
            Mail (IMAP / SMTP)
          </p>
          <dl class="mt-1 grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 gap-y-1">
            <dt class="text-muted">
              IMAP server
            </dt>
            <dd><code>127.0.0.1</code> · port <code>1993</code> · SSL/TLS</dd>
            <dt class="text-muted">
              SMTP server
            </dt>
            <dd><code>127.0.0.1</code> · port <code>1465</code> · SSL/TLS</dd>
            <dt class="text-muted">
              Username
            </dt>
            <dd class="break-all">
              <code>{{ email }}</code>
            </dd>
            <dt class="text-muted">
              Password
            </dt>
            <dd>an app password with the <strong>mail</strong> scope</dd>
          </dl>
        </div>
      </div>

      <UAlert
        class="mt-4"
        color="neutral"
        variant="subtle"
        icon="i-lucide-shield-check"
        title="The certificate has to be trusted"
        description="These connections use ddev's local certificate authority. ddev installs it for browsers (mkcert -install); Thunderbird needs it imported once under Settings → Privacy & Security → Certificates → Authorities → Import, from ~/.local/share/mkcert/rootCA.pem."
      />
    </UCard>

    <UModal v-model:open="isCreateOpen" title="Create app password" description="The password is shown once; store it in the device right away.">
      <template #body>
        <div class="flex flex-col gap-4">
          <UFormField label="Name" description="Which device this password is for, e.g. “Thunderbird – laptop”" required>
            <UInput v-model="name" class="w-full" placeholder="Thunderbird – laptop" />
          </UFormField>

          <UFormField label="Scopes" description="What this password may be used for.">
            <div class="flex flex-col gap-2">
              <UCheckbox v-model="scopeSelection.dav" label="Calendars and contacts (CalDAV / CardDAV)" />
              <UCheckbox v-model="scopeSelection.mail" label="Mail (IMAP / SMTP)" />
            </div>
          </UFormField>
        </div>
      </template>

      <template #footer="{ close }">
        <div class="flex w-full justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="close"
          />
          <UButton
            label="Create"
            :loading="creating"
            :disabled="!name.trim() || !selectedScopes.length"
            @click="create"
          />
        </div>
      </template>
    </UModal>

    <UModal v-model:open="isCreatedOpen" title="App password created" description="Copy the password now — it cannot be shown again.">
      <template #body>
        <div class="flex flex-col gap-4">
          <UAlert
            icon="i-lucide-triangle-alert"
            color="warning"
            variant="subtle"
            title="Only shown once"
            description="The dashboard only stores a hash. If you lose it, revoke it and create a new one."
          />

          <div class="flex flex-col gap-1">
            <span class="text-sm font-medium">Password</span>
            <div class="flex items-center gap-2">
              <UInput :model-value="created?.token" readonly class="w-full font-mono" />
              <UButton
                icon="i-lucide-copy"
                color="neutral"
                variant="outline"
                aria-label="Copy password"
                @click="copy(created!.token, 'Password')"
              />
            </div>
          </div>

          <p class="text-sm text-muted">
            Connect with the username <code class="break-all">{{ email }}</code> and this password,
            following the settings in “How to connect”.
          </p>
        </div>
      </template>

      <template #footer="{ close }">
        <div class="flex w-full justify-end">
          <UButton label="Done" @click="close" />
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="isRevokeOpen"
      :title="`Revoke ${revoking?.name}?`"
      description="The device using this password loses access immediately. This cannot be undone."
    >
      <template #footer="{ close }">
        <div class="flex w-full justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="close"
          />
          <UButton label="Revoke" color="error" @click="revoke" />
        </div>
      </template>
    </UModal>
  </div>
</template>
