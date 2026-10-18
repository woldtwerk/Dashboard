<script setup lang="ts">
import type { ServiceInfo } from '#layers/core/shared/types/setup'

useSeoMeta({ title: 'Services' })

const toast = useToast()
const { data: services } = await useServices()

const removing = ref<ServiceInfo | null>(null)
const isRemoveOpen = computed({
  get: () => !!removing.value,
  set: (open: boolean) => {
    if (!open) {
      removing.value = null
    }
  }
})

async function remove() {
  const service = removing.value
  if (!service) {
    return
  }
  try {
    await $fetch(`/api/services/${service.id}`, { method: 'DELETE' })
    await refreshNuxtData('services')
    toast.add({ title: `${service.name} removed`, icon: 'i-lucide-trash-2' })
  } catch {
    toast.add({ title: 'Could not remove service', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    removing.value = null
  }
}
</script>

<template>
  <UDashboardPanel id="services">
    <template #header>
      <UDashboardNavbar title="Services">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            to="/services/mcp"
            icon="i-lucide-key-round"
            label="MCP access"
            color="neutral"
            variant="outline"
          />
          <UButton to="/services/new" icon="i-lucide-plus" label="Add service" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UEmpty
        v-if="!services.length"
        icon="i-lucide-blocks"
        title="No services yet"
        description="Connect mail, drive, calendar and more to bring them into your dashboard."
        :actions="[{ label: 'Add service', icon: 'i-lucide-plus', to: '/services/new' }]"
      />

      <UCard v-else :ui="{ body: 'p-0 sm:p-0' }">
        <ul class="divide-y divide-default">
          <li
            v-for="service in services"
            :key="service.id"
            class="flex items-center justify-between gap-3 px-4 py-3 sm:px-6"
          >
            <div class="flex min-w-0 items-center gap-3">
              <UIcon :name="service.icon || 'i-lucide-plug'" class="size-5 shrink-0" />
              <div class="min-w-0">
                <p class="truncate font-medium text-highlighted">
                  {{ service.name }}
                </p>
                <p class="text-sm text-muted capitalize">
                  {{ service.domain }}
                </p>
              </div>
            </div>

            <div class="flex shrink-0 gap-1">
              <UButton
                :to="`/services/${service.id}`"
                icon="i-lucide-pencil"
                label="Edit"
                color="neutral"
                variant="ghost"
              />
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                aria-label="Remove"
                @click="removing = service"
              />
            </div>
          </li>
        </ul>
      </UCard>

      <UModal
        v-model:open="isRemoveOpen"
        :title="`Remove ${removing?.name}?`"
        description="The stored settings and credentials of this service are deleted."
      >
        <template #footer="{ close }">
          <div class="flex w-full justify-end gap-2">
            <UButton
              label="Cancel"
              color="neutral"
              variant="ghost"
              @click="close"
            />
            <UButton label="Remove" color="error" @click="remove" />
          </div>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
