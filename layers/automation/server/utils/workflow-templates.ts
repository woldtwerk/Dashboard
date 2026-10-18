import { createError } from 'nuxt/server'
import type { AutomationDomain, AutomationWorkflow } from '../../shared/types/automation'
import { instantiateWorkflowTemplate, workflowTemplates } from '../../shared/workflow-templates'
import type { WorkflowTemplate, WorkflowTemplateCatalogue } from '../../shared/workflow-templates'
import { insertWorkflow } from './workflows'

/** One template of the shared catalogue, or a 404 for an unknown id */
export function findWorkflowTemplate(id: string): WorkflowTemplate {
  const template = workflowTemplates.find(entry => entry.id === id)
  if (!template) {
    throw createError({ status: 404, statusText: 'Workflow template not found' })
  }
  return template
}

/**
 * The names a template's bindings resolve against. Mail labels are created on
 * apply, so a mail template needs no catalogue. Document tags and types are
 * provider records, so they are read from the archive the workflow will run on.
 */
export async function templateCatalogue(
  domain: AutomationDomain,
  service: string | null
): Promise<WorkflowTemplateCatalogue> {
  if (domain !== 'documents') {
    return { tags: [], documentTypes: [] }
  }

  const serviceId = service ?? (await listServices('documents'))[0]?.id
  if (!serviceId) {
    return { tags: [], documentTypes: [] }
  }

  const provider = await useDocumentsProvider(serviceId)
  const [tags, documentTypes] = await Promise.all([provider.listTags(), provider.listDocumentTypes()])

  return {
    tags: tags.map(tag => ({ id: tag.id, name: tag.name })),
    documentTypes: documentTypes.map(type => ({ id: type.id, name: type.name }))
  }
}

/**
 * Creates a workflow from a template. It is always disabled and in suggest mode:
 * the user opens it in the builder, previews it on the last 50 items and only then
 * enables it. No template is ever enabled automatically.
 */
export async function createWorkflowFromTemplate(
  templateId: string,
  service: string | null = null
): Promise<AutomationWorkflow> {
  const template = findWorkflowTemplate(templateId)
  const { graph } = instantiateWorkflowTemplate(template, await templateCatalogue(template.domain, service))

  return insertWorkflow({
    name: template.name,
    domain: template.domain,
    service,
    enabled: false,
    mode: 'suggest',
    graph
  })
}
