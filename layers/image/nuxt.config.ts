// Image layer: image derivatives are rendered by imgproxy, cached by an nginx
// cache in front of it, and served to the browser by this app so they stay
// behind the login. Domains register their originals through `registerImageSource`.
export default defineNuxtConfig({
  runtimeConfig: {
    imgproxy: {
      // NUXT_IMGPROXY_URL — base URL of the caching proxy, e.g. http://imgproxy-cache in DDEV.
      // imgproxy itself is never addressed directly; only the cache is, so nothing bypasses it.
      url: '',
      // NUXT_IMGPROXY_KEY / NUXT_IMGPROXY_SALT — hex encoded signing pair, the same value
      // imgproxy was started with. Without both, URLs are signed `insecure` and imgproxy
      // accepts anything below its allowed sources.
      key: '',
      salt: ''
    },
    // NUXT_IMAGE_SOURCE_URL — base URL imgproxy reads the originals from. Inside the project
    // network the app is reachable as http://web:3000; a deployed environment sets its own.
    imageSourceUrl: '',
    // NUXT_IMAGE_SOURCE_SECRET — HMAC secret of the derivative endpoint. It signs the source
    // URL that imgproxy fetches, and is what protects the session-less source endpoint.
    imageSourceSecret: ''
  }
})
