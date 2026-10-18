<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { NotificationCategoryInfo, NotificationStyle } from '#layers/core/shared/types/notifications'
import type { NotificationSettings } from '#layers/core/shared/types/settings'
import { NOTIFICATION_STYLE_ITEMS } from '../../utils/notifications'

const toast = useToast()
const { data, save } = useSettings<NotificationSettings>('notifications')
const { permission, requestPermission } = useNotifications()

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

const permissionLabel = computed(() => {
  switch (permission.value) {
    case 'granted':
      return 'Allowed'
    case 'denied':
      return 'Blocked'
    case 'unsupported':
      return 'Not supported by this browser'
    default:
      return 'Not requested yet'
  }
})

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
          <span class="font-medium text-highlighted">{{ permissionLabel }}</span>
        </div>

        <UButton
          label="Allow desktop notifications"
          icon="i-lucide-monitor-check"
          color="neutral"
          variant="outline"
          :disabled="permission === 'granted' || permission === 'denied' || permission === 'unsupported'"
          @click="requestPermission"
        />
      </div>

      <UAlert
        v-if="permission === 'denied'"
        class="mt-4"
        color="warning"
        variant="subtle"
        icon="i-lucide-info"
        title="Desktop notifications are blocked"
        description="Allow them for this site in your browser settings, then reload the page."
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
