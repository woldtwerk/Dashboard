<script setup lang="ts">
import type { SetupField } from '#layers/core/shared/types/setup'
import { parseWeroQrPayload } from '#layers/payments/shared/wero'

/**
 * The Wero share token, filled in by scanning the QR the Wero app shows.
 *
 * The camera and the image picker live in `QrScanField`; what makes a code a
 * Wero request is `parseWeroQrPayload`, and nothing here knows how to read a
 * QR.
 */
defineProps<{ field?: SetupField }>()

const model = defineModel<string>({ default: '' })
</script>

<template>
  <QrScanField
    v-model="model"
    :parse="parseWeroQrPayload"
    placeholder="d6xY21Hybs"
    unrecognized-title="That is not a Wero payment code"
    recognized-title="Wero code recognized"
  />
</template>
