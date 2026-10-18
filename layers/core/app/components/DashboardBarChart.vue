<script setup lang="ts">
import { VisAxis, VisCrosshair, VisStackedBar, VisTooltip, VisXYContainer } from '@unovis/vue'
import { useElementSize } from '@vueuse/core'
import type { BarChartPoint } from '../utils/chart'
import { integerTicks } from '../utils/chart'

const props = withDefaults(defineProps<{
  points: BarChartPoint[]
  color: string
  label: string
  tickEvery?: number
  integerY?: boolean
  formatTick: (date: string) => string
  formatTooltip: (point: BarChartPoint) => string
}>(), {
  tickEvery: 7,
  integerY: false
})

const chartRef = useTemplateRef<HTMLElement>('chartRef')
const { width } = useElementSize(chartRef)

const x = (_point: BarChartPoint, index: number) => index
const y = (point: BarChartPoint) => point.value

// Dates every `tickEvery` points instead of one label per bar
const tickValues = computed(() => props.points
  .map((_, index) => index)
  .filter(index => index % props.tickEvery === 0))

function tickFormat(tick: number): string {
  const point = props.points[Math.round(tick)]
  return point ? props.formatTick(point.date) : ''
}

// Counts only: explicit integer ticks, every integer up to five
const yTickValues = computed(() => {
  if (!props.integerY) {
    return undefined
  }
  const max = props.points.reduce((highest, point) => Math.max(highest, point.value), 0)
  return integerTicks(max)
})

// Unovis takes the gap as a fraction of a step; keep it at 2px for any width
const barPadding = computed(() => {
  const step = width.value / Math.max(1, props.points.length)
  return step > 0 ? Math.min(0.5, 2 / step) : 0.1
})

function template(point?: BarChartPoint): string {
  return point ? props.formatTooltip(point) : ''
}
</script>

<template>
  <div ref="chartRef" class="w-full">
    <VisXYContainer
      :data="points"
      :width="width"
      :height="240"
      :margin="{ left: 8, right: 8, top: 8, bottom: 24 }"
      :aria-label="label"
    >
      <VisStackedBar
        :x="x"
        :y="y"
        :color="color"
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
        :y="y"
        :color="color"
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
}
</style>
