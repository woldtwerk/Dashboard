// Connects the automation and ai domains: a decision node that is unsure can hand
// the item to a language model instead of taking its `other`/`unsure` output.
//
// Privacy: the item's text (mail sender, subject and body, or a document's title and
// extracted content) is sent to the AI provider configured under Services. Add this
// layer only when the provider is trusted with that content.
export default defineNuxtConfig({})
