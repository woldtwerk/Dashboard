import { createError } from 'nuxt/server'
import { registerImageSource } from '../../../image/server/utils/image-sources'
import { parseDriveImageId } from '../../shared/drive-image'

/**
 * Lets imgproxy read Drive originals. The download follows the same control API
 * path as a normal download, so the provider's streaming, temp-file handling and
 * timeouts apply unchanged; only the headers differ, because imgproxy needs the
 * bytes with their real content type rather than an attachment.
 */
export default defineNitroPlugin(() => {
  registerImageSource('drive', {
    async load(id) {
      const parsed = parseDriveImageId(id)
      if (!parsed) {
        throw createError({ status: 400, statusText: 'Invalid drive image id' })
      }

      const response = await (await useDriveProvider(parsed.service)).download([parsed.path])
      if (!response.body) {
        throw createError({ status: 502, statusText: 'The drive returned no image' })
      }

      const length = Number(response.headers.get('content-length'))

      return {
        body: response.body,
        contentType: response.headers.get('content-type') ?? 'application/octet-stream',
        size: Number.isFinite(length) && length > 0 ? length : undefined
      }
    }
  })
})
