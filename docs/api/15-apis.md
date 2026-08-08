# 15 — APIs

DeepFlow has no separate backend server. The three apps (Office, Engineer, Client Portal) talk to exactly two API surfaces on the same Supabase project, **`dzqyqpuhxdrrpipbehpk`**:

1. **PostgREST** — Supabase's auto-generated REST/RPC layer over the Postgres schema (`SB_URL/rest/v1/...`), gated by Row Level Security.
2. **Edge Functions** — seven hand-written Deno functions (`SB_URL/functions/v1/...`) for anything RLS/RPC alone can't do: calling a third-party API (Stripe, Gemini, OCR.space, Resend/SendGrid, web-push), or needing a server-side identity check the Client Portal's session-less model can't do itself.

This document covers the *shape* of every call on both surfaces — method, headers, body, response, status codes. It does not re-list what each table or RPC *does* (that's [05-database.md](../architecture/05-database.md) and [06-supabase.md](../architecture/06-supabase.md)) or repeat the Storage access-control mechanism ([09-storage.md](../architecture/09-storage.md)) beyond what's needed to explain `portal-sign-url`'s contract.

**Methodology:** every Edge Function contract below was read directly from its full source (`supabase/functions/<name>/index.ts`) in this session — request fields, response shapes, status codes, and auth checks are transcribed from the actual code, not inferred from the name or from `06-supabase.md`'s summary table (which this document intentionally goes deeper than). Every "how an app actually calls this" claim is grounded in a real call site, found by grepping `functions/v1/` and `rest/v1/rpc/` across `apps/office/*.js`, `apps/engineer/*.js`, `apps/portal/*.js`, and `packages/core/supabase.js` — not assumed from the function's own code alone, since a function's *contract* and how it's *actually invoked* can differ (e.g. the Portal sends the anon key itself as its `Authorization` bearer token, which is easy to miss from the function source alone). Example request/response bodies use realistic but synthetic values — no real customer data appears anywhere below.

---

## 1. Base URLs

| Surface | Base | Example |
|---|---|---|
| PostgREST (database) | `https://dzqyqpuhxdrrpipbehpk.supabase.co/rest/v1/` | `GET /rest/v1/jobs?status=eq.Pending` |
| Edge Functions | `https://dzqyqpuhxdrrpipbehpk.supabase.co/functions/v1/` | `POST /functions/v1/send-email` |
| Storage (referenced, not detailed here) | `https://dzqyqpuhxdrrpipbehpk.supabase.co/storage/v1/` | see [09-storage.md](../architecture/09-storage.md) |

Every app resolves these from the one hardcoded pair `SB_URL`/`SB_KEY` in `packages/core/supabase.js:16-18` (see [06-supabase.md §1](../architecture/06-supabase.md#1-client-setup) for why that's hardcoded rather than env-driven) — there is no per-environment API base anywhere in the codebase.

---

## 2. PostgREST — the auto-generated REST/RPC surface

### 2.1 Auth headers — the pattern every call shares

Every PostgREST request carries two headers, built by the shared `restFetch()` helper (`packages/core/supabase.js:55-73`) or an app-specific thin wrapper around it:

| Header | Value |
|---|---|
| `apikey` | Always the anon key, `SB_KEY` — identifies the calling project |
| `Authorization` | `Bearer <token>` — the logged-in user's Supabase Auth JWT (Office/Engineer, password-mode), the bare anon key `SB_KEY` (Client Portal, or Office/Engineer with no active session — `makeJwtResolver()`, `packages/core/supabase.js:34-43`, falls back to it), or unused entirely when the caller instead sends `x-engineer-token` (Engineer PIN/token-mode sessions) |
| `x-engineer-token` | Only sent by token-mode Engineer sessions, in addition to (not instead of) `Authorization: Bearer <anon key>` — matched server-side against `users.session_token` by the `is_valid_engineer_token()` RLS helper |

Which identity actually gets *through* is entirely down to Row Level Security evaluating that token against the policies in [06-supabase.md §3.4](../architecture/06-supabase.md#34-full-live-policy-reference) — PostgREST itself performs no authorization beyond passing the JWT along to Postgres.

`restFetch()` also sets the request's `Prefer` header based on method, unless the caller overrides it: `return=minimal` for `PATCH`, `return=representation` for `POST` (so an insert's response body echoes the inserted row), nothing for `GET`/`DELETE`.

### 2.2 Table reads/writes — `rest/v1/<table>`

Standard PostgREST query-string filtering (`column=op.value`), `select=`, `order=`. Example — Office App fetching one day's jobs:

**Request**
```
GET /rest/v1/jobs?date=eq.2026-08-10&order=sortorder.asc&select=*
apikey: <anon key>
Authorization: Bearer <office user's Supabase JWT>
```

**Response — 200 OK**
```json
[
  {
    "id": "job-1773100000-a1b2",
    "jobnum": "JOB-1042",
    "address": "12 Example Street, Sample Town",
    "date": "2026-08-10",
    "status": "Pending",
    "engineer": "J. Smith",
    "price": 150,
    "created": 1773100000000
  }
]
```

**Response — 401 Unauthorized** (expired/invalid JWT)
```json
{ "code": "PGRST301", "message": "JWT expired" }
```
A write that RLS rejects (rather than an outright bad token) instead comes back as an empty `200`/`204` with zero rows affected, or a `403` with a Postgres policy-violation message — PostgREST surfaces whatever Postgres itself returns; there is no DeepFlow-specific error shape layered on top.

### 2.3 RPC calls — `rest/v1/rpc/<function_name>`

Every Postgres function callable from the client (the `SECURITY DEFINER` catalog in [06-supabase.md §3.5](../architecture/06-supabase.md#35-security-definer-rpcs--the-anonauthenticated-split)) is called the same way: `POST` to `rpc/<name>`, JSON body whose keys are the function's named parameters. Example — Client Portal resolving a landlord's jobs (`apps/portal/main.js:621`):

**Request**
```
POST /rest/v1/rpc/portal_get_jobs
apikey: <anon key>
Authorization: Bearer <anon key>
Content-Type: application/json

{ "p_type": "landlord", "p_id": "b6b6f2a0-1234-4abc-9def-abc123456789" }
```

**Response — 200 OK**
```json
[
  { "id": "job-1773100000-a1b2", "jobnum": "JOB-1042", "address": "12 Example Street, Sample Town", "status": "Completed", "date": "2026-08-01" }
]
```

RPCs that return a scalar (e.g. `portal_pin_verify`) return that scalar directly as the JSON body (`true`/`false`), not wrapped in an array or object.

**This document deliberately does not catalogue what each RPC or table does, or the RLS policy behind it** — see [05-database.md](../architecture/05-database.md) for the schema and [06-supabase.md §3](../architecture/06-supabase.md#3-row-level-security) for the full RLS/RPC reference. This section's job is only the request/response *shape*.

---

## 3. Edge Functions — full contracts

All seven are `Deno.serve` functions, all `ACTIVE` on the live project, all deployed from `supabase/functions/<name>/index.ts`. Six respond with JSON and handle `OPTIONS` for CORS preflight; `stripe-webhook` is the one exception (plain-text response, no CORS handling — its only caller is Stripe's own servers, which don't preflight). `verify_jwt` (the platform-level gate, checked *before* the function code even runs) is off for six of the seven — each function does its own in-code authorization instead, documented per-function below. `send-push` is the only function with `verify_jwt` on, layered with an additional manual check (Section 3.6). See [06-supabase.md §7](../architecture/06-supabase.md#7-edge-functions--overview) for the one-paragraph-per-function overview this document expands on.

### 3.1 `create-checkout-session`

Creates a Stripe Checkout Session for one invoice's outstanding balance. Source: `supabase/functions/create-checkout-session/index.ts`.

**Endpoint:** `POST /functions/v1/create-checkout-session` · CORS: `authorization, x-client-info, apikey, content-type` / `POST, OPTIONS`

**Auth mechanics** (`index.ts:47-78`) — two independent paths, either satisfies:
- **Office App:** `Authorization: Bearer <Supabase JWT>` — verified via `supabase.auth.getUser(token)`; any authenticated user passes (no role check beyond "logged in").
- **Client Portal:** no real session exists, so the body itself carries `portalType`/`portalId`. The function re-fetches the invoice, then checks `portalId` against `invoices.client_person_id`/`client_agency_id` first, falling back to a case-sensitive JS array-`includes` match of the resolved `persons.name`/`agencies.name` against `invoices.clientname`/`landlordname`/`agencyname`/`billtoname` — the same two-step resolution `portal_get_invoices` uses server-side (`index.ts:54-77`). The match is done in JS, not interpolated into a query filter, specifically so a name containing a comma or special character can't change a filter's meaning.

At the transport level the Portal still sends `apikey` and `Authorization: Bearer <anon key>` (`apps/portal/invoice-pdf.js:31-35`) — that JWT is *not* what authorizes the request here; `portalType`/`portalId` in the body is.

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `invoiceId` | string | yes | |
| `portalType` | `"landlord"` \| `"agency"` | Portal calls only | |
| `portalId` | string | Portal calls only | the visitor's `persons.id`/`agencies.id` |

**Response**

| Status | Body | When |
|---|---|---|
| 200 | `{ "url": string }` | Stripe Checkout URL, ready to redirect the browser to |
| 400 | `{ "error": "Invalid request body" }` / `{ "error": "invoiceId is required" }` / `{ "error": "This invoice is not payable" }` (status is `Cancelled`/`Disposable`) / `{ "error": "This invoice is already fully paid" }` | |
| 403 | `{ "error": "Not authorized to pay this invoice" }` | neither auth path matched |
| 404 | `{ "error": "Invoice not found" }` | |
| 405 | `{ "error": "Method not allowed" }` | non-`POST` |
| 502 | `{ "error": "<Stripe's own error message>" }` | Stripe API call itself failed |
| 503 | `{ "error": "Payments are not configured yet — ask the office to finish Stripe setup." }` | `STRIPE_SECRET_KEY` unset |

The outstanding amount is computed server-side from `invoices.items` (line qty × unit price, plus VAT per-line where `vat: true`, at `app_settings`'s `vatRate`) minus the sum of `payments.amount` for that invoice — never from `invoices.total`, which is a stale, always-zero column (`index.ts:81-98`; see [05-database.md §3.4](../architecture/05-database.md#34-invoices--every-kind-of-billing-document)).

**Example — Client Portal paying an invoice**

Request:
```
POST /functions/v1/create-checkout-session
apikey: <anon key>
Authorization: Bearer <anon key>
Content-Type: application/json

{
  "invoiceId": "inv-1773100200-x9k2",
  "portalType": "landlord",
  "portalId": "b6b6f2a0-1234-4abc-9def-abc123456789"
}
```

Response (200):
```json
{ "url": "https://checkout.stripe.com/c/pay/cs_test_a1B2c3D4E5F6G7H8I9J0#fq..." }
```

### 3.2 `stripe-webhook`

Receives Stripe's `checkout.session.completed` event and records the payment. Source: `supabase/functions/stripe-webhook/index.ts`. Never called by any DeepFlow app — only by Stripe's own servers, configured against this URL in the Stripe Dashboard.

**Endpoint:** `POST /functions/v1/stripe-webhook` · no CORS headers set at all (server-to-server only)

**Auth mechanics** (`index.ts:17-43`) — not a Supabase JWT at all. Stripe's own HMAC scheme: the `Stripe-Signature` header (`t=<timestamp>,v1=<hex hmac>`) is verified by recomputing `HMAC-SHA256(STRIPE_WEBHOOK_SECRET, "<timestamp>.<raw body>")` and comparing to `v1`, using the Web Crypto API directly (no Stripe SDK). A timestamp more than 300 seconds old or in the future is rejected outright, blocking replay of a captured request.

**Request body** — a raw Stripe Event object (`event.type`, `event.data.object`); only `checkout.session.completed` is handled, every other event type is acknowledged and ignored (`index.ts:46-48`). Fields actually read from `event.data.object`: `metadata.invoice_id` (falls back to `client_reference_id`), `payment_intent`, `amount_total` (pence).

**Response** — plain text, not JSON, unlike every other function here:

| Status | Body | When |
|---|---|---|
| 200 | `ok` | event processed (or ignored — non-`checkout.session.completed`, missing invoice/payment-intent id, invoice not found, or a duplicate delivery of an already-recorded payment) |
| 400 | `Invalid signature` | signature missing or doesn't verify |
| 405 | `Method not allowed` | non-`POST` |
| 503 | `Webhook not configured` | `STRIPE_WEBHOOK_SECRET` unset |

Idempotency is a lookup on `payments.ref = <payment_intent id>` before inserting (`index.ts:59-60`) — Stripe retries webhook delivery at-least-once, so a duplicate `checkout.session.completed` for an already-recorded payment is a normal `200 ok`, not an error. On success it inserts one `payments` row (`method: "Card (Stripe)"`, `recorded_by: "Stripe (automatic)"`) and flips `invoices.status` to `Paid` once the same items-based total computation as `create-checkout-session` shows the invoice fully covered.

**Example — Stripe → DeepFlow**

Request:
```
POST /functions/v1/stripe-webhook
Stripe-Signature: t=1773100260,v1=5257a869e7bce89f7d3b5f4a2c1e8d9f6a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d
Content-Type: application/json

{
  "id": "evt_1AbCdEfGhIjKlMnO",
  "type": "checkout.session.completed",
  "data": {
    "object": {
      "id": "cs_test_a1B2c3D4E5F6G7H8I9J0",
      "client_reference_id": "inv-1773100200-x9k2",
      "payment_intent": "pi_3AbCdEfGhIjKlMnOp",
      "amount_total": 10200,
      "metadata": { "invoice_id": "inv-1773100200-x9k2", "invoice_number": "INV-1042" }
    }
  }
}
```

Response (200): `ok`

### 3.3 `extract-cert-data`

Reads a photographed certificate or PAT appliance log and returns structured fields to pre-fill a form. Source: `supabase/functions/extract-cert-data/index.ts`.

**Endpoint:** `POST /functions/v1/extract-cert-data` · CORS: `authorization, x-client-info, apikey, content-type` / `POST, OPTIONS`

**Auth mechanics** (`index.ts:80-84`) — Office App only. Requires `Authorization: Bearer <Supabase JWT>`; verified via `supabase.auth.getUser(token)`. No portal or engineer-token path.

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `imageBase64` | string | yes | raw base64, no `data:` prefix |
| `mimeType` | string | yes | e.g. `"image/jpeg"` |
| `preferGemini` | boolean | no | defaults to using Gemini if configured; `false` forces straight to OCR.space |
| `mode` | `"cert"` \| `"appliances"` | no | defaults to `"cert"` (single certificate header fields) vs. `"appliances"` (a PAT test-log table, one row per appliance) |

**Auth-independent fallback logic:** tries Gemini (multimodal, `gemini-2.0-flash`) first when `preferGemini !== false` and `GEMINI_API_KEY` is set; on any Gemini failure (bad response, rate limit, network error, missing key), falls through to OCR.space (text-only, no structured fields — just raw OCR text) if `OCR_SPACE_API_KEY` is set (`index.ts:94-109`).

**Response**

| Status | Body | When |
|---|---|---|
| 200 (Gemini, `mode:"cert"`) | `{ "source": "gemini", "certNum": string\|null, "certType": string\|null, "issueDate": "YYYY-MM-DD"\|null, "expiryDate": "YYYY-MM-DD"\|null, "propertyAddress": string\|null }` | |
| 200 (Gemini, `mode:"appliances"`) | `{ "source": "gemini", "appliances": [{ "assetId": string\|null, "description": string\|null, "result": "Pass"\|"Fail"\|null }] }` | |
| 200 (OCR fallback, either mode) | `{ "source": "ocr", "rawText": string }` | no structured fields — OCR.space is text-only |
| 400 | `{ "error": "Invalid request body" }` / `{ "error": "imageBase64 and mimeType are required" }` | |
| 401 | `{ "error": "Not authorized" }` | |
| 405 | `{ "error": "Method not allowed" }` | |
| 502 | `{ "error": "OCR fallback also failed: <message>" }` | Gemini failed *and* the OCR fallback also failed |
| 503 | `{ "error": "AI extraction is not configured yet — ask the office to add a Gemini or OCR.space API key." }` | neither key configured |

**Example — reading a certificate photo** (`apps/office/certs.js:1609-1613`)

Request:
```
POST /functions/v1/extract-cert-data
apikey: <anon key>
Authorization: Bearer <office user's Supabase JWT>
Content-Type: application/json

{
  "imageBase64": "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkI...",
  "mimeType": "image/jpeg",
  "preferGemini": true
}
```

Response (200):
```json
{
  "source": "gemini",
  "certNum": "EICR-20260731-4821",
  "certType": "EICR",
  "issueDate": "2026-07-31",
  "expiryDate": "2031-07-31",
  "propertyAddress": "12 Example Street, Sample Town"
}
```

**Example — reading a PAT appliance log** (`apps/office/certs.js:1893-1897`, `mode:"appliances"`)

Response (200):
```json
{
  "source": "gemini",
  "appliances": [
    { "assetId": "0001", "description": "Kettle", "result": "Pass" },
    { "assetId": "0002", "description": "Microwave", "result": "Pass" },
    { "assetId": "0003", "description": "Extension lead", "result": "Fail" }
  ]
}
```

### 3.4 `rewrite-notes`

Rewrites an engineer's rushed on-site notes into clear English via Gemini. Source: `supabase/functions/rewrite-notes/index.ts`.

**Endpoint:** `POST /functions/v1/rewrite-notes` · CORS: `authorization, x-client-info, apikey, content-type, x-engineer-token` / `POST, OPTIONS` (the only function whose CORS allow-list includes `x-engineer-token`)

**Auth mechanics** (`index.ts:62-86`) — two paths, checked in order, either satisfies (`isAuthed()`):
1. `Authorization: Bearer <Supabase JWT>` — verified via `auth.getUser()`. Covers Office staff and password-mode engineers.
2. `x-engineer-token: <token>` — matched directly against `users.session_token` where `role='engineer' AND active=true AND session_expires > now()`. Covers PIN/token-mode engineers, who carry no Supabase session at all.

A token-mode Engineer session sends *both* headers on this call — `Authorization: Bearer <anon key>` (not a real user JWT, since there's no session to draw one from) plus `x-engineer-token: <real token>` (`apps/engineer/main.js:235-241`, the shared `_fnFetch()` helper used for this and every other Edge Function call the Engineer app makes). The function's path-1 check on the anon key fails (no real user behind it), then path-2 succeeds on the token header.

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `text` | string | yes | max 4000 characters |

**Response**

| Status | Body | When |
|---|---|---|
| 200 | `{ "rewritten": string }` | |
| 400 | `{ "error": "Invalid request body" }` / `{ "error": "text is required" }` / `{ "error": "Text too long (4000 characters max)" }` | |
| 401 | `{ "error": "Not authorized" }` | neither auth path matched |
| 405 | `{ "error": "Method not allowed" }` | |
| 502 | `{ "error": "Rewrite failed: <message>" }` | Gemini call failed |
| 503 | `{ "error": "AI rewrite is not configured yet — ask the office to add a Gemini API key." }` | `GEMINI_API_KEY` unset |

No OCR-style fallback exists here — a Gemini failure returns a clear error and the engineer's original text is left untouched by the caller (`apps/engineer/main.js:1258-1264`), rather than the function inventing a "good enough" rewrite.

**Example — token-mode Engineer app**

Request:
```
POST /functions/v1/rewrite-notes
apikey: <anon key>
Authorization: Bearer <anon key>
x-engineer-token: 7f3a9c2e1d0b4f5a8c6d2e1f0a9b8c7d
Content-Type: application/json

{ "text": "chkd db no earth on socket in kitchen replaced with new one tested ok also fuse box old need replacing customer said will book later" }
```

Response (200):
```json
{
  "rewritten": "Checked the distribution board — no earth detected on the kitchen socket. Replaced the socket and retested; reading OK.\n\n- The fuse box is old and will need replacing.\n- Customer said they will book this in separately."
}
```

### 3.5 `send-email`

Sends transactional email via Resend or SendGrid, switched by the `EMAIL_PROVIDER` secret. Source: `supabase/functions/send-email/index.ts`.

**Endpoint:** `POST /functions/v1/send-email` · CORS: `authorization, x-client-info, apikey, content-type` / `POST, OPTIONS`

**Auth mechanics** (`index.ts:94-98`) — Office App only, same pattern as `extract-cert-data`: `Authorization: Bearer <Supabase JWT>`, verified via `auth.getUser()`.

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `to` | string | yes | single recipient email |
| `subject` | string | yes | |
| `html` | string | yes | full HTML body |
| `cc` | string | no | single cc email |
| `replyTo` | string | no | Office App defaults this to the company's own email (`S.coEmail`) when omitted, at the call site not inside the function |
| `attachments` | `{ filename: string, content: string }[]` | no | `content` is raw base64 PDF bytes (no `data:` prefix); entries missing either field are silently filtered out (`index.ts:108-110`) |

**Response**

| Status | Body | When |
|---|---|---|
| 200 | `{ "id": string }` | provider's message id (Resend's own id; SendGrid returns its `x-message-id` header, or the literal string `"sent"` if that header is absent) |
| 400 | `{ "error": "Invalid request body" }` / `{ "error": "to, subject and html are required" }` | |
| 401 | `{ "error": "Not authorized" }` | |
| 405 | `{ "error": "Method not allowed" }` | |
| 502 | `{ "error": "<provider's own error message>" }` | Resend/SendGrid API call itself failed |
| 503 | `{ "error": "Email is not configured yet — ask the office to finish Resend setup." }` / `{ "error": "SendGrid is not configured yet — ask the office to finish setup." }` | required secrets for the active provider unset |

Reply-To is always sent to the provider regardless of which one is active — it is not a provider-specific field. `EMAIL_PROVIDER` defaults to `"resend"` if unset, but as of this session SendGrid is the one actually turned on in practice (Resend needs a verified sending domain; SendGrid's Single Sender Verification works with one verified address and no DNS work).

**Example — invoice-ready email** (`apps/office/main.js:5964-5975`)

Request:
```
POST /functions/v1/send-email
apikey: <anon key>
Authorization: Bearer <office user's Supabase JWT>
Content-Type: application/json

{
  "to": "landlord@example.com",
  "cc": "agent@example.com",
  "subject": "Invoice INV-1042 — GB Electrical",
  "html": "<table style=\"width:100%\">...</table>",
  "replyTo": "office@gbelectrical.co.uk",
  "attachments": [
    { "filename": "INV-1042.pdf", "content": "JVBERi0xLjQKJcOkw7zDtsO..." }
  ]
}
```

Response (200):
```json
{ "id": "sent" }
```

### 3.6 `send-push`

Sends a Web Push notification to a landlord/agency/agent's registered device(s). Source: `supabase/functions/send-push/index.ts`.

**Endpoint:** `POST /functions/v1/send-push` · CORS: `authorization, x-client-info, apikey, content-type` (no explicit `Access-Control-Allow-Methods` set, unlike the other six)

**Auth mechanics** (`index.ts:17-33`) — the one function with the platform-level `verify_jwt` gate **on** (per [06-supabase.md §7](../architecture/06-supabase.md#7-edge-functions--overview), confirmed live via `list_edge_functions`), *plus* its own manual check. The comment in the source explains why the platform check alone isn't enough: the anon key is itself a validly-signed Supabase JWT (`role: anon`) and would pass the platform's default `verify_jwt` check on its own — so the function additionally calls `auth.getUser(jwt)` against an anon-key client and requires a real user session behind the token, which the bare anon key never has.

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `title` | string | no | defaults to `"DeepFlow"` |
| `message` | string | no | defaults to `"You have an update"` |
| `url` | string | no | defaults to `"/"` — opened when the push notification is tapped |
| `landlordName` | string | no | case-insensitive (`ilike`) match against `persons.name` |
| `agencyName` | string | no | case-insensitive match against `agencies.name` |
| `agentName` | string | no | case-insensitive match against `agents.name` |

At least one of `landlordName`/`agencyName`/`agentName` needs to resolve to a real row for anything to be sent; all three can be supplied at once (e.g. notifying both a landlord and their agent about the same job).

**Response**

| Status | Body | When |
|---|---|---|
| 200 | `{ "sent": number, "removed": number }` | `sent` = successful push deliveries; `removed` = stale subscriptions pruned (see below) |
| 200 | `{ "sent": 0, "reason": "no matching client found" }` | none of the supplied names matched a `persons`/`agencies`/`agents` row |
| 401 | `{ "error": "Unauthorized" }` | |
| 500 | `{ "error": "<stringified exception>" }` | any unhandled error, including a `web-push` library failure other than 410/404 |

For each matched entity, every row in `push_subscriptions` for that `entity_table`/`entity_id` gets a push attempt; a `410 Gone` or `404 Not Found` response from the push service is treated as "this subscription is dead" and the row is deleted (`index.ts:75-80`) rather than retried. Per [05-database.md §3.17](../architecture/05-database.md#317-push_subscriptions), no application code currently *writes* to `push_subscriptions`, so in production this function currently has no real subscriptions to iterate — this contract is otherwise fully live and callable.

**Example**

Request (`apps/office/audit.js:97-100`):
```
POST /functions/v1/send-push
apikey: <anon key>
Authorization: Bearer <office user's Supabase JWT>
Content-Type: application/json

{
  "title": "Job completed",
  "message": "Work at 12 Example Street is complete",
  "url": "/",
  "landlordName": "J. Patel"
}
```

Response (200):
```json
{ "sent": 1, "removed": 0 }
```

### 3.7 `portal-sign-url`

**Added this session**, alongside the fix that made the `deepflow` Storage bucket private ([09-storage.md §3](../architecture/09-storage.md#3-access-control-private-bucket-signed-urls-one-edge-function-bridging-portals-missing-session)). The Client Portal has no Supabase session of any kind, so once the bucket stopped being public it lost the ability to read any stored file at all — it can't call `createSignedUrl()` itself (that needs a session RLS can check), and it can no longer just read `pdf_url`/a public object URL directly. This function is the bridge: it re-resolves the portal visitor's `(type, id)` identity server-side, using the same `portal_get_jobs`/`portal_get_certs`/`portal_get_attachments`/`portal_get_invoices` RPCs the Portal's other reads already trust, and signs a requested Storage path **only if it's genuinely found among that identity's own records** — a guessed, adjacent, or otherwise-unrelated path is silently dropped rather than signed. Source: `supabase/functions/portal-sign-url/index.ts`.

**Endpoint:** `POST /functions/v1/portal-sign-url` · CORS: `authorization, x-client-info, apikey, content-type` (no explicit `Access-Control-Allow-Methods`, same as `send-push`)

**Auth mechanics** (`index.ts:37-49`) — no JWT check of any kind; the function runs entirely under the service role (`SUPABASE_SERVICE_ROLE_KEY`), the same way the `portal_get_*` RPCs bypass RLS internally. Authorization instead comes from what the `(type, id)` pair is allowed to see: the function calls `portal_get_jobs(p_type, p_id)` to get that identity's job ids, then `portal_get_certs`/`portal_get_attachments` for those jobs and `portal_get_invoices(p_type, p_id)` directly, and collects every `pdf_path`/`storage_path` those calls return into an allow-set. Every path in the request is checked against that set before signing — there is no way to sign a path that isn't already reachable through one of those four RPCs for that exact identity. At the transport level the Portal still sends `apikey`/`Authorization: Bearer <anon key>` (`apps/portal/main.js:645-649`), consistent with every other Portal call, but (like `create-checkout-session`) that header is not what authorizes the request.

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | `"landlord"` \| `"agency"` \| `"agent"` | yes | matches the `portal_get_*` RPCs' `p_type` |
| `id` | string | yes | the visitor's `persons.id`/`agencies.id`/`agents.id`, matches `p_id` |
| `paths` | string[] | yes, non-empty | Storage object paths the Portal wants signed (from `attachments.storage_path`, `certs.pdf_path`, `invoices.pdf_path` on records it already fetched) |

**Response**

| Status | Body | When |
|---|---|---|
| 200 | `{ "urls": { [path: string]: string \| null } }` | one entry per requested path, in request order; a path found in the allow-set maps to a signed URL (6-hour expiry, `EXPIRES_IN = 21600`), a path *not* found — or where `createSignedUrl` itself errored — maps to `null` |
| 400 | `{ "error": "type, id, and paths[] are required" }` | any of the three missing, or `paths` not a non-empty array |
| 500 | `{ "error": "<stringified exception>" }` | any unhandled error (malformed JSON body, RPC failure, etc. — caught broadly, `index.ts:60-64`) |

Unlike the six other functions, there is no `OPTIONS`/method-not-allowed distinction coded beyond the `OPTIONS` preflight short-circuit — a non-`POST` request falls through into the same `try` block and will typically surface as a JSON-parse failure inside the 500 case rather than a dedicated 405.

**Example**

Request:
```
POST /functions/v1/portal-sign-url
apikey: <anon key>
Authorization: Bearer <anon key>
Content-Type: application/json

{
  "type": "landlord",
  "id": "b6b6f2a0-1234-4abc-9def-abc123456789",
  "paths": [
    "certs/cert-1773100100-ab12/EICR-20260731-4821.pdf",
    "invoices/inv-1773100200-x9k2/INV-1042.pdf",
    "jobs/job-9999999999-zzzz/1773100999999-guess.jpg"
  ]
}
```

Response (200) — the first two paths are genuinely among this landlord's own cert/invoice records and get signed; the third was never among their `portal_get_attachments` results (not theirs, or simply mistyped) and comes back `null` rather than a working link:
```json
{
  "urls": {
    "certs/cert-1773100100-ab12/EICR-20260731-4821.pdf": "https://dzqyqpuhxdrrpipbehpk.supabase.co/storage/v1/object/sign/deepflow/certs/cert-1773100100-ab12/EICR-20260731-4821.pdf?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "invoices/inv-1773100200-x9k2/INV-1042.pdf": "https://dzqyqpuhxdrrpipbehpk.supabase.co/storage/v1/object/sign/deepflow/invoices/inv-1773100200-x9k2/INV-1042.pdf?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "jobs/job-9999999999-zzzz/1773100999999-guess.jpg": null
  }
}
```

---

## 4. Cross-function conventions worth noting

- **Secrets, not request fields, choose behavior.** Which email provider, whether AI extraction/rewrite is available at all, and whether Stripe payments work are all controlled by which Edge Function secrets (`Deno.env.get(...)`) happen to be set — never by a request parameter. A `503` from `send-email`, `extract-cert-data`, `rewrite-notes`, or `create-checkout-session` means "not configured," not "bad request."
- **`verify_jwt` off does not mean unauthenticated.** Six of the seven functions have the platform check off and do their own — see each function's Auth mechanics above. Only `stripe-webhook` (Stripe's HMAC signature) and `portal-sign-url` (identity re-resolution via RPC, no token at all) skip a bearer-token check entirely, and each replaces it with a different, equally real, mechanism.
- **The Client Portal's `Authorization` header is not meaningful authorization.** On every Edge Function it calls (`create-checkout-session`, `portal-sign-url`), the Portal sends `Bearer <anon key>` because it has nothing else to send — the function's real authorization check is elsewhere in the body/logic, never that header. Don't read "Portal sent a Bearer token" as "Portal was authenticated by that token."
- **Every JSON-responding function shares one small error shape:** `{ "error": string }`, paired with a conventional HTTP status (`400` bad input, `401`/`403` auth, `404` not found, `405` wrong method, `502` upstream provider failure, `503` not configured, `500` unexpected). `stripe-webhook` is the sole exception, responding with plain text (`ok` / `Invalid signature` / etc.) since Stripe's webhook delivery doesn't parse a JSON body.

---

## See also

- [../architecture/05-database.md](../architecture/05-database.md) — the schema, table/column shapes, and the `invoices.items`/`total` distinction referenced throughout Section 3
- [../architecture/06-supabase.md](../architecture/06-supabase.md) — Auth model, full RLS policy reference, the `SECURITY DEFINER` RPC catalog (Section 2.3 builds on this rather than repeating it), and the one-paragraph-per-function Edge Function overview this document expands into full contracts
- [../architecture/09-storage.md](../architecture/09-storage.md) — the Storage bucket, its RLS policies, and the full reasoning behind `portal-sign-url`'s existence (Section 3.7 here covers only its request/response contract)
- `supabase/functions/*/index.ts` — the real source every contract in Section 3 was read from
- `packages/core/supabase.js` — `restFetch()`, `createSupaAuthClient()`, `makeJwtResolver()` — the shared PostgREST call primitives Section 2 describes
