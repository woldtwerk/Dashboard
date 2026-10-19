# Automation: review badge updates live

## Goal
The "Activity" badge (sidebar child and the automation section menu) shows the number
of runs waiting for a human check. It should change the moment a run starts or stops
waiting, not only on the next page load.

## Known
- The count comes from `GET /api/automation/runs/review-count` (`countRunsAwaitingReview`
  in `layers/automation/server/utils/runs.ts`), loaded lazily by
  `useAutomationNavigation` and the section header with a shared key.
- The client refreshes it on `automation` domain events, but the only automation event
  today is the workflow pop-up (`changed` with resource `modal:<runId>.<nodeId>`).

## Steps
1. Publish an automation domain event whenever a run's outcome becomes or stops being
   `review`: when `recordWorkflow` records a review run, when `answerReview` resolves one,
   and when a review is dismissed (reject). Use a resource prefix that cannot be mistaken
   for the pop-up, e.g. `runs:review` — or a proper event type once
   [core-domain-event-types.md](core-domain-event-types.md) is done.
2. The navigation provider and the header refresh the count on that event (debounced).
   The pop-up plugin must keep ignoring it (it only reacts to `modal:`).
3. Tests: engine tests assert the publish on record/answer/dismiss; a pure test for the
   resource helpers.

## Verify
lint, typecheck, test. In the browser: a workflow with a human check run by hand on a
mail → the badge goes up without a reload; answering it → the badge goes down.
