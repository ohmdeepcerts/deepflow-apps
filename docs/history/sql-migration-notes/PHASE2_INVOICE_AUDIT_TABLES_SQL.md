# Invoice audit trail — missing tables

From the earlier full audit (Finding 2.2): the Office App's invoice detail
screen has a "history" timeline panel that reads two tables —
`invoice_audit` and `invoice_payments` — that were never actually created.
The read is wrapped in a try/catch, so nothing ever errored or looked
broken; the panel just silently renders "No audit entries yet" forever.

The app code itself is already correct and doesn't need any changes — this
is purely a missing migration.

```sql
CREATE TABLE IF NOT EXISTS invoice_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "invoiceId" text NOT NULL,
  action text,
  details text,
  "from" text,
  "to" text,
  "user" text,
  timestamp bigint
);
CREATE INDEX IF NOT EXISTS invoice_audit_invoiceid_idx ON invoice_audit("invoiceId");

CREATE TABLE IF NOT EXISTS invoice_payments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "invoiceId" text NOT NULL,
  amount numeric,
  method text,
  created bigint
);
CREATE INDEX IF NOT EXISTS invoice_payments_invoiceid_idx ON invoice_payments("invoiceId");

ALTER TABLE invoice_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_payments ENABLE ROW LEVEL SECURITY;

-- Staff-only, same as every other internal Office App table — not portal-facing.
CREATE POLICY "invoice_audit_staff_only" ON invoice_audit
FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "invoice_payments_staff_only" ON invoice_payments
FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

**What this actually fixes, and what it doesn't:**

- `invoice_audit` — the app already writes one real entry here: when a
  proforma is converted to a real invoice (`convertProformaToInvoice()`).
  Once this table exists, that entry will show up correctly in the timeline,
  alongside the always-present "CREATED" entry the panel synthesizes from
  the invoice's own `created` date. Other action types the panel already
  knows how to *display* (edit, sync, deleted, sent, paid, status) are not
  currently *written* anywhere in the code — the display logic was built
  ahead of the write calls for those, so you won't see those on any invoice
  even after this table exists.
- `invoice_payments` — I checked: **nothing in the codebase writes to this
  table at all**, only reads it. Creating it stops the read from silently
  failing, but the "Payment recorded" line will never appear until a write
  path is added somewhere (e.g. a "Record Payment" button that isn't wired
  up yet, or doesn't exist yet). That's a small, separate feature to build
  if you want it — let me know and I'll wire it up.
