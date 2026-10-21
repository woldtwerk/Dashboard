<script setup lang="ts">
import type { SetupField } from '#layers/core/shared/types/setup'
import { normalizePaypalHandle, parsePaypalQrPayload } from '#layers/payments/shared/paypal'

/**
 * The PayPal value, filled in by scanning a PayPal code or typing a name.
 *
 * The camera and the image picker live in `QrScanField`; what makes a code a
 * PayPal link is `parsePaypalQrPayload`, and a typed name or pasted profile
 * link is reduced to the name it carries.
 */
defineProps<{ field?: SetupField }>()

const model = defineModel<string>({ default: '' })
</script>

<template>
  <QrScanField
    v-model="model"
    :parse="parsePaypalQrPayload"
    :normalize="normalizePaypalHandle"
    placeholder="jane-doe"
    unrecognized-title="That is not a PayPal link"
    recognized-title="PayPal name recognized"
  />
</template>
