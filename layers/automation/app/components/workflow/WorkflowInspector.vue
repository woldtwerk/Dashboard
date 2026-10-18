<script setup lang="ts">
import type { MailFolders } from '#layers/mail/shared/types/mail'
import type { DocumentsCorrespondent, DocumentsDocumentType, DocumentsTag } from '#layers/documents/shared/types/documents'
import type { WorkflowEdge, WorkflowNode } from '../../../shared/types/automation'
import type { WorkflowValidationError } from '../../../shared/workflow'

const props = defineProps<{
  node: WorkflowNode | null
  edge: WorkflowEdge | null
  domain: 'mail' | 'documents'
  service: string | null
  errors: WorkflowValidationError[]
}>()

const emit = defineEmits<{
  update: [node: WorkflowNode]
  remove: [nodeId: string]
  removeEdge: [edgeId: string]
}>()

const { data: services } = useServices()

const serviceId = computed(() => props.service ?? services.value.find(service => service.domain === props.domain)?.id ?? '')

const draft = ref<WorkflowNode | null>(props.node ? structuredClone(props.node) : null)
watch(() => props.node, (node) => {
  if (JSON.stringify(node) !== JSON.stringify(draft.value)) {
    draft.value = node ? structuredClone(node) : null
  }
})

const nodeErrors = computed(() => props.errors.filter(error => error.nodeId === props.node?.id).map(error => error.message))

function commit() {
  if (draft.value) {
    emit('update', structuredClone(draft.value))
  }
}

// --- Option lists for action parameters ---

const folders = ref<string[]>([])
const tags = ref<DocumentsTag[]>([])
const correspondents = ref<DocumentsCorrespondent[]>([])
const documentTypes = ref<DocumentsDocumentType[]>([])

async function loadOptions() {
  if (props.domain === 'mail') {
    const data = await $fetch<MailFolders[]>('/api/mail/folders').catch(() => [])
    folders.value = data
      .filter(entry => !serviceId.value || entry.service.id === serviceId.value)
      .flatMap(entry => entry.mailboxes)
      .filter(mailbox => !mailbox.label)
      .map(mailbox => mailbox.path)
    return
  }

  if (!serviceId.value) {
    return
  }
  const query = { service: serviceId.value }
  const [tagList, correspondentList, typeList] = await Promise.all([
    $fetch<DocumentsTag[]>('/api/documents/tags', { query }).catch(() => []),
    $fetch<DocumentsCorrespondent[]>('/api/documents/correspondents', { query }).catch(() => []),
    $fetch<DocumentsDocumentType[]>('/api/documents/document-types', { query }).catch(() => [])
  ])
  tags.value = tagList
  correspondents.value = correspondentList
  documentTypes.value = typeList
}

watch([() => props.domain, serviceId], loadOptions, { immediate: true })

// --- Node type narrowing ---

type DecisionData = Extract<WorkflowNode, { type: 'decision' }>['data']
type ChoiceData = Extract<DecisionData, { question: 'choice' }>
type YesNoData = Extract<DecisionData, { question: 'yesno' }>

const conditionNode = computed(() => draft.value?.type === 'condition' ? draft.value : null)
const decisionNode = computed(() => draft.value?.type === 'decision' ? draft.value : null)
const triggerNode = computed(() => draft.value?.type === 'trigger' ? draft.value : null)
const actionNode = computed(() => draft.value?.type === 'action' ? draft.value : null)
const action = computed(() => actionNode.value?.data.action ?? null)

/** The decision node's data, narrowed to the choice variant */
const choiceData = computed<ChoiceData | null>(() => {
  const node = decisionNode.value
  return node && node.data.question === 'choice' ? node.data : null
})

/** The decision node's data, narrowed to the yes/no variant */
const yesnoData = computed<YesNoData | null>(() => {
  const node = decisionNode.value
  return node && node.data.question === 'yesno' ? node.data : null
})

// --- Editors ---

const CONDITION_FIELDS = [
  { label: 'From', value: 'from' },
  { label: 'Subject', value: 'subject' },
  { label: 'Body', value: 'text' },
  { label: 'Correspondent', value: 'correspondent' },
  { label: 'Title', value: 'title' }
]
const CONDITION_OPS = [
  { label: 'contains', value: 'contains' },
  { label: 'equals', value: 'equals' },
  { label: 'matches', value: 'matches' }
]
const COMBINES = [{ label: 'All', value: 'all' }, { label: 'Any', value: 'any' }]

function addCondition() {
  conditionNode.value?.data.conditions.conditions.push({ field: 'subject', op: 'contains', value: '' })
  commit()
}

function removeCondition(index: number) {
  conditionNode.value?.data.conditions.conditions.splice(index, 1)
  commit()
}

function setQuestionType(question: 'choice' | 'yesno') {
  const node = decisionNode.value
  if (!node || node.data.question === question) {
    return
  }
  const instructions = node.data.instructions
  node.data = question === 'choice'
    ? { question: 'choice', instructions, options: { invoice: 'An invoice' }, thresholds: { invoice: 0.8 } }
    : { question: 'yesno', instructions, thresholds: { yes: 0.85, no: 0.85 } }
  commit()
}

function optionRows(data: ChoiceData) {
  return Object.entries(data.options).map(([key, description]) => ({ key, description, threshold: data.thresholds[key] ?? 0 }))
}

function addOption() {
  const data = choiceData.value
  if (!data) {
    return
  }
  let index = Object.keys(data.options).length + 1
  while (Object.hasOwn(data.options, `option${index}`)) {
    index++
  }
  data.options[`option${index}`] = 'Description'
  data.thresholds[`option${index}`] = 0.8
  commit()
}

function removeOption(key: string) {
  const data = choiceData.value
  if (!data) {
    return
  }
  data.options = Object.fromEntries(Object.entries(data.options).filter(([option]) => option !== key))
  data.thresholds = Object.fromEntries(Object.entries(data.thresholds).filter(([option]) => option !== key))
  commit()
}

function renameOption(from: string, to: string) {
  const data = choiceData.value
  const trimmed = to.trim()
  if (!data || !trimmed || trimmed === from || Object.hasOwn(data.options, trimmed)) {
    return
  }
  data.options = Object.fromEntries(Object.entries(data.options).map(([key, value]) => [key === from ? trimmed : key, value]))
  const threshold = data.thresholds[from] ?? 0
  data.thresholds = Object.fromEntries(Object.entries(data.thresholds).map(([key, value]) => [key === from ? trimmed : key, value]))
  data.thresholds[trimmed] = threshold
  commit()
}

const MAIL_ACTION_TYPES = [
  { label: 'Move to folder', value: 'move-to' },
  { label: 'Add label', value: 'label' },
  { label: 'Mark as read', value: 'mark-read' },
  { label: 'Star', value: 'star' }
]
const DOCUMENT_ACTION_TYPES = [
  { label: 'Add tag', value: 'add-tag' },
  { label: 'Set correspondent', value: 'set-correspondent' },
  { label: 'Set document type', value: 'set-type' }
]

const actionTypes = computed(() => props.domain === 'mail' ? MAIL_ACTION_TYPES : DOCUMENT_ACTION_TYPES)

function setActionType(type: string) {
  const node = actionNode.value
  if (!node) {
    return
  }
  if (type === 'move-to') {
    node.data.action = { type: 'move-to', folder: folders.value[0] ?? 'Archive' }
  } else if (type === 'label') {
    node.data.action = { type: 'label', label: '' }
  } else if (type === 'mark-read' || type === 'star') {
    node.data.action = { type }
  } else if (type === 'add-tag') {
    node.data.action = { type: 'add-tag', tag: tags.value[0]?.id ?? 0 }
  } else if (type === 'set-correspondent') {
    node.data.action = { type: 'set-correspondent', correspondent: correspondents.value[0]?.id ?? 0 }
  } else if (type === 'set-type') {
    node.data.action = { type: 'set-type', documentType: documentTypes.value[0]?.id ?? 0 }
  }
  commit()
}

const folderItems = computed(() => folders.value.map(folder => ({ label: folder, value: folder })))
const tagItems = computed(() => tags.value.map(tag => ({ label: tag.name, value: tag.id })))
const correspondentItems = computed(() => correspondents.value.map(entry => ({ label: entry.name, value: entry.id })))
const documentTypeItems = computed(() => documentTypes.value.map(type => ({ label: type.name, value: type.id })))
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="border-b border-default px-4 py-3">
      <p class="text-sm font-semibold text-highlighted">
        {{ node ? 'Node' : edge ? 'Connection' : 'Inspector' }}
      </p>
      <p class="text-xs text-muted">
        {{ node ? 'Edit the selected node' : edge ? 'Remove or rewire the connection' : 'Select a node on the canvas' }}
      </p>
    </div>

    <div class="flex-1 overflow-auto p-4">
      <p v-if="!node && !edge" class="text-sm text-muted">
        Nothing selected. Drag a node from the palette above the canvas, then click it to edit.
      </p>

      <div v-if="edge" class="space-y-3">
        <p class="text-sm text-muted">
          {{ edge.source }} <span class="text-muted">·</span> {{ edge.sourceHandle }} → {{ edge.target }}
        </p>
        <UButton
          label="Remove connection"
          icon="i-lucide-unlink"
          color="error"
          variant="soft"
          size="sm"
          @click="emit('removeEdge', edge.id)"
        />
      </div>

      <div v-if="draft" class="space-y-4">
        <UAlert
          v-if="nodeErrors.length"
          color="error"
          variant="soft"
          icon="i-lucide-triangle-alert"
          :title="nodeErrors.join(', ')"
        />

        <!-- Trigger -->
        <template v-if="triggerNode">
          <UFormField label="Watches" description="New items of this source">
            <UInput v-model="triggerNode.data.mailbox" class="w-full" @change="commit" />
          </UFormField>
        </template>

        <!-- Condition -->
        <template v-if="conditionNode">
          <UFormField label="Combine">
            <USelect
              v-model="conditionNode.data.conditions.combine"
              :items="COMBINES"
              class="w-full"
              @update:model-value="commit"
            />
          </UFormField>

          <div v-for="(condition, index) in conditionNode.data.conditions.conditions" :key="index" class="space-y-2 rounded-md border border-default p-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-muted">Condition {{ index + 1 }}</span>
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="xs"
                aria-label="Remove condition"
                @click="removeCondition(index)"
              />
            </div>
            <USelect
              v-model="condition.field"
              :items="CONDITION_FIELDS"
              class="w-full"
              size="sm"
              @update:model-value="commit"
            />
            <USelect
              v-model="condition.op"
              :items="CONDITION_OPS"
              class="w-full"
              size="sm"
              @update:model-value="commit"
            />
            <UInput
              v-model="condition.value"
              placeholder="value"
              class="w-full"
              size="sm"
              @change="commit"
            />
          </div>

          <UButton
            label="Add condition"
            icon="i-lucide-plus"
            size="sm"
            color="neutral"
            variant="soft"
            block
            @click="addCondition"
          />
        </template>

        <!-- Decision -->
        <template v-if="decisionNode">
          <UFormField label="Question type">
            <USelect
              :model-value="decisionNode.data.question"
              :items="[{ label: 'Choice', value: 'choice' }, { label: 'Yes / No', value: 'yesno' }]"
              class="w-full"
              @update:model-value="value => setQuestionType(value as 'choice' | 'yesno')"
            />
          </UFormField>
          <UFormField label="Instructions">
            <UTextarea
              v-model="decisionNode.data.instructions"
              :rows="3"
              class="w-full"
              @change="commit"
            />
          </UFormField>

          <template v-if="choiceData">
            <div class="space-y-2">
              <div v-for="row in optionRows(choiceData)" :key="row.key" class="space-y-2 rounded-md border border-default p-2">
                <div class="flex items-center gap-2">
                  <UInput
                    :model-value="row.key"
                    size="sm"
                    class="w-24 font-mono"
                    @change="event => renameOption(row.key, (event.target as HTMLInputElement).value)"
                  />
                  <UInput
                    :model-value="row.description"
                    size="sm"
                    class="flex-1"
                    placeholder="Description for the model"
                    @change="event => { choiceData!.options[row.key] = (event.target as HTMLInputElement).value; commit() }"
                  />
                  <UButton
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="ghost"
                    size="xs"
                    aria-label="Remove option"
                    @click="removeOption(row.key)"
                  />
                </div>
                <div class="flex items-center gap-3">
                  <USlider
                    :model-value="row.threshold"
                    :min="0"
                    :max="1"
                    :step="0.05"
                    class="flex-1"
                    @update:model-value="value => { choiceData!.thresholds[row.key] = value as number; commit() }"
                  />
                  <span class="w-10 text-right text-xs tabular-nums text-muted">≥ {{ row.threshold.toFixed(2) }}</span>
                </div>
              </div>
              <UButton
                label="Add option"
                icon="i-lucide-plus"
                size="sm"
                color="neutral"
                variant="soft"
                block
                @click="addOption"
              />
            </div>
            <p class="text-xs text-muted">
              The <code>other</code> output takes every answer below an option's threshold.
            </p>
          </template>

          <template v-if="yesnoData">
            <UFormField label="Yes at P(true) ≥">
              <div class="flex items-center gap-3">
                <USlider
                  :model-value="yesnoData.thresholds.yes"
                  :min="0"
                  :max="1"
                  :step="0.05"
                  class="flex-1"
                  @update:model-value="value => { yesnoData!.thresholds.yes = value as number; commit() }"
                />
                <span class="w-10 text-right text-xs tabular-nums text-muted">{{ yesnoData.thresholds.yes.toFixed(2) }}</span>
              </div>
            </UFormField>
            <UFormField label="No at P(false) ≥">
              <div class="flex items-center gap-3">
                <USlider
                  :model-value="yesnoData.thresholds.no"
                  :min="0"
                  :max="1"
                  :step="0.05"
                  class="flex-1"
                  @update:model-value="value => { yesnoData!.thresholds.no = value as number; commit() }"
                />
                <span class="w-10 text-right text-xs tabular-nums text-muted">{{ yesnoData.thresholds.no.toFixed(2) }}</span>
              </div>
            </UFormField>
            <p class="text-xs text-muted">
              Between the two, the answer is <code>unsure</code>.
            </p>
          </template>
        </template>

        <!-- Action -->
        <template v-if="actionNode && action">
          <UFormField label="Action">
            <USelect
              :model-value="action.type"
              :items="actionTypes"
              class="w-full"
              @update:model-value="value => setActionType(value as string)"
            />
          </UFormField>

          <UFormField v-if="action.type === 'move-to'" label="Folder">
            <USelect
              v-if="folders.length"
              :model-value="action.folder"
              :items="folderItems"
              class="w-full"
              @update:model-value="value => { actionNode!.data.action = { type: 'move-to', folder: value as string }; commit() }"
            />
            <UInput
              v-else
              v-model="action.folder"
              class="w-full"
              @change="commit"
            />
          </UFormField>

          <UFormField v-if="action.type === 'label'" label="Label">
            <UInput
              v-model="action.label"
              placeholder="Invoice"
              class="w-full"
              @change="commit"
            />
          </UFormField>

          <UFormField v-if="action.type === 'add-tag'" label="Tag">
            <USelect
              v-if="tags.length"
              :model-value="action.tag"
              :items="tagItems"
              class="w-full"
              @update:model-value="value => { actionNode!.data.action = { type: 'add-tag', tag: value as number }; commit() }"
            />
            <UInput
              v-else
              :model-value="action.tag"
              type="number"
              class="w-full"
              @change="event => { actionNode!.data.action = { type: 'add-tag', tag: Number((event.target as HTMLInputElement).value) }; commit() }"
            />
          </UFormField>

          <UFormField v-if="action.type === 'set-correspondent'" label="Correspondent">
            <USelect
              v-if="correspondents.length"
              :model-value="action.correspondent"
              :items="correspondentItems"
              class="w-full"
              @update:model-value="value => { actionNode!.data.action = { type: 'set-correspondent', correspondent: value as number }; commit() }"
            />
            <UInput
              v-else
              :model-value="action.correspondent"
              type="number"
              class="w-full"
              @change="event => { actionNode!.data.action = { type: 'set-correspondent', correspondent: Number((event.target as HTMLInputElement).value) }; commit() }"
            />
          </UFormField>

          <UFormField v-if="action.type === 'set-type'" label="Document type">
            <USelect
              v-if="documentTypes.length"
              :model-value="action.documentType"
              :items="documentTypeItems"
              class="w-full"
              @update:model-value="value => { actionNode!.data.action = { type: 'set-type', documentType: value as number }; commit() }"
            />
            <UInput
              v-else
              :model-value="action.documentType"
              type="number"
              class="w-full"
              @change="event => { actionNode!.data.action = { type: 'set-type', documentType: Number((event.target as HTMLInputElement).value) }; commit() }"
            />
          </UFormField>
        </template>

        <UButton
          v-if="draft.type !== 'trigger'"
          label="Delete node"
          icon="i-lucide-trash-2"
          color="error"
          variant="soft"
          size="sm"
          block
          @click="emit('remove', draft.id)"
        />
      </div>
    </div>
  </div>
</template>
