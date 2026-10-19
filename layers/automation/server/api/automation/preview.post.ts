import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import type { WorkflowPreviewEvent } from '../../../shared/types/automation'

/**
 * Dry-runs a workflow graph against recent items, one picked item or free text.
 * Nothing is applied and the graph is validated first. One preview runs per user
 * at a time (a lock), and never over more than 50 items.
 *
 * The answer is a stream of NDJSON lines ({@link WorkflowPreviewEvent}) so the panel
 * shows each item as soon as its walk ends; it ends with `done` or `error`. A client
 * that goes away stops the walk before its next decision call.
 */
export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, workflowPreviewSchema)
  const { user } = await getUserSession(event)
  const abort = new AbortController()
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: WorkflowPreviewEvent) => {
        if (!abort.signal.aborted) {
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`))
        }
      }

      try {
        const result = await previewWorkflow(body, user?.id ?? 'anonymous', { onEvent: send, signal: abort.signal })
        send({ type: 'done', aiUnavailable: result.aiUnavailable })
      } catch (error) {
        const { statusText, statusCode } = error as { statusText?: string, statusCode?: number }
        const message = statusText || (error instanceof Error ? error.message : 'The preview failed')
        send({ type: 'error', message, busy: statusCode === 409 })
      }

      if (!abort.signal.aborted) {
        controller.close()
      }
    },
    cancel() {
      abort.abort()
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no'
    }
  })
})
