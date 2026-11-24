import { ensureActivation, readActivation, setActivation } from './runs'

/** How far back a service that appears later is watched, so the triggering mail survives */
export const MAIL_ACTIVATION_LOOKBACK_MS = 10 * 60_000

/**
 * The instant before which mail is old; floored to the second and one second back,
 * because the search index stores mail dates as whole seconds: mail that arrives in
 * the activation second must still count as new.
 */
export function activationWatermark(now: Date): string {
  return new Date(Math.floor(now.getTime() / 1000) * 1000 - 1000).toISOString()
}

/**
 * The activation watermark of one mail service, recording one on first use. The
 * lookback only covers this lazy fallback: the mail that triggered the run has
 * already arrived, so it must stay newer than the watermark.
 */
export async function ensureMailActivation(service: string, now = new Date()): Promise<string> {
  const existing = await readActivation('mail', service)
  if (existing) {
    return existing
  }

  return await ensureActivation('mail', service, activationWatermark(new Date(now.getTime() - MAIL_ACTIVATION_LOOKBACK_MS)), now)
}

/**
 * Records the start of automation for the mail services a workflow covers: the one
 * it names, or every configured mail account when it names none. `reset` is for a
 * workflow that is enabled again, so its disabled window is not replayed.
 */
export async function activateMailServices(service: string | null, options: { reset?: boolean, now?: Date } = {}): Promise<void> {
  const now = options.now ?? new Date()
  const since = activationWatermark(now)
  const services = service ? [service] : (await listServices('mail')).map(entry => entry.id)

  await Promise.all(services.map(id => options.reset
    ? setActivation('mail', id, since, now)
    : ensureActivation('mail', id, since, now)))
}
