import { setResponseHeader } from 'h3'
import type { H3Event } from 'h3'
import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { z } from 'zod'
import { layaTrainingRows, splitOf } from '../../../laya/training'

const querySchema = z.object({
  ai: z.literal('1').optional(),
  split: z.enum(['train', 'eval', 'all']).default('all'),
  evalShare: z.coerce.number().min(0).max(0.5).default(0.1),
  format: z.enum(['jsonl', 'summary']).default('jsonl')
})

/**
 * The Laya training download, built from the runs the user reacted to. `summary`
 * returns the builder's counts for the activity page's menu; `jsonl` is the file
 * `laya-train --data` reads directly, one row per state.
 */
export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, querySchema)
  const ai = query.ai === '1'

  // Corrections carry every human and confirmed/rejected label. AI labels can also
  // come from runs the user never touched, so the recent activity is merged in for
  // the explicit `ai` download only.
  let runs = await listCorrections(5000)
  if (ai) {
    const merged = new Map(runs.map(run => [run.id, run]))
    for (const run of await listRuns({ limit: 5000 })) {
      if (run.path.some(step => step.source === 'ai')) {
        merged.set(run.id, run)
      }
    }
    runs = [...merged.values()]
  }

  const workflows = await listWorkflows()
  const { rows, stats } = layaTrainingRows(runs, workflows, { ai })

  if (query.format === 'summary') {
    return stats
  }

  const runById = new Map(runs.map(run => [run.id, run]))
  const selected = query.split === 'all'
    ? rows
    : rows.filter((row) => {
        const run = runById.get(row.meta.run)
        return run ? splitOf(run.itemKey, query.evalShare) === query.split : false
      })

  const filename = query.split === 'train'
    ? 'laya-train.jsonl'
    : query.split === 'eval'
      ? 'laya-eval.jsonl'
      : 'laya-training.jsonl'

  // Nuxt's portable RequestEvent is narrower than the h3 v1 event the runtime passes
  const h3Event = event as unknown as H3Event
  setResponseHeader(h3Event, 'content-type', 'application/x-ndjson; charset=utf-8')
  setResponseHeader(h3Event, 'content-disposition', `attachment; filename="${filename}"`)

  return selected.map(row => JSON.stringify(row)).join('\n')
})
