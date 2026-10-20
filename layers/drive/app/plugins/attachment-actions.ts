import { parseEntityKey } from '#layers/core/shared/entities'
import { registerAttachmentAction, type AttachmentActionContext } from '#layers/core/app/utils/attachment-actions'
import type { DriveImportResult } from '#layers/drive/shared/types/drive'
import type { DriveSaveTarget, DriveSettings } from '#layers/drive/shared/types/settings'
import {
  DRIVE_SAVE_ATTACHMENT_ACTION_ID,
  attachmentSaveToast,
  rememberedSaveTarget,
  withSaveTarget,
  type DriveSaveChoice
} from '../utils/drive-save-attachments'
import DriveAttachmentSaveModal from '../components/drive/DriveAttachmentSaveModal.vue'

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const { statusMessage, message } = error as { statusMessage?: string, message?: string }
    return statusMessage || message || 'Unknown error'
  }
  return 'Unknown error'
}

/**
 * Offers "Save to drive" on mail attachments. The drive layer owns everything
 * here: the services, the remembered folder and the modal. The mail layer only
 * renders the registered action.
 */
export default defineNuxtPlugin(() => {
  if (!import.meta.client) {
    return
  }

  const overlay = useOverlay()
  const toast = useToast()
  const { data: settings, save } = useSettings<DriveSettings>('drive')
  const { data: allServices } = useServices()
  const modal = overlay.create(DriveAttachmentSaveModal)

  const driveServices = computed(() => allServices.value.filter(service => service.domain === 'drive'))

  /** The mail account the attachments belong to, from its entity key */
  function mailService(context: AttachmentActionContext): string {
    return parseEntityKey(context.ref)?.service ?? ''
  }

  function parts(context: AttachmentActionContext): string[] {
    return context.attachments.map(attachment => attachment.part).filter((part): part is string => !!part)
  }

  async function runSave(
    context: AttachmentActionContext,
    target: DriveSaveTarget,
    checkDuplicates: boolean,
    offerChange: boolean
  ): Promise<void> {
    const selected = parts(context)
    if (!selected.length) {
      return
    }

    try {
      const result = await $fetch<DriveImportResult>('/api/drive/import', {
        method: 'POST',
        body: {
          source: context.source,
          ref: context.ref,
          parts: selected,
          service: target.service,
          folder: target.folder,
          conflict: 'rename',
          checkDuplicates
        }
      })

      // Remember only a target that saved at least one file, per mail account
      const account = mailService(context)
      if (account && result.saved.length) {
        await save(withSaveTarget(settings.value, account, target))
      }

      const summary = attachmentSaveToast(result, target.folder)
      toast.add({
        ...summary,
        icon: summary.color === 'success'
          ? 'i-lucide-check'
          : summary.color === 'error' ? 'i-lucide-circle-alert' : 'i-lucide-triangle-alert',
        actions: offerChange
          ? [{
              label: 'Change folder',
              color: 'neutral',
              variant: 'link',
              onClick: () => void openModal(context, target)
            }]
          : undefined
      })
    } catch (error) {
      toast.add({
        title: 'Could not save attachments',
        description: errorMessage(error),
        color: 'error',
        icon: 'i-lucide-circle-alert'
      })
    }
  }

  async function openModal(context: AttachmentActionContext, current?: DriveSaveTarget): Promise<void> {
    if (!driveServices.value.length) {
      toast.add({ title: 'No drive service configured', color: 'error', icon: 'i-lucide-circle-alert' })
      return
    }

    const choice = await modal.open({
      attachments: context.attachments,
      services: driveServices.value.map(service => ({ id: service.id, name: service.name })),
      initialService: current?.service ?? driveServices.value[0]?.id,
      initialFolder: current?.folder ?? '/my-files'
    }) as DriveSaveChoice | undefined

    if (choice) {
      await runSave(context, { service: choice.service, folder: choice.folder }, choice.checkDuplicates, false)
    }
  }

  registerAttachmentAction({
    id: DRIVE_SAVE_ATTACHMENT_ACTION_ID,
    label: 'Save to drive',
    icon: 'i-lucide-hard-drive',
    kbds: ['shift_s'],
    order: 10,
    visible: context => driveServices.value.length > 0 && parts(context).length > 0,
    async run(context) {
      const account = mailService(context)
      const remembered = rememberedSaveTarget(settings.value, account, driveServices.value.map(service => service.id))

      if (remembered) {
        await runSave(context, remembered, true, true)
        return
      }

      await openModal(context)
    }
  })
})
