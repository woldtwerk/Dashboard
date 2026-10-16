// Proton Drive connector for the drive layer.
// Proton has no public filesystem API in the browser; access goes through the
// official Proton Drive CLI (`proton-drive`), which signs the account in and
// keeps the session.
// The CLI runs as a container (.ddev/proton-drive); the setup wizard signs in
// through its control API and the explorer drives it through the same API
// (see server/proton).
export default defineNuxtConfig({
  runtimeConfig: {
    protonDrive: {
      // NUXT_PROTON_DRIVE_URL — control API of the proton-drive container, e.g. http://proton-drive:8080 in DDEV.
      url: '',
      // NUXT_PROTON_DRIVE_TOKEN — the container's PROTON_DRIVE_CONTROL_TOKEN
      token: ''
    }
  }
})
