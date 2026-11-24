<script setup lang="ts">
import type { AutomationDecisionSettings, DecisionProvider } from '#layers/automation-laya/shared/settings'
import { automationDecisionDefaults, DECISION_MODELS } from '#layers/automation-laya/shared/settings'

const { data, save } = useSettings<AutomationDecisionSettings>('automation')
const { data: services } = useServices()

const providerItems = [
  { label: 'Local Laya', value: 'laya', description: 'Runs on this machine. Needs NUXT_LAYA_URL.' },
  { label: 'OpenCode Go', value: 'opencode', description: 'Uses the decision models of your OpenCode subscription.' }
]

const openCodeServices = computed(() => services.value.filter(service => service.connector === 'opencode'))
const serviceItems = computed(() => openCodeServices.value.map(service => ({ label: service.name, value: service.id })))
const modelItems: Array<{ label: string, value: string }> = DECISION_MODELS.map(model => ({ label: model, value: model }))

/** The section with defaults for one that has not loaded yet */
function current(): AutomationDecisionSettings {
  return {
    provider: data.value.provider ?? automationDecisionDefaults.provider,
    service: data.value.service ?? automationDecisionDefaults.service,
    model: data.value.model ?? automationDecisionDefaults.model
  }
}

const provider = computed({
  get: () => current().provider,
  set: (value: DecisionProvider) => save({ ...current(), provider: value })
})

const service = computed({
  get: () => current().service,
  set: (value: string) => save({ ...current(), service: value })
})

const model = computed({
  get: () => current().model,
  set: (value: string) => save({ ...current(), model: value })
})
</script>

<template>
  <div class="max-w-xl space-y-6">
    <UCard>
      <template #header>
        <div>
          <h2 class="font-semibold text-highlighted">
            Decision engine
          </h2>
          <p class="text-sm text-muted">
            The primary engine that answers a workflow's decision nodes. The AI fallback stays available either way.
          </p>
        </div>
      </template>

      <div class="space-y-6">
        <UFormField label="Provider">
          <URadioGroup v-model="provider" :items="providerItems" />
        </UFormField>

        <template v-if="provider === 'opencode'">
          <UFormField
            label="OpenCode service"
            description="The decision calls use the key of this service, set up under Services."
          >
            <USelectMenu
              v-if="openCodeServices.length"
              v-model="service"
              :items="serviceItems"
              value-key="value"
              class="w-full"
              placeholder="Choose a service"
            />
            <div v-else class="space-y-2">
              <p class="text-sm text-muted">
                No OpenCode service is set up yet.
              </p>
              <UButton
                to="/services/new/opencode"
                label="Add an OpenCode service"
                icon="i-lucide-plus"
                size="sm"
              />
            </div>
          </UFormField>

          <UFormField label="Decision model">
            <USelect v-model="model" :items="modelItems" class="w-full" />
          </UFormField>
        </template>
      </div>
    </UCard>
  </div>
</template>
