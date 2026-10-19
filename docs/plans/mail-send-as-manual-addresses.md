# Mail: manual "send as" addresses

## Goal
Aliases that were never (or not recently) sent from can still be picked in the
composer's From select.

## Known
- `mailOwnAddresses(service)` (`layers/mail/server/utils/mail-identity.ts`) = setup login
  + From addresses of the 20 newest Sent mails, cached in shared storage for 10 min.
  IMAP offers no list of a Proton account's addresses.
- `GET /api/mail/addresses` feeds the From select; `resolveSenderAddress` only allows
  addresses from that list (no spoofing).

## Steps
1. Mail settings (`layers/mail/app/components/settings/SettingsMail.vue` and the mail
   settings type/server): per account a list of extra sender addresses
   (validated email, max ~50).
2. `mailOwnAddresses` merges them (setup first, then manual, then Sent); invalidate the
   identity cache when the setting changes.
3. A manual address the provider rejects on send surfaces the SMTP error as today.
4. Tests: merge order and dedupe, validation, cache invalidation.

## Verify
lint, typecheck, test; add an alias in settings → it appears in the From select →
sending from it reaches the recipient with that From.
