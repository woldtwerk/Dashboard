import { encodeImageId } from '../../shared/image-id'

export type ImageFit = 'fill' | 'fit'
export type ImageDpr = 1 | 2

export interface ImageUrlOptions {
  /** The width the layout needs; the server snaps it to its allowed ladder. */
  width: number
  /** Height, or omitted to keep the aspect ratio. */
  height?: number
  fit?: ImageFit
  dpr?: ImageDpr
  /** The original's version; makes the response immutable and the cache stable. */
  v?: string
}

/**
 * The URL of a derivative: `/api/img/<source>/<id>?w=&h=&fit=&dpr=&v=`.
 *
 * It goes through this app, not to imgproxy directly, so the browser stays
 * behind the login. The id is encoded segment by segment: its `/` are the
 * separators the route reads, everything inside a segment is escaped.
 */
export function imageUrl(source: string, id: string, options: ImageUrlOptions): string {
  const params = new URLSearchParams()
  params.set('w', String(options.width))
  if (options.height !== undefined) {
    params.set('h', String(options.height))
  }
  if (options.fit) {
    params.set('fit', options.fit)
  }
  if (options.dpr) {
    params.set('dpr', String(options.dpr))
  }
  if (options.v) {
    params.set('v', options.v)
  }

  return `/api/img/${encodeURIComponent(source)}/${encodeImageId(id)}?${params}`
}

export interface ImageSrcsetOptions extends ImageUrlOptions {
  /**
   * Candidate widths for a `sizes`-driven layout. Without them the pair
   * `width` (1x) and `2 * width` (2x) is emitted for a fixed-size image.
   */
  widths?: number[]
}

/**
 * A `srcset` for one derivative. A fixed-size image gets density descriptors —
 * `256w` is the 1x tile and `512w` its 2x counterpart — while a layout that
 * spans breakpoints passes `widths` and pairs the result with `sizes`.
 */
export function imageSrcset(source: string, id: string, options: ImageSrcsetOptions): string {
  const { widths, ...base } = options

  if (widths?.length) {
    return widths
      .map(width => `${imageUrl(source, id, { ...base, width, dpr: undefined })} ${width}w`)
      .join(', ')
  }

  return [
    `${imageUrl(source, id, { ...base, dpr: undefined })} 1x`,
    `${imageUrl(source, id, { ...base, width: base.width * 2, dpr: undefined })} 2x`
  ].join(', ')
}
