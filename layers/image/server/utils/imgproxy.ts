import { createHmac, timingSafeEqual } from 'node:crypto'
import { createError } from 'nuxt/server'

/**
 * The widths a layout may ask a derivative for. The list is a power-of-two-ish
 * ladder so a request between two steps is served by the next step up rather
 * than by a new render for every pixel value; that keeps the cache effective.
 */
export const IMAGE_WIDTHS = [64, 128, 256, 384, 512, 768, 1024, 1536, 2048] as const

/** imgproxy resize types this app asks for. */
export const IMAGE_FITS = ['fill', 'fit'] as const
export type ImageFit = (typeof IMAGE_FITS)[number]

/** Densities a `srcset` candidate may carry. */
export const IMAGE_DPRS = [1, 2] as const
export type ImageDpr = (typeof IMAGE_DPRS)[number]

/** Default resize type; a tile is filled, a preview is fitted. */
export const DEFAULT_IMAGE_FIT: ImageFit = 'fill'

/** The width whose derivative a request is rounded up to, capped at the largest step. */
export function snapImageWidth(width: number): number {
  return IMAGE_WIDTHS.find(allowed => allowed >= width) ?? IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]!
}

/**
 * base64url without padding, the encoding imgproxy reads its signature and its
 * source in. The url-safe alphabet means the value needs no escaping in a path.
 */
export function base64Url(value: string | Uint8Array): string {
  return Buffer.from(value).toString('base64url')
}

/** Decodes a hex string, rejecting anything that is not an even number of hex digits. */
function hexBytes(value: string, name: string): Buffer {
  if (!/^[0-9a-fA-F]*$/.test(value) || value.length % 2 !== 0) {
    throw new Error(`${name} has to be hex encoded`)
  }
  return Buffer.from(value, 'hex')
}

/**
 * Signs one imgproxy path: HMAC-SHA256 over `salt + path`, base64url encoded.
 * The key and the salt are hex encoded, exactly as IMGPROXY_KEY/IMGPROXY_SALT
 * carry them. Without both, imgproxy's `insecure` literal is returned — the
 * same behaviour the Drupal module has, so an unsigned deployment still works.
 */
export function signImgproxyPath(path: string, keyHex: string, saltHex: string): string {
  if (!keyHex || !saltHex) {
    return 'insecure'
  }

  const key = hexBytes(keyHex, 'IMGPROXY_KEY')
  const salt = hexBytes(saltHex, 'IMGPROXY_SALT')

  return createHmac('sha256', key).update(salt).update(path).digest('base64url')
}

export interface ImgproxyPathOptions {
  /** Width of the derivative, one of IMAGE_WIDTHS. */
  width: number
  /** Height, or undefined to keep the aspect ratio. */
  height?: number
  fit: ImageFit
  /** Device pixel ratio imgproxy should render for. */
  dpr?: number
  /** Absolute URL of the original, e.g. the app's own source endpoint. */
  sourceUrl: string
}

/**
 * Builds the unsigned path of an imgproxy URL, e.g.
 * `/rs:fill:256:0:0/dpr:2/<base64url source>`. The source is base64url encoded
 * rather than `plain`, so a URL with a query string, an umlaut or a slash needs
 * no escaping; the caller prefixes the signature and the imgproxy base URL.
 */
export function buildImgproxyPath({ width, height, fit, dpr, sourceUrl }: ImgproxyPathOptions): string {
  const options = [`rs:${fit}:${width}:${height ?? 0}:0`]
  if (dpr) {
    options.push(`dpr:${dpr}`)
  }

  return `/${options.join('/')}/${base64Url(sourceUrl)}`
}

export interface ImageRequest {
  width: number
  height?: number
  fit: ImageFit
  dpr: ImageDpr
}

function parseInteger(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  if (Array.isArray(value)) {
    throw createError({ status: 400, statusText: `The ${name} parameter must be a single value` })
  }
  const text = String(value).trim()
  if (!/^\d+$/.test(text)) {
    throw createError({ status: 400, statusText: `The ${name} parameter must be a positive integer` })
  }
  return Number(text)
}

/**
 * Normalizes a request's query into what imgproxy is asked for. A width snaps
 * up to the next allowed step; a height snaps the same way. A missing or
 * non-numeric width, an unknown `fit` or a `dpr` other than 1 or 2 is rejected
 * with a 400 — only values the layout actually uses reach imgproxy, so it can
 * never be turned into a renderer for arbitrary sizes.
 */
export function normalizeImageRequest(query: Record<string, unknown>): ImageRequest {
  const requestedWidth = parseInteger(query.w, 'w')
  if (requestedWidth === undefined || requestedWidth < 1) {
    throw createError({ status: 400, statusText: 'An image request needs a width in `w`' })
  }

  const requestedHeight = parseInteger(query.h, 'h')
  if (requestedHeight !== undefined && requestedHeight < 1) {
    throw createError({ status: 400, statusText: 'The h parameter must be a positive integer' })
  }

  const fit = query.fit === undefined || query.fit === '' ? DEFAULT_IMAGE_FIT : String(query.fit)
  if (!(IMAGE_FITS as readonly string[]).includes(fit)) {
    throw createError({ status: 400, statusText: `The fit parameter must be one of ${IMAGE_FITS.join(', ')}` })
  }

  const dpr = parseInteger(query.dpr, 'dpr') ?? 1
  if (!(IMAGE_DPRS as readonly number[]).includes(dpr)) {
    throw createError({ status: 400, statusText: `The dpr parameter must be one of ${IMAGE_DPRS.join(', ')}` })
  }

  return {
    width: snapImageWidth(requestedWidth),
    height: requestedHeight !== undefined ? snapImageWidth(requestedHeight) : undefined,
    fit: fit as ImageFit,
    dpr: dpr as ImageDpr
  }
}

/**
 * Signs the source URL the derivative endpoint hands imgproxy. The signature
 * covers the source name, the id and the version, so neither the id nor the
 * version can be swapped for another file's. It is what makes the source
 * endpoint safe to expose without a session: only a caller holding the secret
 * can name a file, and the secret never reaches the browser.
 */
export function signSource(source: string, id: string, version: string, secret: string): string {
  return createHmac('sha256', secret).update(`${source}|${id}|${version}`).digest('base64url')
}

/** Whether `signature` is the one `signSource` produces; compared in constant time. */
export function verifySource(source: string, id: string, version: string, signature: string | undefined, secret: string): boolean {
  if (!secret || !signature) {
    return false
  }

  const expected = Buffer.from(signSource(source, id, version, secret))
  const given = Buffer.from(signature)
  if (expected.length !== given.length) {
    return false
  }

  return timingSafeEqual(expected, given)
}
