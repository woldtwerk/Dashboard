// Client access layer: lets other clients on this machine (Thunderbird,
// Evolution, GNOME Calendar, …) use the dashboard's CalDAV, CardDAV, IMAP and
// SMTP through a small nginx proxy, authenticated with the per-device app
// passwords the settings page issues. The Bridge and carbonate passwords never
// leave the containers: the proxy asks this app for the upstream credentials.
//
// The proxy lives in .ddev/docker-compose.client-access.yaml; its nginx
// template is .ddev/client-access/nginx.conf.template.
export default defineNuxtConfig({
  runtimeConfig: {
    clientAccess: {
      // NUXT_CLIENT_ACCESS_SECRET — the same value as CLIENT_ACCESS_SECRET in
      // .ddev/.env.client-access (paired by .ddev/scripts/ensure-secrets.sh).
      // The proxy presents it in X-Client-Access-Secret; the endpoints answer
      // 404 without it.
      secret: ''
    }
  }
})
