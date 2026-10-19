# Bulk actions for selected items

## Goal
With several mails selected, mark them read/unread or delete them in one go; offer
multi-select in the conversations view and the documents list too.

## Known
- Mail multi-select exists: Ctrl/⌘-click, Shift-click, `?sel=` in the URL
  (`layers/mail/app/utils/mail-selection.ts`), right-click acts on `contextTargets`.
  For several targets the menu only shows item actions with `multiple: true`
  (core `itemActionMenuItems`).
- Delete is optimistic with undo for one mail (`deleteMail` in `pages/mail.vue`);
  permanent delete in the trash asks first.

## Steps
1. Mail: domain entries for several targets in `mailContextMenuItems` — "Mark as read",
   "Mark as unread", "Delete" (N mails). Optimistic like the single versions; one toast
   with a single Undo for the whole batch; permanent delete asks once for all.
   Server: batch endpoints or sequential calls with a concurrency limit — prefer one
   endpoint per action taking up to 200 uids per mailbox.
2. The selection bar gets the same three buttons.
3. Conversations view: select conversations the same way; actions apply to all mails of
   the selected conversations (delete only single-mail conversations, as today).
4. Documents list: the same selection util pattern (`?sel=`), "Run workflow" for several.
5. Pure logic (batch planning, undo snapshot) in utils with tests.

## Verify
lint, typecheck, test; select 3 mails → delete → undo restores all three.
