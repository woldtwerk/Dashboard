// Payments domain layer: payment requests (EUR) with a unique reference, a
// payee connector holding the bank details, API and UI. The rules that later
// bank-polling and PayPal-mail workflows rely on (references, EPC QR payloads,
// matching) live in plain TypeScript under shared/ with vitest.
export default defineNuxtConfig({
  runtimeConfig: {
    payments: {
      // NUXT_PAYMENTS_TRUSTED_AUTHSERV_IDS — comma-separated authserv-ids whose
      // Authentication-Results header is trusted. Defaults to Proton's servers;
      // verify against a real PayPal mail after deployment.
      trustedAuthservIds: 'mail.protonmail.ch,protonmail.ch,proton.me'
    }
  }
})
