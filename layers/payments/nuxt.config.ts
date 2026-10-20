// Payments domain layer: payment requests (EUR) with a unique reference, a
// payee connector holding the bank details, API and UI. The rules that later
// bank-polling and PayPal-mail workflows rely on (references, EPC QR payloads,
// matching) live in plain TypeScript under shared/ with vitest.
export default defineNuxtConfig({})
