<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { NotificationCategoryInfo, NotificationStyle } from '#layers/core/shared/types/notifications'
import type { NotificationSettings } from '#layers/core/shared/types/settings'
import { desktopPermissionView, NOTIFICATION_STYLE_ITEMS } from '../../utils/notifications'
import { pushStateView } from '../../utils/web-push'

const toast = useToast()
const { data, save } = useSettings<NotificationSettings>('notifications')
const { permission, requestPermission } = useNotifications()
const { state: pushState, busy: pushBusy, enable: enablePush, disable: disablePush } = usePushSubscription()

const { data: categories } = await useFetch<NotificationCategoryInfo[]>('/api/notifications/categories', {
  key: 'notification-categories',
  default: () => []
})

const doNotDisturb = computed({
  get: () => !!data.value.doNotDisturb,
  set: (value: boolean) => save({ doNotDisturb: value, categories: data.value.categories ?? {} })
})

function styleOf(category: NotificationCategoryInfo): NotificationStyle {
  return data.value.categories?.[category.id] ?? category.defaultStyle
}

function setStyle(category: NotificationCategoryInfo, style: NotificationStyle) {
  void save({
    doNotDisturb: !!data.value.doNotDisturb,
    categories: { ...data.value.categories, [category.id]: style }
  })
}

const columns: TableColumn<NotificationCategoryInfo>[] = [
  { accessorKey: 'label', header: 'Category' },
  { accessorKey: 'description', header: 'Description' },
  { id: 'style', header: 'Delivery' }
]

const desktopPermission = computed(() => desktopPermissionView(permission.value))

const push = computed(() => pushStateView(pushState.value))

async function togglePush(enabled: boolean) {
  if (enabled) {
    await enablePush()
  } else {
    await disablePush()
  }
}

const testing = ref(false)

async function sendTest() {
  testing.value = true
  try {
    await $fetch('/api/notifications/test', { method: 'POST' })
    toast.add({ title: 'Test notification sent', color: 'success', icon: 'i-lucide-bell' })
  } catch {
    toast.add({ title: 'Could not send the test notification', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <div class="max-w-3xl space-y-6">
    <UCard>
      <template #header>
        <div>
          <h2 class="font-semibold text-highlighted">
            Notifications
          </h2>
          <p class="text-sm text-muted">
            Choose how each kind of notification reaches you.
          </p>
        </div>
      </template>

      <UFormField label="Do not disturb" description="Keep notifications in the bell without showing toasts or desktop popups.">
        <USwitch v-model="doNotDisturb" />
      </UFormField>
    </UCard>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <UTable :data="categories" :columns="columns">
        <template #label-cell="{ row }">
          <span class="font-medium text-highlighted">{{ row.original.label }}</span>
        </template>

        <template #description-cell="{ row }">
          <span class="text-sm text-muted">{{ row.original.description }}</span>
        </template>

        <template #style-cell="{ row }">
          <USelect
            :model-value="styleOf(row.original)"
            :items="NOTIFICATION_STYLE_ITEMS"
            value-key="value"
            class="w-36"
            @update:model-value="(value: string) => setStyle(row.original, value as NotificationStyle)"
          />
        </template>

        <template #empty>
          <UEmpty
            icon="i-lucide-bell-off"
            title="No notification categories"
            description="Connect a service to see its notification options here."
            variant="naked"
            class="py-10"
          />
        </template>
      </UTable>
    </UCard>

    <UCard>
      <template #header>
        <div>
          <h2 class="font-semibold text-highlighted">
            Desktop notifications
          </h2>
          <p class="text-sm text-muted">
            The browser asks for permission before notifications can appear outside the dashboard.
          </p>
        </div>
      </template>

      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="text-sm">
          <span class="text-muted">Permission: </span>
          <UBadge
            v-if="desktopPermission.showBadge"
            color="success"
            variant="subtle"
            label="Allowed"
          />
          <span v-else class="font-medium text-highlighted">{{ desktopPermission.label }}</span>
        </div>

        <UButton
          v-if="desktopPermission.showButton"
          label="Allow desktop notifications"
          icon="i-lucide-monitor-check"
          color="neutral"
          variant="outline"
          @click="requestPermission"
        />
      </div>

      <div class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-default pt-4">
        <div class="text-sm">
          <p class="font-medium text-highlighted">
            Push notifications on this device
          </p>
          <p class="text-muted">
            {{ push.label }}
          </p>
        </div>

        <USwitch
          :model-value="push.enabled"
          :disabled="!push.toggleable"
          :loading="pushBusy"
          @update:model-value="togglePush"
        />
      </div>

      <UAlert
        v-if="desktopPermission.hint"
        class="mt-4"
        :color="desktopPermission.status === 'denied' ? 'warning' : 'neutral'"
        variant="subtle"
        icon="i-lucide-info"
        :title="desktopPermission.status === 'denied' ? 'Desktop notifications are blocked' : 'Desktop notifications unavailable'"
        :description="desktopPermission.hint"
      />

      <template #footer>
        <UButton
          label="Send test notification"
          icon="i-lucide-bell-ring"
          :loading="testing"
          @click="sendTest"
        />
      </template>
    </UCard>
  </div>
</template>
