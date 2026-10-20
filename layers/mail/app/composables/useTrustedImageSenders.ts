import type { MailListView, MailSettings } from '#layers/mail/shared/types/settings'
import { normalizeTrustedImageSender } from '#layers/mail/shared/mail-images'

/**
 * The `mail` settings section: trusted image senders and the saved list view.
 * Every write sends the whole section, because that is what the settings PUT
 * replaces. `useSettings.save` updates the shared section optimistically and
 * rolls it back when the request fails.
 */
export function useTrustedImageSenders() {
  const { data, save } = useSettings<MailSettings>('mail')

  const trustedImageSenders = computed(() => data.value.trustedImageSenders ?? [])
  const listView = computed<MailListView>(() => data.value.listView === 'conversations' ? 'conversations' : 'mails')

  // The PUT replaces the whole section, so the other mail settings ride along
  function write(trusted: string[], view = listView.value) {
    return save({ ...data.value, trustedImageSenders: trusted, listView: view })
  }

  /** Trust an address or `@domain`; a duplicate or invalid entry changes nothing */
  async function trust(entry: string | null | undefined): Promise<void> {
    const normalized = normalizeTrustedImageSender(entry)
    if (!normalized || trustedImageSenders.value.includes(normalized)) {
      return
    }
    await write([...trustedImageSenders.value, normalized])
  }

  /** Stop loading remote images from an address or `@domain` */
  async function untrust(entry: string | null | undefined): Promise<void> {
    const normalized = normalizeTrustedImageSender(entry)
    if (!normalized) {
      return
    }

    const next = trustedImageSenders.value.filter(item => item !== normalized)
    if (next.length !== trustedImageSenders.value.length) {
      await write(next)
    }
  }

  /** Save the view an unlinked visit starts in */
  async function setListView(view: MailListView): Promise<void> {
    if (view !== listView.value) {
      await write(trustedImageSenders.value, view)
    }
  }

  return { trustedImageSenders, listView, trust, untrust, setListView }
}
