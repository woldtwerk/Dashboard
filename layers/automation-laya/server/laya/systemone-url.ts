const OPENAI_SUFFIX = '/openai/v1'

/**
 * The System One base URL of an OpenCode service. The client appends
 * `/v1/systemone`, so the Go base (`.../go/openai/v1`) becomes the documented
 * `.../go/systemone/v1/systemone`; the pay-as-you-go base maps the same way.
 */
export function systemOneBaseUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (!base.endsWith(OPENAI_SUFFIX)) {
    throw new Error('The OpenCode service base URL must end with /openai/v1')
  }
  return `${base.slice(0, -OPENAI_SUFFIX.length)}/systemone`
}
