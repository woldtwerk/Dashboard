import { fileResponse } from '../../../core/server/utils/file-response'

/**
 * Builds the response for a drive download. The shared core response decides
 * which types may render inline and sets every security header; the drive only
 * names its fallback for a name that sanitizes to nothing.
 */
export function driveFileResponse(
  response: Response,
  options: { name: string, inline?: boolean, single?: boolean, etag?: string }
): Response {
  return fileResponse(response, {
    name: options.name,
    inline: options.inline,
    single: options.single,
    etag: options.etag,
    fallbackName: 'drive-download'
  })
}
