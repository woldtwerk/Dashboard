<script setup lang="ts">
import type { SetupField, SetupOption, SetupValue, SetupValues } from '#layers/core/shared/types/setup'

const props = defineProps<{
  field: SetupField
  /** A stored secret exists and will be kept when left empty */
  keepsSecret?: boolean
  /** Connector id, needed to fetch the options of a dynamic field */
  connector?: string
  /** The service being edited; its stored secrets are merged on the server */
  serviceId?: string
  /** Every value of the wizard, across all steps */
  values?: SetupValues
  /** Names of secret fields stored on the server */
  storedSecrets?: string[]
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

/** Typed access to the select fields; the template narrows on `field.type` */
const selectField = computed(() => props.field.type === 'select' ? props.field : undefined)

const autocomplete = computed(() => {
  const field = props.field
  return field.type === 'text' || field.type === 'password' || field.type === 'textarea' ? field.autocomplete : undefined
})

// --- Dynamic options ---

const OPTIONS_DEBOUNCE_MS = 500

const options = ref<SetupOption[]>([])
const loading = ref(false)
const loadError = ref('')
let debounce: ReturnType<typeof setTimeout> | undefined

const ready = computed(() => dependenciesReady(selectField.value ?? {}, props.values ?? {}, props.storedSecrets ?? []))

const items = computed(() => withCurrentOption(
  selectField.value?.dynamic ? options.value : (selectField.value?.options ?? []),
  value.value
))

function errorMessage(error: unknown): string {
  const { data, statusMessage } = error as { data?: { statusMessage?: string, message?: string }, statusMessage?: string }
  return data?.statusMessage || data?.message || statusMessage || 'The options could not be loaded'
}

async function loadOptions() {
  const field = selectField.value
  if (!field?.dynamic || !props.connector) {
    return
  }
  if (!ready.value) {
    // A stale list would belong to the previous endpoint
    options.value = []
    loadError.value = ''
    return
  }

  loading.value = true
  loadError.value = ''
  try {
    options.value = await $fetch<SetupOption[]>('/api/services/options', {
      method: 'POST',
      body: {
        connector: props.connector,
        service: props.serviceId,
        field: field.name,
        values: props.values ?? {}
      }
    })
  } catch (error) {
    options.value = []
    loadError.value = errorMessage(error)
  } finally {
    loading.value = false
  }
}

watch(
  () => (selectField.value?.dependsOn ?? []).map(name => props.values?.[name]),
  () => {
    if (selectField.value?.dynamic) {
      clearTimeout(debounce)
      debounce = setTimeout(loadOptions, OPTIONS_DEBOUNCE_MS)
    }
  }
)

onMounted(loadOptions)
onBeforeUnmount(() => clearTimeout(debounce))

function onCreate(input: string) {
  value.value = input
}

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
    :error="loadError || undefined"
  >
    <USelectMenu
      v-if="field.type === 'select' && !loadError"
      v-model="text"
      :items="items"
      value-key="value"
      :filter-fields="['label', 'description']"
      :loading="loading"
      :disabled="field.dynamic && !ready"
      :create-item="field.allowCustom"
      :placeholder="field.placeholder"
      class="w-full"
      @create="onCreate"
    />

    <UInput
      v-else-if="field.type === 'number'"
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
      :autocomplete="autocomplete ?? (field.secret ? 'new-password' : undefined)"
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
