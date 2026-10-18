import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type {
  AutomationDomain,
  AutomationMode,
  WorkflowGraph
} from '../../shared/types/automation'

/** Workflows the user built; the engine runs them on new mail and documents */
export const automationWorkflows = sqliteTable('automation_workflows', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  domain: text('domain', { enum: ['mail', 'documents'] }).$type<AutomationDomain>().notNull(),
  /** A service id, or null for every service of the domain */
  service: text('service'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  mode: text('mode', { enum: ['suggest', 'auto'] }).$type<AutomationMode>().notNull().default('suggest'),
  /** Lower runs first */
  position: integer('position').notNull(),
  /** The node graph (see shared/types/automation WorkflowGraph) */
  graph: text('graph', { mode: 'json' }).$type<WorkflowGraph>().notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
}, table => [
  index('automation_workflows_domain_idx').on(table.domain),
  index('automation_workflows_position_idx').on(table.position)
])

export type AutomationWorkflowRow = typeof automationWorkflows.$inferSelect
