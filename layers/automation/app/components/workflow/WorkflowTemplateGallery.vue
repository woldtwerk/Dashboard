<script setup lang="ts">
import type { WorkflowTemplate } from '../../../shared/workflow-templates'
import { workflowTemplates } from '../../../shared/workflow-templates'

defineProps<{
  /** The template id currently being added, so its card can show a pending state */
  busy?: string | null
}>()

const emit = defineEmits<{
  select: [template: WorkflowTemplate]
  blank: []
}>()
</script>

<template>
  <div class="space-y-3">
    <div>
      <p class="text-sm font-semibold text-highlighted">
        Start from a template
      </p>
      <p class="text-xs text-muted">
        A template is added disabled and in suggest mode. Preview it on the last 50 items before you enable it.
      </p>
    </div>

    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <button
        v-for="template in workflowTemplates"
        :key="template.id"
        type="button"
        class="flex flex-col rounded-lg border border-default bg-elevated/40 p-4 text-left transition hover:border-primary/60 hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="!!busy"
        :data-testid="`template-${template.id}`"
        @click="emit('select', template)"
      >
        <div class="flex items-start gap-3">
          <span class="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <UIcon :name="template.icon" class="size-5" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold text-highlighted">
              {{ template.name }}
            </p>
            <p class="mt-1 text-xs leading-relaxed text-muted">
              {{ template.description }}
            </p>
          </div>
        </div>
        <div class="mt-4 flex items-center gap-2">
          <UBadge size="sm" variant="subtle" color="neutral">
            {{ template.domain }}
          </UBadge>
          <span v-if="busy === template.id" class="text-xs text-muted">Adding…</span>
        </div>
      </button>

      <button
        type="button"
        class="flex flex-col rounded-lg border border-dashed border-default bg-elevated/20 p-4 text-left transition hover:border-primary/60 hover:bg-elevated/40"
        :disabled="!!busy"
        @click="emit('blank')"
      >
        <div class="flex items-start gap-3">
          <span class="flex size-9 shrink-0 items-center justify-center rounded-md bg-elevated text-muted">
            <UIcon name="i-lucide-plus" class="size-5" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold text-highlighted">
              Blank workflow
            </p>
            <p class="mt-1 text-xs leading-relaxed text-muted">
              Start with a trigger and an end, then build the graph yourself.
            </p>
          </div>
        </div>
      </button>
    </div>
  </div>
</template>
