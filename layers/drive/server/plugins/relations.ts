import { entityKey, entityLink, normalizeEmail } from '../../../core/shared/entities'
import type { EntityRef, Relation } from '../../../core/shared/types/entities'
import { registerRelationProvider } from '../../../core/server/utils/relations'
import { joinPath } from '../../shared/drive-path'

/** The explorer's "Shared with me" root; an invitation is a folder below it */
const SHARED_ROOT = '/shared-with-me'

function fileRef(service: string, path: string): EntityRef {
  return { type: 'file', service, id: path }
}

/**
 * Files a person is connected to.
 *
 * The CLI's folder listing carries no share members, and reading `sharing status`
 * for every entry would be one subprocess per item — too slow for a relation
 * request. The only sharing data it exposes in bulk is the invitations list,
 * which names the account that shared a folder with this one; that is what a
 * person is matched against. An item shared with a third party stays invisible.
 */
async function relatedToPerson(email: string, limit: number): Promise<Relation[]> {
  const services = await listServices('drive')
  const relations = new Map<string, Relation>()

  for (const { id } of services) {
    try {
      const provider = await useDriveProvider(id)

      for (const invitation of await provider.listInvitations()) {
        if (normalizeEmail(invitation.from) !== email) {
          continue
        }

        const ref = fileRef(id, joinPath(SHARED_ROOT, invitation.name))
        relations.set(entityKey(ref), {
          kind: 'shared',
          weight: 1,
          item: {
            ref,
            title: invitation.name,
            subtitle: invitation.from,
            to: entityLink(ref),
            icon: 'i-lucide-folder'
          }
        })
      }
    } catch (error) {
      // One broken drive service must not hide the others
      useServiceLogger('drive', id).warn('Could not list invitations', { error: String(error) })
    }
  }

  return [...relations.values()].slice(0, Math.max(0, limit) + 1)
}

export default defineNitroPlugin(() => {
  registerRelationProvider('drive', {
    label: 'Drive',
    related(ref, { limit }) {
      return ref.type === 'person' ? relatedToPerson(normalizeEmail(ref.id) ?? ref.id, limit) : Promise.resolve([])
    }
  })
})
