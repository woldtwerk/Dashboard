# Mail: reload the "all folders" list on changes in any folder

## Goal
When the mail list shows all folders (`?scope=all`) or a search across folders, a sync
that changed any folder reloads the list.

## Known
- `mailRefreshFor(event, { service, mailbox })` decides what a domain event reloads; it
  sets `list: true` only when the event's `resource` is the current mailbox. In the
  all-folders scope the current `mailbox` is irrelevant, so changes elsewhere never
  reload the list (the refresh button still works).

## Steps
1. Pass the scope into `mailRefreshFor`; with `allFolders` any `changed` event of the
   service reloads the list (debounced as today). Same for the conversations view if it
   ever spans folders.
2. Tests for the matcher: all-folders + other mailbox → reload; single folder + other
   mailbox → no reload.

## Verify
lint, typecheck, test; all-folders view open, a new mail arrives in another folder →
the list updates.
