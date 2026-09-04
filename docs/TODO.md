# DeepFlow — Backlog

Real, known issues and deferred decisions — not a design doc, just a running list so
things raised in conversation don't get lost. Newest first within each section.

## Open

*(nothing open right now)*

## Investigated further — not actually a gap

- **~~Editing an already-`Paid` invoice's line items doesn't reopen it for payment~~ —
  correction: it already can't.** Logged 2026-09-04 based on reading only
  `addInvItem()`/`renderInvItems()` in isolation, which really don't guard anything.
  Tracing the actual save path they feed into (`saveInv()` → `saveInvWithJobSync()`,
  `apps/office/main.js:8242`) found a hard block already in place: saving any edit
  while `existingInv.status==='Paid'` is rejected outright with *"This invoice has a
  recorded payment — use 'Unlock for correction' (admin only) before editing."* That
  points at `unlockPaidInv()` (`main.js:5783`) — admin-only, confirms via a dialog that
  warns it's audit-logged, explicitly reverts `status` to `'Awaiting Payment'`, and
  only then does editing proceed normally. So both halves of what a real fix would
  need — a hard guard, and an explicit reopen-for-amendment action that visibly
  reverts status first — already exist and already work together correctly. No code
  change needed; this entry stays only as a record of the correction.

## Fixed

- **Credit notes didn't reduce the original invoice's own total.** `saveCreditNote()`
  (`apps/office/credit-notes.js`) only ever created the separate Credit Note row —
  the original invoice's `items[]`/total were never touched. Since `calcInvTotal()`
  computes purely from an invoice's own items, every "outstanding"/"owed" figure that
  reads it (payment modal, dashboard Awaiting-Payment KPI, invoice list's owed badge,
  client-sort-by-owed) kept showing the full pre-credit amount forever — only the
  printed Client Statement (`statements.js`) separately netted credit notes off, so
  office and the client-facing statement disagreed on what was actually owed. Fixed
  2026-09-04 by appending the credited items back onto the original invoice, negated,
  so its own `calcInvTotal()` reflects the reduction everywhere that already reads it.
  If the original was already `Paid`, this correctly surfaces a refund-due situation
  via the existing `outstanding = grand - paid` math rather than a new mechanism.
