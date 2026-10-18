<script setup lang="ts">
import type { AiServiceModels } from '#layers/ai/shared/types/ai'
import type { AssistantDomainInfo, AssistantSettings } from '#layers/mail-ai/shared/types/assistant'

const { data, save } = useSettings<AssistantSettings>('assistant')

const { data: domains } = await useFetch<AssistantDomainInfo[]>('/api/mail/ai/domains', {
  key: 'assistant-domains',
  default: () => []
})

// The provider the data would reach, from the same model list the assistant page uses
const { data: aiServices } = useLazyFetch<AiServiceModels[]>('/api/ai/models', { default: () => [] })
const provider = computed(() => {
  const service = aiServices.value[0]
  return service ? `${service.service.name} / ${service.defaultModel}` : undefined
})

const warning = computed(() => `Data from every enabled area is sent to the configured AI provider${
  provider.value ? ` (${provider.value})` : ''
}. Only enable what that provider may see.`)

function isEnabled(domain: string): boolean {
  return (data.value.domains ?? []).includes(domain)
}

function toggle(domain: string, enabled: boolean) {
  const current = data.value.domains ?? []
  const next = enabled
    ? [...new Set([...current, domain])]
    : current.filter(item => item !== domain)

  void save({ domains: next })
}
</script>

<template>
  <div class="max-w-3xl space-y-6">
    <UCard>
      <template #header>
        <div>
          <h2 class="font-semibold text-highlighted">
            Assistant
          </h2>
          <p class="text-sm text-muted">
            Choose which areas the assistant may read.
          </p>
        </div>
      </template>

      <UAlert
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :description="warning"
      />

      <div v-if="domains.length" class="mt-4 divide-y divide-default">
        <div
          v-for="domain in domains"
          :key="domain.domain"
          class="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
        >
          <div>
            <p class="font-medium text-highlighted">
              {{ domain.label }}
            </p>
            <p class="text-sm text-muted">
              {{ domain.toolCount }} {{ domain.toolCount === 1 ? 'tool' : 'tools' }}
            </p>
          </div>

          <USwitch
            :model-value="isEnabled(domain.domain)"
            @update:model-value="(enabled: boolean) => toggle(domain.domain, enabled)"
          />
        </div>
      </div>

      <p v-else class="mt-4 text-sm text-muted">
        No area with tools is available.
      </p>
    </UCard>
  </div>
</template>
