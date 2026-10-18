<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'

withDefaults(defineProps<{
  icon: string
  label: string
  subtitle?: string
  tone?: 'primary' | 'info' | 'warning' | 'error' | 'neutral'
  selected?: boolean
  highlighted?: boolean
  errors?: string[]
  target?: boolean
  /** Width of the card, so decision nodes with many options stay readable */
  width?: string
}>(), {
  tone: 'neutral',
  subtitle: undefined,
  selected: false,
  highlighted: false,
  errors: () => [],
  target: true,
  width: 'w-64'
})

const tones: Record<string, string> = {
  primary: 'border-primary/40 bg-primary/5',
  info: 'border-info/40 bg-info/5',
  warning: 'border-warning/40 bg-warning/5',
  error: 'border-error/40 bg-error/5',
  neutral: 'border-default bg-elevated/60'
}

const iconTones: Record<string, string> = {
  primary: 'bg-primary/15 text-primary',
  info: 'bg-info/15 text-info',
  warning: 'bg-warning/15 text-warning',
  error: 'bg-error/15 text-error',
  neutral: 'bg-elevated text-muted'
}
</script>

<template>
  <div
    :class="[
      width,
      'relative rounded-lg border-2 p-3 shadow-sm transition',
      tones[tone],
      selected ? 'border-primary ring-2 ring-primary/30' : '',
      highlighted ? 'ring-2 ring-warning ring-offset-2 ring-offset-default' : '',
      errors.length ? 'border-error' : ''
    ]"
  >
    <Handle
      v-if="target"
      type="target"
      :position="Position.Left"
      class="!size-2.5 !border-2 !border-default !bg-elevated"
    />

    <div class="flex items-start gap-2">
      <span :class="['flex size-7 shrink-0 items-center justify-center rounded-md', iconTones[tone]]">
        <UIcon :name="icon" class="size-4" />
      </span>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-semibold text-highlighted">
          {{ label }}
        </p>
        <p v-if="subtitle" class="line-clamp-2 text-xs text-muted">
          {{ subtitle }}
        </p>
      </div>
    </div>

    <div v-if="$slots.default" class="mt-2">
      <slot />
    </div>

    <p v-if="errors.length" class="mt-2 rounded bg-error/10 px-2 py-1 text-[11px] text-error">
      {{ errors[0] }}
    </p>

    <slot name="handles" />
  </div>
</template>
