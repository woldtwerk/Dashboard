<script setup lang="ts">
import type { StepperItem } from '@nuxt/ui'
import type { SetupField, SetupState, SetupValues } from '#layers/core/shared/types/setup'

const props = defineProps<{
  state: SetupState
}>()

const toast = useToast()

const steps = computed(() => [
  ...props.state.wizard.steps,
  { id: 'review', title: 'Review', description: 'Test and save', icon: 'i-lucide-plug-zap' }
])

const stepperItems = computed<StepperItem[]>(() => steps.value.map(({ id, title, description, icon }) => ({ value: id, title, description, icon })))

const stepIndex = ref(0)
const step = computed(() => steps.value[stepIndex.value]!)
const fields = computed(() => props.state.wizard.steps.flatMap(item => item.fields ?? []))

const name = ref(props.state.service?.name ?? props.state.connector.title)
const values = reactive<SetupValues>({ ...props.state.values })

// Mirrors the server rule: stored secrets are only reused for the same target
const sameTarget = computed(() => !!props.state.service
  && (props.state.wizard.bindSecretsTo ?? []).every(field => String(values[field] ?? '') === String(props.state.values[field] ?? '')))

function keepsSecret(field: SetupField) {
  return !!field.secret && sameTarget.value && props.state.storedSecrets.includes(field.name)
}

function isFilled(field: SetupField) {
  const value = values[field.name]
  return field.type === 'switch' || (value !== undefined && value !== '') || keepsSecret(field)
}

const canContinue = computed(() => (step.value.fields ?? []).every(field => !field.required || isFilled(field)))

function summary(field: SetupField): string {
  const value = values[field.name]
  if (field.secret) {
    return value ? 'New value' : keepsSecret(field) ? 'Unchanged' : '-'
  }
  if (field.type === 'switch') {
    return value ? 'Yes' : 'No'
  }
  if (field.type === 'file') {
    return value ? 'Provided' : '-'
  }
  return value === undefined || value === '' ? '-' : String(value)
}

const testing = ref(false)
const saving = ref(false)
const result = ref<{ ok: boolean, message: string } | null>(null)

watch(values, () => {
  result.value = null
})

function errorMessage(error: unknown): string {
  const { data, statusMessage } = error as { data?: { statusMessage?: string, message?: string }, statusMessage?: string }
  return data?.statusMessage || data?.message || statusMessage || 'Something went wrong'
}

async function test() {
  testing.value = true
  try {
    await $fetch('/api/services/test', {
      method: 'POST',
      body: { connector: props.state.connector.id, service: props.state.service?.id, values }
    })
    result.value = { ok: true, message: 'Connection successful.' }
  } catch (error) {
    result.value = { ok: false, message: errorMessage(error) }
  } finally {
    testing.value = false
  }
}

async function save() {
  saving.value = true
  try {
    if (props.state.service) {
      await $fetch(`/api/services/${props.state.service.id}`, { method: 'PUT', body: { name: name.value, values } })
    } else {
      await $fetch('/api/services', { method: 'POST', body: { connector: props.state.connector.id, name: name.value, values } })
    }
    await refreshNuxtData('services')
    toast.add({ title: `${name.value} saved`, color: 'success', icon: 'i-lucide-check-circle' })
    await navigateTo('/services')
  } catch (error) {
    result.value = { ok: false, message: errorMessage(error) }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-2xl flex-col gap-8">
    <UStepper
      :model-value="step.id"
      :items="stepperItems"
      disabled
    />

    <UCard v-if="step.id !== 'review'">
      <div class="space-y-4">
        <p v-if="step.intro" class="text-sm">
          {{ step.intro }}
        </p>

        <ol v-if="step.instructions?.length" class="list-decimal space-y-2 ps-5 text-sm">
          <li v-for="instruction in step.instructions" :key="instruction">
            {{ instruction }}
          </li>
        </ol>

        <div v-if="step.links?.length" class="flex flex-wrap gap-2">
          <UButton
            v-for="link in step.links"
            :key="link.to"
            :to="link.to"
            :label="link.label"
            target="_blank"
            icon="i-lucide-external-link"
            color="neutral"
            variant="outline"
          />
        </div>

        <component
          :is="step.component"
          v-if="step.component"
          :values="values"
          @update:values="(patch: SetupValues) => Object.assign(values, patch)"
        />

        <SetupField
          v-for="field in step.component ? [] : step.fields"
          :key="field.name"
          v-model="values[field.name]"
          :field="field"
          :keeps-secret="keepsSecret(field)"
        />
      </div>
    </UCard>

    <UCard v-else>
      <div class="space-y-4">
        <UFormField label="Name" description="Shown in the dashboard, e.g. to tell accounts apart" required>
          <UInput v-model="name" class="w-full" />
        </UFormField>

        <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <template v-for="field in fields" :key="field.name">
            <dt class="text-muted">
              {{ field.label }}
            </dt>
            <dd class="truncate">
              {{ summary(field) }}
            </dd>
          </template>
        </dl>

        <UAlert
          v-if="result"
          :color="result.ok ? 'success' : 'error'"
          variant="subtle"
          :icon="result.ok ? 'i-lucide-check-circle' : 'i-lucide-circle-alert'"
          :title="result.message"
        />

        <p class="text-sm text-muted">
          Settings are stored encrypted on the server. Secrets are never sent back to the browser.
        </p>
      </div>
    </UCard>

    <div class="flex items-center justify-between">
      <UButton
        v-if="stepIndex > 0"
        label="Back"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        @click="stepIndex--"
      />
      <span v-else />

      <UButton
        v-if="step.id !== 'review'"
        label="Continue"
        trailing-icon="i-lucide-arrow-right"
        :disabled="!canContinue"
        @click="stepIndex++"
      />
      <div v-else class="flex gap-2">
        <UButton
          label="Test connection"
          icon="i-lucide-plug-zap"
          color="neutral"
          variant="outline"
          :loading="testing"
          :disabled="saving"
          @click="test"
        />
        <UButton
          label="Save"
          icon="i-lucide-save"
          :loading="saving"
          :disabled="testing || !name.trim()"
          @click="save"
        />
      </div>
    </div>
  </div>
</template>
