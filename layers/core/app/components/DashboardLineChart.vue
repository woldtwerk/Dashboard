<script setup lang="ts">
import { VisAxis, VisCrosshair, VisLine, VisScatter, VisTooltip, VisXYContainer, VisXYLabels } from '@unovis/vue'
import { useElementSize } from '@vueuse/core'
import type { LineChartRow, LineChartSeries } from '../utils/chart'
import { yDomainFromZero } from '../utils/chart'

interface EndLabel {
  x: number
  y: number
  label: string
  color: string
}

const props = withDefaults(defineProps<{
  rows: LineChartRow[]
  series: LineChartSeries[]
  label: string
  tickEvery?: number
  formatTick: (date: string) => string
  formatTooltip: (row: LineChartRow) => string
}>(), {
  tickEvery: 7
})

const chartRef = useTemplateRef<HTMLElement>('chartRef')
const { width } = useElementSize(chartRef)

const x = (_row: LineChartRow, index: number) => index

function yFor(key: string) {
  return (row: LineChartRow) => row.values[key] ?? undefined
}

const tickValues = computed(() => props.rows
  .map((_, index) => index)
  .filter(index => index % props.tickEvery === 0))

function tickFormat(tick: number): string {
  const row = props.rows[Math.round(tick)]
  return row ? props.formatTick(row.date) : ''
}

// A direct label at the end of each line, only while the lines stay readable
const endLabels = computed<EndLabel[]>(() => {
  if (props.series.length > 4) {
    return []
  }
  return props.series.flatMap((series) => {
    for (let index = props.rows.length - 1; index >= 0; index--) {
      const value = props.rows[index]?.values[series.key]
      if (value != null) {
        return [{ x: index, y: value, label: series.label, color: series.color }]
      }
    }
    return []
  })
})

const labelX = (label: EndLabel) => label.x
const labelY = (label: EndLabel) => label.y
const labelText = (label: EndLabel) => label.label
const labelColor = (label: EndLabel) => label.color

const crosshairY = computed(() => props.series.map(series => yFor(series.key)))
const crosshairColors = computed(() => props.series.map(series => series.color))

// Durations always start at zero, so a lone point is not pushed off the plot
const yDomain = computed(() => yDomainFromZero(props.rows.flatMap(row => props.series
  .map(series => row.values[series.key])
  .filter((value): value is number => value != null))))

function template(row?: LineChartRow): string {
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
        {{ item.label }}
      </li>
    </ul>

    <VisXYContainer
      :data="rows"
      :width="width"
      :height="240"
      :margin="{ left: 8, right: 8, top: 8, bottom: 24 }"
      :y-domain="yDomain"
      :aria-label="label"
    >
      <VisLine
        v-for="item in series"
        :key="item.key"
        :x="x"
        :y="yFor(item.key)"
        :color="item.color"
        :line-width="2"
      />

      <!-- A marker per day, so a single day and a gap stay visible -->
      <VisScatter
        v-for="item in series"
        :key="`points-${item.key}`"
        :x="x"
        :y="yFor(item.key)"
        :color="item.color"
        :size="8"
      />

      <VisXYLabels
        v-if="endLabels.length"
        :data="endLabels"
        :x="labelX"
        :y="labelY"
        :label="labelText"
        :color="labelColor"
        :label-font-size="10"
        :clustering="false"
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
        label="seconds"
        :grid-line="true"
        :tick-line="false"
        :domain-line="false"
        :num-ticks="4"
      />

      <VisCrosshair :y="crosshairY" :color="crosshairColors" :template="template" />
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
