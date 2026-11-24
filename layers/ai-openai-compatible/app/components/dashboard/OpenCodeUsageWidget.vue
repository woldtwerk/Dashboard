<script setup lang="ts">
import type { OpenCodeAccountUsage, OpenCodeUsageMeter, OpenCodeUsageMeterKey } from '#layers/ai-openai-compatible/shared/opencode-usage'
import { formatUntil } from '#layers/core/app/utils/time'
import { useDashboardNow } from '#layers/core/app/composables/useDashboardNow'

const now = useDashboardNow()

const { data: accounts, status } = await useFetch<OpenCodeAccountUsage[]>('/api/ai/opencode-usage', {
  key: 'dashboard-opencode-usage',
  lazy: true,
  default: () => [],
  server: false
})

const loading = computed(() => status.value === 'idle' || status.value === 'pending')
const failed = computed(() => status.value === 'error')

const meterLabels: Record<OpenCodeUsageMeterKey, string> = {
  rolling: '5 hours',
  weekly: 'This week',
  monthly: 'This month'
}

function formatMoney(value: number, currency?: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency ?? 'USD' }).format(value)
}

function meterColor(meter: OpenCodeUsageMeter) {
  return meter.rateLimited ? 'error' : meter.percent >= 80 ? 'warning' : 'primary'
}
</script>

<template>
  <div v-if="loading" class="space-y-2">
    <USkeleton v-for="index in 3" :key="index" class="h-8 w-full" />
  </div>

  <p v-else-if="failed" class="text-sm text-error">
    OpenCode usage could not be loaded.
  </p>

  <div v-else-if="accounts.length" class="space-y-6">
    <section v-for="account in accounts" :key="account.serviceId" class="space-y-3">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="text-sm font-medium text-highlighted">
          {{ account.serviceName }}
        </h3>
        <UBadge
          v-if="account.plan"
          :label="account.plan"
          color="neutral"
          variant="subtle"
          size="sm"
        />
        <UBadge
          v-if="account.balanceUsd !== undefined"
          :label="`${formatMoney(account.balanceUsd, account.currency)} credit`"
          color="neutral"
          variant="subtle"
          size="sm"
        />
      </div>

      <p v-if="account.error" class="text-sm text-error">
        {{ account.error }}
      </p>

      <div v-if="account.meters.length" class="grid gap-3 sm:grid-cols-3">
        <div v-for="meter in account.meters" :key="meter.key" class="space-y-1">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs text-muted">{{ meterLabels[meter.key] }}</span>
            <span class="text-xs font-medium text-highlighted tabular-nums">{{ Math.round(meter.percent) }}%</span>
          </div>
          <UProgress :model-value="meter.percent" :color="meterColor(meter)" size="xs" />
          <p class="flex flex-wrap gap-x-2 text-xs text-muted">
            <span v-if="meter.usedUsd !== undefined && meter.limitUsd !== undefined">
              {{ formatMoney(meter.usedUsd, account.currency) }} of {{ formatMoney(meter.limitUsd, account.currency) }}
            </span>
            <span v-if="meter.resetsAt">
              resets {{ formatUntil(meter.resetsAt, now) }}
            </span>
          </p>
        </div>
      </div>
    </section>
  </div>

  <UEmpty
    v-else
    icon="i-lucide-sparkles"
    title="No OpenCode service"
    description="Connect OpenCode to see its credits and usage."
    variant="naked"
    :actions="[{ label: 'Add service', icon: 'i-lucide-plus', to: '/services/new' }]"
    class="py-8"
  />
</template>
