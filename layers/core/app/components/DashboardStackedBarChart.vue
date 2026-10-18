<script setup lang="ts">
import { VisAxis, VisCrosshair, VisStackedBar, VisTooltip, VisXYContainer } from '@unovis/vue'
import { useElementSize } from '@vueuse/core'
import type { StackedChartRow, StackedChartSeries } from '../utils/chart'
import { integerTicks } from '../utils/chart'

const props = withDefaults(defineProps<{
  rows: StackedChartRow[]
  series: StackedChartSeries[]
  label: string
  tickEvery?: number
  integerY?: boolean
  formatTick: (date: string) => string
  formatTooltip: (row: StackedChartRow) => string
}>(), {
  tickEvery: 7,
  integerY: false
})

const chartRef = useTemplateRef<HTMLElement>('chartRef')
const { width } = useElementSize(chartRef)

const x = (_row: StackedChartRow, index: number) => index

const yAccessors = computed(() => props.series.map(series =>
  (row: StackedChartRow) => row.values[series.key] ?? 0))

const colors = computed(() => props.series.map(series => series.color))

const tickValues = computed(() => props.rows
  .map((_, index) => index)
  .filter(index => index % props.tickEvery === 0))

function tickFormat(tick: number): string {
  const row = props.rows[Math.round(tick)]
  return row ? props.formatTick(row.date) : ''
}

// Counts only: explicit integer ticks, every integer up to five
const yTickValues = computed(() => {
  if (!props.integerY) {
    return undefined
  }
  const max = props.rows.reduce((highest, row) => {
    const total = props.series.reduce((sum, series) => sum + (row.values[series.key] ?? 0), 0)
    return Math.max(highest, total)
  }, 0)
  return integerTicks(max)
})

const barPadding = computed(() => {
  const step = width.value / Math.max(1, props.rows.length)
  return step > 0 ? Math.min(0.5, 2 / step) : 0.1
})

function template(row?: StackedChartRow): string {
  return row ? props.formatTooltip(row) : ''
}
</script>

<template>
  <div ref="chartRef" class="w-full">
    <ul class="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      <li
        v-for="item in series"
        :key="item.key"
        class="flex items-center gap-1.5"
      >
        <span class="size-2 shrink-0 rounded-full" :style="{ backgroundColor: item.color }" />
        <UIcon v-if="item.icon" :name="item.icon" class="size-3.5 shrink-0" />
        {{ item.label }}
      </li>
    </ul>

    <VisXYContainer
      :data="rows"
      :width="width"
      :height="240"
      :margin="{ left: 8, right: 8, top: 8, bottom: 24 }"
      :aria-label="label"
    >
      <VisStackedBar
        :x="x"
        :y="yAccessors"
        :color="colors"
        :bar-padding="barPadding"
        :bar-max-width="24"
        :rounded-corners="4"
      />

      <VisAxis
        type="x"
        :tick-values="tickValues"
        :tick-format="tickFormat"
        :grid-line="false"
        :tick-line="false"
        :domain-line="false"
        :tick-text-hide-overlapping="true"
      />
      <VisAxis
        type="y"
        :grid-line="true"
        :tick-line="false"
        :domain-line="false"
        :tick-values="yTickValues"
        :num-ticks="4"
      />

      <VisCrosshair
        :x="x"
        :y="yAccessors"
        :color="colors"
        :template="template"
      />
      <VisTooltip />
    </VisXYContainer>
  </div>
</template>

<style scoped>
.unovis-xy-container {
  --vis-axis-grid-color: var(--ui-border);
  --vis-axis-tick-color: var(--ui-border);
  --vis-axis-tick-label-color: var(--ui-text-muted);
  --vis-crosshair-line-stroke-color: var(--ui-text-muted);
  --vis-crosshair-circle-stroke-color: var(--ui-bg);
  --vis-tooltip-background-color: var(--ui-bg-elevated);
  --vis-tooltip-border-color: var(--ui-border);
  --vis-tooltip-text-color: var(--ui-text-highlighted);

  /* 2px gap between the stacked segments */
  --vis-stacked-bar-stroke-color: var(--ui-bg);
  --vis-stacked-bar-stroke-width: 2px;
}
</style>
