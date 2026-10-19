<script setup lang="ts">
import type { SelectItem } from '@nuxt/ui'
import { buildModelChoices } from '#layers/ai/shared/ai-model'
import type { AiServiceModels } from '#layers/ai/shared/types/ai'

const props = defineProps<{
  services: AiServiceModels[]
  loading?: boolean
  disabled?: boolean
  placeholder?: string
}>()

/** The chosen `serviceId:modelId`; the page wires this to the URL */
const model = defineModel<string>({ default: '' })

const items = computed<SelectItem[][]>(() => buildModelChoices(props.services))
</script>

<template>
  <USelectMenu
    v-model="model"
    :items="items"
    :filter-fields="['label', 'description']"
    :loading="loading"
    :disabled="disabled"
    :placeholder="placeholder ?? 'Select a model'"
    value-key="value"
    size="sm"
    color="neutral"
    variant="ghost"
    class="data-[state=open]:bg-elevated"
    :ui="{
      trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200'
    }"
  />
</template>
