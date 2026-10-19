<script setup lang="ts">
import type { CreatedMcpToken, McpTokenInfo } from '#layers/core/shared/types/mcp'
import { formatRelative } from '../../utils/time'
import { formatZoned } from '#layers/core/shared/date-format'

useSeoMeta({ title: 'MCP access' })

const toast = useToast()
const now = useDashboardNow()
// Token timestamps are read in the shared zone
const zone = useTimeZone()

const { data: tokens, refresh } = await useFetch<McpTokenInfo[]>('/api/mcp/tokens', { default: () => [] })

const isCreateOpen = ref(false)
const name = ref('')
const scope = ref<'read' | 'write'>('read')
const creating = ref(false)
const created = ref<CreatedMcpToken | null>(null)
const origin = ref('')

const isCreatedOpen = computed({
  get: () => !!created.value,
  set: (open: boolean) => {
    if (!open) {
      created.value = null
    }
  }
})

const snippet = computed(() => {
  const base = origin.value || 'https://<host>'
  return `claude mcp add --transport http allmight ${base}/mcp --header "Authorization: Bearer ${created.value?.token ?? '<token>'}"`
})

const revoking = ref<McpTokenInfo | null>(null)
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
  scope.value = 'read'
  isCreateOpen.value = true
}

async function create() {
  creating.value = true
  try {
    const response = await $fetch<CreatedMcpToken>('/api/mcp/tokens', { method: 'POST', body: { name: name.value, scope: scope.value } })
    origin.value = import.meta.client ? window.location.origin : ''
    created.value = response
    isCreateOpen.value = false
    await refresh()
  } catch {
    toast.add({ title: 'Could not create the token', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    creating.value = false
  }
}

async function revoke() {
  const token = revoking.value
  if (!token) {
    return
  }
  try {
    await $fetch(`/api/mcp/tokens/${token.id}`, { method: 'DELETE' })
    toast.add({ title: `${token.name} revoked`, icon: 'i-lucide-ban' })
    await refresh()
  } catch {
    toast.add({ title: 'Could not revoke the token', color: 'error', icon: 'i-lucide-circle-alert' })
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

const scopeColor = (value: McpTokenInfo['scope']) => value === 'write' ? 'warning' : 'neutral'
</script>

<template>
  <UDashboardPanel id="mcp-access">
    <template #header>
      <UDashboardNavbar title="MCP access">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton icon="i-lucide-plus" label="Create token" @click="openCreate" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-6">
        <UAlert
          icon="i-lucide-triangle-alert"
          color="warning"
          variant="subtle"
          title="Tokens can read and change your data"
          description="A read token can search mail, calendars, contacts, files and documents. A write token can additionally change mail flags and move mails, create or delete calendar events, edit contacts, files and documents. Keep a token secret and revoke it when it leaks."
        />

        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <div v-if="!tokens.length" class="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <UIcon name="i-lucide-key-round" class="size-8 text-dimmed" />
            <p class="text-muted">
              No tokens yet. Create one to connect Claude Code or another MCP client.
            </p>
          </div>

          <ul v-else class="divide-y divide-default">
            <li
              v-for="token in tokens"
              :key="token.id"
              class="flex items-center justify-between gap-3 px-4 py-3 sm:px-6"
            >
              <div class="flex min-w-0 flex-col gap-1">
                <div class="flex items-center gap-2">
                  <p class="truncate font-medium text-highlighted">
                    {{ token.name }}
                  </p>
                  <UBadge
                    :color="scopeColor(token.scope)"
                    variant="subtle"
                    size="sm"
                    class="capitalize"
                  >
                    {{ token.scope }}
                  </UBadge>
                  <UBadge
                    v-if="token.revokedAt"
                    color="error"
                    variant="subtle"
                    size="sm"
                  >
                    revoked
                  </UBadge>
                </div>
                <p class="text-sm text-muted">
                  Created {{ formatZoned(token.createdAt, zone, 'dd MMM yyyy') }}
                  · Last used {{ formatRelative(token.lastUsedAt, now) }}
                </p>
              </div>

              <UButton
                icon="i-lucide-ban"
                label="Revoke"
                color="error"
                variant="ghost"
                :disabled="!!token.revokedAt"
                @click="revoking = token"
              />
            </li>
          </ul>
        </UCard>
      </div>

      <UModal v-model:open="isCreateOpen" title="Create MCP token" description="The token is shown once; store it right away.">
        <template #body>
          <div class="flex flex-col gap-4">
            <UFormField label="Name" description="Where the token is used, e.g. “Claude Code – laptop”" required>
              <UInput v-model="name" class="w-full" placeholder="Claude Code" />
            </UFormField>

            <UFormField label="Scope" description="Write tokens may change mail, calendar, contacts, files and documents.">
              <USelect
                v-model="scope"
                :items="[{ label: 'Read only', value: 'read' }, { label: 'Read and write', value: 'write' }]"
                class="w-full"
              />
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
              :disabled="!name.trim()"
              @click="create"
            />
          </div>
        </template>
      </UModal>

      <UModal v-model:open="isCreatedOpen" title="Token created" description="Copy the token now — it cannot be shown again.">
        <template #body>
          <div class="flex flex-col gap-4">
            <UAlert
              icon="i-lucide-triangle-alert"
              color="warning"
              variant="subtle"
              title="Only shown once"
              description="The dashboard only stores a hash of the token. If you lose it, revoke it and create a new one."
            />

            <div class="flex flex-col gap-1">
              <span class="text-sm font-medium">Token</span>
              <div class="flex items-center gap-2">
                <UInput :model-value="created?.token" readonly class="w-full font-mono" />
                <UButton
                  icon="i-lucide-copy"
                  color="neutral"
                  variant="outline"
                  aria-label="Copy token"
                  @click="copy(created!.token, 'Token')"
                />
              </div>
            </div>

            <div class="flex flex-col gap-1">
              <span class="text-sm font-medium">Add to Claude Code</span>
              <pre class="overflow-x-auto rounded-md bg-elevated p-3 text-xs">{{ snippet }}</pre>
              <UButton
                icon="i-lucide-copy"
                label="Copy command"
                color="neutral"
                variant="outline"
                class="self-start"
                @click="copy(snippet, 'Command')"
              />
            </div>
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
        description="Clients using this token lose access immediately. This cannot be undone."
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
    </template>
  </UDashboardPanel>
</template>
