# DeepFlow — Backlog

Real, known issues and deferred decisions — not a design doc, just a running list so
things raised in conversation don't get lost. Newest first within each section.

## Open

- **Editing an already-`Paid` invoice's line items doesn't reopen it for payment.**
  Nothing in the invoice editor blocks adding/changing items on an invoice whose
  `status` is already `'Paid'`, and doing so does not revert that status. The invoice
  keeps showing as fully-paid revenue everywhere (dashboard, invoice list, aging
  report) while the real new/updated amount owed goes untracked, until someone
  happens to reopen that specific invoice's payment modal and notices the mismatch
  between `calcInvTotal()` and what was actually paid.
  **Correct behavior today** (not a bug, a workflow requirement office needs to know):
  once an invoice is `Paid`, a genuinely new charge (e.g. extra work agreed after the
  original job/invoice was already settled) should go on a **new** invoice — a
  Disposable Invoice or a proforma linked to the same job — not be added as a line
  item on the closed one. Raised 2026-09-04 while explaining a real pre-payment
  scenario (client pays for an EICR upfront, extra work found and charged separately
  mid-job). No fix scoped yet — options would be either a hard UI guard (block/warn on
  editing a Paid invoice's items) or an explicit "reopen for amendment" action that
  visibly reverts status first. Deferred at the owner's request — not urgent, revisit
  when convenient.

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
