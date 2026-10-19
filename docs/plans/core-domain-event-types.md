# Core: domain event types beyond changed/synced

## Goal
Let a layer publish its own event types instead of encoding them into the `resource`
of a `changed` event.

## Known
- `DomainEvent['type']` and the zod `eventSchema` in core only accept
  `changed | synced | sync-failed`; the broker drops anything else
  (`parseDomainEventValue`).
- The automation layer works around it: workflow pop-ups are `changed` events on
  domain `automation` with resource `modal:<runId>.<nodeId>`
  (`layers/automation/shared/extractors.ts` helpers, `automation-modal.client.ts`).

## Decisions to make
- Free-form types (`string`, validated by pattern `[a-z][a-z0-9-]{0,31}`) vs. a
  registry where a layer declares its types. Recommendation: free-form with the
  pattern; consumers already filter by domain.

## Steps
1. Widen the type and the schema in core (`shared/types` + the event schema), keep the
   three existing types as documented well-known values.
2. Move the automation pop-up to `type: 'modal'` (resource `<runId>.<nodeId>`) and the
   review-count update to `type: 'review'`; keep accepting the old `changed` + prefix for
   one release so open tabs keep working during an update.
3. Tests for the schema (accepts custom, rejects bad names) and the broker round trip,
   and the automation consumers.

## Verify
lint, typecheck, test; a pop-up still opens live in a second tab.
