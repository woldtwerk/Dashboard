<script setup lang="ts">
import type { AppNotification } from '#layers/core/shared/types/notifications'

const { notifications, unread, markRead } = useNotifications()
const now = useDashboardNow()
const open = ref(false)

function openNotification(notification: AppNotification) {
  if (!notification.read) {
    void markRead([notification.id])
  }
  open.value = false
  if (notification.to) {
    void navigateTo(notification.to)
  }
}

function markAllRead() {
  void markRead()
}
</script>

<template>
  <UPopover v-model:open="open" :content="{ align: 'end' }">
    <UChip :content="unread" :show="unread > 0" size="md">
      <UButton
        icon="i-lucide-bell"
        color="neutral"
        variant="ghost"
        aria-label="Notifications"
        square
      />
    </UChip>

    <template #content>
      <div class="w-80">
        <div class="flex items-center justify-between gap-3 border-b border-default px-3 py-2">
          <span class="text-sm font-semibold text-highlighted">Notifications</span>
          <UButton
            label="Mark all read"
            size="xs"
            color="neutral"
            variant="ghost"
            :disabled="!unread"
            @click="markAllRead"
          />
        </div>

        <div v-if="notifications.length" class="max-h-96 divide-y divide-default overflow-y-auto">
          <component
            :is="notification.to ? 'NuxtLink' : 'div'"
            v-for="notification in notifications"
            :key="notification.id"
            :to="notification.to"
            class="flex w-full cursor-pointer gap-2 px-3 py-2 text-left hover:bg-elevated/60"
            @click="openNotification(notification)"
          >
            <span
              class="mt-1.5 size-2 shrink-0 rounded-full"
              :class="notification.read ? 'bg-transparent' : 'bg-primary'"
            />
            <span class="min-w-0 flex-1">
              <span class="flex items-baseline justify-between gap-2">
                <span class="truncate text-sm font-medium text-highlighted">{{ notification.title }}</span>
                <span class="shrink-0 text-[11px] text-dimmed">{{ formatRelative(notification.at, now) }}</span>
              </span>
              <span v-if="notification.body" class="mt-0.5 block truncate text-xs text-muted">{{ notification.body }}</span>
            </span>
          </component>
        </div>

        <div v-else class="px-3 py-8 text-center text-sm text-muted">
          Nothing yet.
        </div>
      </div>
    </template>
  </UPopover>
</template>
