# DeepFlow Communications — Template System

**Status:** Draft for owner review.

---

## 1. A real Meta constraint this design must respect

WhatsApp Business Cloud API requires **pre-approved message templates** for any
business-initiated message sent outside the 24-hour customer service window (i.e. more
than 24 hours since the customer's last message). Free-form text only works for replies
within that window. This is a Meta platform rule, not a DeepFlow choice, and it directly
shapes the template system:

- Every WhatsApp template DeepFlow wants to send proactively (appointment reminders,
  invoice-due notices, payment chase stages) must be submitted to Meta for approval,
  under a template category (`UTILITY`, `MARKETING`, `AUTHENTICATION`), before it can be
  used outside the 24-hour window.
- Template variables in Meta's system are positional (`{{1}}`, `{{2}}`...), not named —
  DeepFlow's internal template model can keep named variables
  (`{{invoice_number}}`) for editability, but the Meta adapter (§02) must map them to
  positional slots at send time.
- Category matters for cost and delivery rules — `UTILITY` templates (appointment
  reminders, payment reminders) are generally the right category for this business;
  `MARKETING` templates are more restricted and typically costlier. Exact current Meta
  pricing/policy isn't something to assert here — verify against Meta's own
  documentation at implementation time, not hardcode a number that may already be stale.

This means the WhatsApp side of the template system has a real **approval-status
lifecycle** (`draft` → `submitted` → `approved`/`rejected`) that Email/Portal/Push
templates don't need.

## 2. Data model (extends `comm_templates` from §02)

```
comm_templates
  event_type          -- e.g. 'INVOICE_OVERDUE'
  channel             -- 'WHATSAPP' | 'EMAIL' | 'PORTAL' | 'PUSH'
  subject             -- email only
  body                -- template text with {{named_variables}}
  meta_template_name  -- WhatsApp only, once submitted
  meta_category       -- WhatsApp only: UTILITY | MARKETING | AUTHENTICATION
  approval_status      -- WhatsApp only: draft | submitted | approved | rejected
  is_active
  updated_at, updated_by
```

## 3. Safe variables

Only render variables actually verified present on the underlying record — never emit
`undefined`, `null`, or `[object Object]` into a customer-facing message. Concretely:
the render function should fail loudly (log + fall back to a safe generic phrase, e.g.
"your property" instead of a blank) rather than silently interpolate a missing value.
This is a stricter rule than the current `fillTemplate()` helper in `@business`
enforces today (confirmed in §00 — current WhatsApp templates just do a series of
`.replace()` calls with no missing-variable guard) — the new system should not carry
that gap forward.

Proposed variable set (superset of the master prompt's list, cross-checked against what
DeepFlow's data model can actually supply):

`{{client_name}}` `{{contact_name}}` `{{job_number}}` `{{property_address}}`
`{{appointment_date}}` `{{time_slot}}` `{{engineer_name}}` `{{invoice_number}}`
`{{invoice_amount}}` `{{invoice_due_date}}` `{{certificate_type}}`
`{{certificate_reference}}` `{{portal_link}}` `{{company_name}}` `{{company_phone}}`

Every one of these must map to a real field already confirmed to exist in DeepFlow's
schema (job/invoice/certificate/settings tables) — no template variable gets added
without a confirmed source field.

## 4. Migration from existing templates

`S.waJobTpl`, `S.waInvTpl`, `S.waOverdueTpl`, `S.waTenantTpl`, `S.waLandlordTpl` — the
five existing flat WhatsApp template strings (confirmed in §00) — become the seed rows
for `comm_templates` (`channel='WHATSAPP'`), not thrown away. Their content stays
editable in Settings the same way it is today; what changes is that each is now scoped
to a specific `event_type` and gets a Meta approval-status lifecycle once it's
resubmitted as an approved WhatsApp template (existing free-text templates sent via
`wa.me` links were never subject to Meta's approval requirement in the first place,
since they're not Cloud API sends — this is a genuinely new constraint the Meta
migration introduces, not something the old system had to deal with).

## 5. Preview & validation tooling

Settings → Communications → Templates needs, per the master prompt (reasonable, keeping
as specified):
- Live preview with realistic sample data (matching the existing `previewWaTemplate`
  UX already built in `invoices-misc-actions.js` — same interaction pattern, extended
  to all channels and to flag missing/unmapped variables before save).
- "Send Test" to a staff-chosen number/email, gated the same way any other manual send
  is (BRD approval gates).
- For WhatsApp specifically: show current Meta approval status, and block activating a
  template for automated sending until `approval_status = 'approved'`.
