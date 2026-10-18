<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

defineProps<{
  collapsed?: boolean
}>()

const { user, clear } = useUserSession()
const signingOut = ref(false)

const initials = computed(() => (user.value?.name ?? '')
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map(part => part[0])
  .join('')
  .toUpperCase())

async function signOut() {
  if (signingOut.value) {
    return
  }
  signingOut.value = true

  try {
    await $fetch('/api/auth/logout', { method: 'POST' })
  } catch {
    // Already signed out on the server; still clear the client below
  }

  await clear()
  await navigateTo('/login')
}

const items = computed<DropdownMenuItem[][]>(() => [[{
  label: 'Sign out',
  icon: 'i-lucide-log-out',
  onSelect: () => {
    void signOut()
  }
}]])
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: 'center', collisionPadding: 12 }"
    :ui="{ content: collapsed ? 'w-56' : 'w-(--reka-dropdown-menu-trigger-width)' }"
  >
    <UButton
      color="neutral"
      variant="ghost"
      block
      :square="collapsed"
      :loading="signingOut"
      class="data-[state=open]:bg-elevated"
    >
      <UAvatar :alt="user?.name" :text="initials" size="2xs" />
      <span v-if="!collapsed" class="min-w-0 flex-1 truncate text-left">{{ user?.name }}</span>
      <UIcon v-if="!collapsed" name="i-lucide-chevrons-up-down" class="shrink-0 text-dimmed" />
    </UButton>

    <template #content-top>
      <div class="px-3 py-2">
        <p class="truncate text-sm font-medium text-highlighted">
          {{ user?.name }}
        </p>
        <p class="truncate text-xs text-muted">
          {{ user?.email }}
        </p>
      </div>
    </template>
  </UDropdownMenu>
</template>
