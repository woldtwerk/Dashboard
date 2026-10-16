// Proton Mail connector for the mail layer.
// Proton has no public mail API; access goes through Proton Mail Bridge,
// which decrypts locally and exposes IMAP.
// Bridge runs as a container (.ddev/proton-bridge); the setup wizard signs accounts in
// through its control API (see server/proton/connector.ts).
export default defineNuxtConfig({
  runtimeConfig: {
    protonBridge: {
      // NUXT_PROTON_BRIDGE_URL — control API of the Bridge container, e.g. http://proton-bridge:8080 in DDEV.
      // Its host also serves IMAP.
      url: '',
      // NUXT_PROTON_BRIDGE_TOKEN — the container's BRIDGE_CONTROL_TOKEN
      token: ''
    }
  }
})
