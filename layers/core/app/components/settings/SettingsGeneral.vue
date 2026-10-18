<script setup lang="ts">
import type { GeneralSettings } from '#layers/core/shared/types/settings'

const { data, save } = useSettings<GeneralSettings>('general')

const zones = Intl.supportedValuesOf('timeZone')
const items = zones.map(zone => ({ label: zone, value: zone }))

const browserZone = ref('')
onMounted(() => {
  browserZone.value = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
})

// A stored zone wins; null means "follow the browser"
const selected = computed({
  get: () => data.value.timeZone || browserZone.value,
  set: (timeZone: string) => save({ timeZone })
})

const followsBrowser = computed(() => !data.value.timeZone)
</script>

<template>
  <div class="max-w-xl space-y-6">
    <UCard>
      <template #header>
        <div>
          <h2 class="font-semibold text-highlighted">
            Time zone
          </h2>
          <p class="text-sm text-muted">
            The calendar renders in this zone. By default it follows the browser.
          </p>
        </div>
      </template>

      <UFormField label="Time zone" :description="followsBrowser ? 'Following the browser time zone.' : undefined">
        <USelectMenu
          v-model="selected"
          :items="items"
          value-key="value"
          searchable
          class="w-full"
        />
      </UFormField>

      <template #footer>
        <UButton
          label="Use browser time zone"
          icon="i-lucide-monitor"
          color="neutral"
          variant="ghost"
          :disabled="followsBrowser"
          @click="save({ timeZone: null })"
        />
      </template>
    </UCard>
  </div>
</template>
