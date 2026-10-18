// Connects the mail and ai domains: search assistant for the mail page and the /assistant chat.
// The chat reads its tools from the domain tool registry, restricted to `assistant.domains`.
export default defineNuxtConfig({
  runtimeConfig: {
    assistant: {
      // NUXT_ASSISTANT_DOMAINS — comma-separated domains the assistant may read (default: mail).
      // Every enabled domain's data is sent to the configured AI provider; only enable what
      // the provider is trusted with.
      domains: 'mail'
    }
  }
})
