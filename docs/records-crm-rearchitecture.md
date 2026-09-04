# Records/CRM Rearchitecture — Clients, Properties, Compliance

**Status:** Phase 1 (Properties) shipped 2026-09-04. Clients/contact_roles and
Compliance (requirement-vs-certificate) are still scoping only — deliberately
deferred, not started. Raised 2026-09-04 from an owner-supplied ChatGPT proposal to
rethink Directories/Properties/Certificates/Client View as one connected system;
the audit in §2 verified that proposal's factual claims against the real code
before any architecture recommendation was made.

## Phase 1 — Properties (done)

Properties are now a real `properties` table (id, address, normalized_address,
postcode, landlord_name, agency_name, property_type, bedrooms, notes,
manual_override), not the `app_settings` JSON blob described as the biggest gap in
§2's audit below. `jobs.property_id` links every job to its property.

- **Backfilled from live data**, not a fresh-install-only migration: 4,096 jobs with
  an address → 3,428 distinct properties, verified zero left unlinked, zero
  duplicate `normalized_address` values, spot-checked against real records before
  being called done.
- `saveJob()` now resolves-or-creates the property on every save
  (`_resolvePropertyForJob`), respecting a manually-edited property's
  landlord/agency (won't silently overwrite office's own correction) while still
  filling in a missing postcode automatically.
- The Properties page, its Add/Edit modal, CSV export, and the Certificates
  dashboard's property-compliance grid all read/write the real table now — no
  UI surface was left pointed at the old blob.
- **Deliberately excluded from this phase**: UPRN / paid address-validation (no new
  vendor/cost decision was needed or made — this uses the same free postcode data
  already on job records); the Clients/contact_roles rearchitecture below (a
  separate, larger, still-open decision).

## What's still open (unchanged from the original scoping below)

---

## 1. Why this matters now

Two things make this the right moment to decide, even if the work itself is deferred:

1. **Two companies are being introduced** (OHM Electrical + a second company). Every
   transactional record (job, invoice, certificate) needs its own `company_id` either
   way — doing that FK work at the same time as fixing the client/property identity
   model avoids touching the same rows twice.
2. **This is live production data with no staging environment.** Every schema change
   discussed here would run directly against the one real Supabase project. That's
   not a reason to avoid the work — it's a reason to sequence it carefully, the same
   dual-write/verify/cutover discipline already used for the communications platform's
   Twilio→Meta migration plan (`docs/communications/03-META-MIGRATION-PLAN.md`).

## 2. Verified current state (read from the actual code, 2026-09-04)

Not assumptions — each of these was confirmed by reading the real source before this
document was written:

| Area | Confirmed reality |
|---|---|
| Directories | 5 separate sections (`renderLandlordsSection`, `renderAgenciesSection`, `renderAgentsSection`, `renderEngineersSection`, `renderSubcontractorsSection` — `apps/office/directory-sections.js`), backed by **3 separate DB tables**: `persons`, `agencies`, `agents` (`supabase/migrations/0000_initial_schema.sql`). No unified `contacts` table exists. `portal_contacts` is a different thing (portal login access, not a CRM contact record). |
| Duplicate merging | Real and already reasonably sophisticated — persons merge (`main.js:9132-9283`) and agency/agent merge (`main.js:9283-9552`) both attempt to move linked jobs/invoices/certs to the surviving record. Worth preserving, not rebuilding. |
| Client View | Name/type-based, not ID-based: `openClientView(name, type)` → `cvSearch(name)` (`main.js:8975`) — a string search, not a row lookup. |
| Client↔job/invoice linking | **Partially ID-based already**, not purely name-based as first assumed — `clientId` FKs exist and are used in places (e.g. invoice-owed sorting: `i.clientId===a.id`), but jobs fall back to `j.referrer===a.name||j.clientId===a.id` (name OR id). A half-finished migration, not a green-field problem. |
| Properties | **Not a database table at all.** Lives entirely as a JSON blob inside `app_settings`, written via `saveSetting('properties', props)` (`main.js:432,7028`). No `property_id` exists anywhere in the system. This is the single most justified structural gap found — worse than the original proposal assumed. |
| Certificates | Genuinely feature-rich already — 8 extracted files (`certs-core/list/form/stats-dashboard/reminders/missing-expiring/pdf/appliances.js`) covering dashboard, expiring/missing tracking, reminders, stats, PDF generation with payment-gated release/watermarking (`certs-pdf.js` — see `_isJobPaid()`). This is a strength to build on, not replace. |

## 3. Proposed target shape (direction, not a final schema)

Collapse the left-nav from 4 destinations to 3, matching the original proposal:

```
RECORDS
  Clients       (replaces Directories' Landlord/Agency/Agent views + Client View)
  Properties    (a real table for the first time)
  Compliance    (renamed from Certificates — requirement-vs-certificate distinction)

WORKFORCE
  Engineers
  Subcontractors
  Engineer Reports
```

**Client View stops being a separate nav destination** — it becomes the detail/profile
screen reached by clicking a client inside Clients, the same pattern `viewInv`/job
detail already use elsewhere in this app.

### Data model direction (needs real design work, not copy-pasted here as final)

- `client_accounts` / `contacts` / `contact_roles` — replacing the `persons`/
  `agencies`/`agents` three-way split, so "N&N Properties" and its three named
  contacts are one connected record instead of disconnected rows matched by name.
- `properties` table with a real `property_id`, ideally anchored to a UPRN (via an
  address-validation provider — see §5, this needs its own cost/provider decision,
  same as the master communications prompt already flagged address-lookup changes as
  out of scope without separate approval).
- `property_relationships` (property ↔ client, with `start_date`/`end_date`) so
  ownership/management changes over time without breaking historical certificate
  records.
- **Requirement vs certificate as separate concepts** for Compliance: a property
  *requires* an annual Gas Safety certificate; a certificate is evidence one specific
  requirement-period was met. This is a genuine product improvement, not just a
  rename — it lets the system detect "this property has no Gas cert at all" instead
  of only "this Gas cert expired."

## 4. What must NOT be rebuilt — carry these forward as-is

The existing feature set here is good and shouldn't be lost chasing the new
architecture: duplicate-merge logic, archived-contact handling, payment reliability
scoring, client statistics, portal invitations, property/compliance KPI dashboards,
expiry forecasting, missing-certificate workflow, reminder engine, CSV import/export,
bulk certificate actions, PDF generation with payment-gated release, job linking,
appliance logging. The architecture changes; the business logic that already works
does not need re-proving.

## 5. Explicit non-goals for this document / this phase

- No schema migration is proposed or scheduled here.
- No new address-lookup/UPRN provider is chosen — that's its own cost/vendor decision
  requiring separate owner approval, same rule already established for the
  communications platform.
- No UI rebuild starts from this document.
- This does not replace or compete with the communications platform work — the two
  are independent; `client_id`/`property_id` becoming real, stable identifiers would
  actually *strengthen* the communications platform's own entity-linking (`comm_events`,
  `client_comm_preferences` already reference `persons`/`agencies`/`agents` by id) —
  worth revisiting that linkage once/if this rearchitecture proceeds, not before.

## 6. Open decisions needing owner input before any build phase

1. **Priority** — where does this sit relative to Communications Phase D onward and
   any other in-flight work? Not urgent by default; raised for a deliberate decision,
   not because anything is currently broken for daily use.
2. **UPRN/address-validation provider** — a real recurring cost decision (e.g. Ideal
   Postcodes), separate from the existing `postcodes.io` lookup already in use.
3. **`contact_roles` taxonomy** — which roles actually matter for this business
   (Landlord, Agent, Property Manager, Accounts, Tenant, Owner, Site Contact,
   Director, etc.) — a business-policy question, not a technical one.
4. **Migration approach for existing data** — every current job/invoice/certificate
   was written against `referrer`/`landlordName`-style name fields. A real plan is
   needed for backfilling `client_id`/`property_id` onto historical rows (or
   deliberately leaving history on the old fields and only requiring the new ones
   going forward) — mirrors the communications platform's own explicit
   "backfilling historical records is a separate approval gate" rule
   (`docs/communications/01-COMMUNICATIONS-BRD.md` §7).
5. **Whether to do this in one connected effort or split further** — e.g. "fix
   Properties as a real table" is the most justified, most isolated piece and could
   reasonably ship on its own before the larger Clients/contact_roles rework, if the
   owner wants incremental value sooner rather than one large combined change.
