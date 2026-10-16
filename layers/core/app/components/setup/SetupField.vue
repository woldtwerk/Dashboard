<script setup lang="ts">
import type { SetupField, SetupValue } from '#layers/core/shared/types/setup'

const props = defineProps<{
  field: SetupField
  /** A stored secret exists and will be kept when left empty */
  keepsSecret?: boolean
}>()

const value = defineModel<SetupValue | undefined>()

const reveal = ref(false)

const text = computed({
  get: () => value.value === undefined ? '' : String(value.value),
  set: (input: string) => {
    value.value = input
  }
})

const checked = computed({
  get: () => value.value === true,
  set: (input: boolean) => {
    value.value = input
  }
})

async function onFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) {
    value.value = (await file.text()).trim()
  }
}
</script>

<template>
  <USwitch
    v-if="field.type === 'switch'"
    v-model="checked"
    :label="field.label"
    :description="field.description"
  />

  <UFormField
    v-else
    :label="field.label"
    :description="field.description"
    :hint="keepsSecret ? 'Leave empty to keep the current value' : undefined"
    :required="field.required && !keepsSecret"
  >
    <UInput
      v-if="field.type === 'number'"
      v-model="value"
      type="number"
      :min="field.min"
      :max="field.max"
      class="w-full"
    />

    <UTextarea
      v-else-if="field.type === 'textarea'"
      v-model="text"
      :placeholder="field.placeholder"
      :rows="4"
      class="w-full"
    />

    <div v-else-if="field.type === 'file'" class="flex flex-col gap-2">
      <UInput
        type="file"
        :accept="field.accept"
        class="w-full"
        @change="onFile"
      />
      <UTextarea
        v-model="text"
        :placeholder="field.placeholder"
        :rows="4"
        class="w-full font-mono"
      />
    </div>

    <UInput
      v-else
      v-model="text"
      :type="field.type === 'password' && !reveal ? 'password' : 'text'"
      :placeholder="field.placeholder"
      :autocomplete="field.autocomplete ?? (field.secret ? 'new-password' : undefined)"
      class="w-full"
      :ui="{ trailing: 'pe-1' }"
    >
      <template v-if="props.field.type === 'password'" #trailing>
        <UButton
          color="neutral"
          variant="link"
          size="sm"
          :icon="reveal ? 'i-lucide-eye-off' : 'i-lucide-eye'"
          :aria-label="reveal ? 'Hide value' : 'Show value'"
          @click="reveal = !reveal"
        />
      </template>
    </UInput>
  </UFormField>
</template>
