# Mail: push sync via IMAP IDLE

## Goal
New mail and flag changes reach the dashboard within seconds instead of on the next
`mail:sync` run (every minute, stale after 2 min).

## Known
- Proton Bridge advertises `IDLE`, and pushes events to a connection that holds
  `INBOX` selected. Verified on 2026-10-20 with a probe against the ddev Bridge: a test
  mail arrived as `exists` (count 4910 → 4911), and read marks arrived as `flags`
  events within about a second.
- ImapFlow emits `exists`, `expunge` and `flags` on the client and enters IDLE on its
  own once the connection is idle. Today every connection is short-lived
  (`withProtonBridge` / `withProtonMailbox` in `layers/mail-proton/server/proton/bridge.ts`),
  so nothing listens.
- IDLE watches one mailbox per connection.
- `syncMailService` takes a per-service lock; `mail:sync` stays as the fallback for
  the other folders and for missed events.

## Steps
1. Provider port: an optional `watch(mailbox, onChange): Promise<() => Promise<void>>`
   on `MailProvider`. Proton implements it with one long-lived ImapFlow connection
   (`mailboxOpen`, listen to `exists`/`expunge`/`flags`, reconnect with backoff on
   `close`/`error`).
2. Cluster: only one worker holds the watchers. A leader lock in shared storage
   (`withLock`-style with a TTL, renewed while watching). A worker that loses or fails to
   renew the lock closes its connections. The other workers try to take the lock from a
   scheduled task, so a dead leader is replaced within a minute.
3. On an event, debounce per service (~2 s) and run `syncMailService(service)`. Its lock
   already prevents a parallel sync. Watch `INBOX` only at first.
4. Start/stop with the service lifecycle (`serviceHooks` added/removed) and on shutdown
   (close connections, release the lock).
5. Tests: debounce and the leader decision as pure functions; the provider's
   watch with a fake ImapFlow client (event → callback, close → reconnect).

## Verify
lint, typecheck, test; with the app running, send a mail to the account → the list
updates within a few seconds without a reload; stop the leader worker → another one
takes over within a minute.
