import MarkdownIt from 'markdown-it'
import { isSafeAssistantLink } from './markdown-link'

/**
 * The assistant answer renders through markdown-it (MIT). `html: false` turns
 * raw HTML into escaped text, so model output that echoes a mail body cannot
 * inject markup. `validateLink` keeps only in-app paths and `https:` URLs, and
 * the image rule renders the alt text instead of an `<img>`, so a tracking
 * pixel in the answer never loads.
 */
const markdown = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: false
})

markdown.validateLink = isSafeAssistantLink

markdown.renderer.rules.image = (tokens, index) =>
  markdown.utils.escapeHtml(String(tokens[index]?.content ?? ''))

const renderLinkOpen = markdown.renderer.rules.link_open
  ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options))

markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const href = String(tokens[index]?.attrGet('href') ?? '')
  if (/^https:\/\//i.test(href)) {
    tokens[index]?.attrSet('target', '_blank')
    tokens[index]?.attrSet('rel', 'noopener noreferrer nofollow')
  }

  return renderLinkOpen(tokens, index, options, env, self)
}

/** Renders assistant Markdown to safe HTML; raw HTML is escaped. */
export function renderAssistantMarkdown(text: string): string {
  return markdown.render(text)
}
