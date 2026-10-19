<script setup lang="ts">
import type { AiServiceModels } from '#layers/ai/shared/types/ai'
import type { DecisionFallback } from '#layers/automation/shared/types/automation'

/** One AI fallback entry; the editor writes its `model` (`serviceId:modelId`) */
const entry = defineModel<Extract<DecisionFallback, { type: 'ai' }>>({ required: true })

const services = ref<AiServiceModels[]>([])
const loading = ref(false)
const loaded = ref(false)

/** The model list is only needed when the entry is actually edited, so fetch it lazily */
async function load() {
  if (loaded.value || loading.value) {
    return
  }
  loading.value = true
  try {
    services.value = await $fetch<AiServiceModels[]>('/api/ai/models')
    loaded.value = true
  } catch {
    services.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)

const model = computed({
  get: () => entry.value.model ?? '',
  set: (value: string) => {
    entry.value = { ...entry.value, model: value }
  }
})
</script>

<template>
  <div class="space-y-1">
    <AiModelSelect
      v-model="model"
      :services="services"
      :loading="loading"
      placeholder="Default model"
      @focus="load"
      @click="load"
    />
  </div>
</template>
