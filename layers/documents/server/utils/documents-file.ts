import { fileResponse } from '../../../core/server/utils/file-response'

/**
 * Streams a provider file response through untouched in the body, but builds the
 * headers through the shared core response: the upstream `Content-Disposition`
 * is ignored, inline is only allowed for types that are safe to render (PDF,
 * raster image), and every response is nosniff with a policy the viewer can
 * actually run under. Returned directly, so h3 sends it as-is.
 */
export function documentsFileResponse(response: Response, options: { filename: string, inline?: boolean }): Response {
  return fileResponse(response, {
    name: options.filename,
    inline: options.inline,
    fallbackName: 'document'
  })
}
