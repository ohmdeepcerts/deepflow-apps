# 09 — Supabase Storage

DeepFlow's file storage: certificate PDFs, invoice PDFs, and job site photos, all held in Supabase Storage on the same project as the database, **`dzqyqpuhxdrrpipbehpk`**.

This document is scoped to Storage specifically — what's stored, how the upload/delete code paths work, and who can read/write what. It does not re-describe `public` schema tables (see [05-database.md](05-database.md), particularly `attachments`, `certs.pdf_url`/`pdf_path`, `invoices.pdf_url`/`pdf_path`) or general Auth/Realtime/project config (see `06-supabase.md`, once written). [07-sql-migrations.md](07-sql-migrations.md) covers the same repo-vs-live migration gap referenced below in more depth — this document only pulls the four storage-relevant rows out of that gap.

**Methodology:** the bucket list, object count/size, and every RLS policy on `storage.objects` below came from `execute_sql` run directly against the live project via the Supabase MCP server — not from reading migration files, since (as `07-sql-migrations.md` found) the migrations that created this bucket and its policies aren't in the repo. Every upload/download/delete code path was located by grepping `apps/office/*.js`, `apps/engineer/*.js`, `apps/portal/*.js`, and `packages/**/*.js` for `.storage.from(`, `sbStorage`, `.upload(`, `createSignedUrl`, `getPublicUrl`, and `.remove(`, then read in full at the cited line numbers — not assumed from naming.

---

## 1. The bucket: one bucket, private, currently empty

```sql
select id, name, public, file_size_limit, allowed_mime_types, created_at from storage.buckets;
```

| id | name | public | file_size_limit | allowed_mime_types | created_at |
|---|---|---|---|---|---|
| `deepflow` | `deepflow` | **false** (as of migration `20260808_make_deepflow_bucket_private.sql`) | `null` (unlimited) | `null` (unrestricted) | 2026-03-07 11:04:01 UTC |

There is exactly one bucket, and it has no server-side file-size cap and no MIME-type allowlist — every size/type restriction described in Section 2 below is enforced client-side, in JavaScript, before the upload request is even sent, not by the bucket itself.

**This was `public: true` until this same session found it during the documentation pass** (Section 3 originally described exactly why that was a real exposure — every stored file was fetchable by anyone with its URL, no auth, no expiry, regardless of the `storage.objects` RLS policies below). It was flipped to private and every app updated to resolve short-lived signed URLs instead, in the same session, while the bucket held zero objects — see Section 3 for the current mechanism, not the one this section used to describe.

**Current live contents, verified this session:**

```sql
select count(*) as total_objects, sum((metadata->>'size')::bigint) as total_bytes from storage.objects;
-- → total_objects: 0, total_bytes: 0
```

A grouped query (`split_part(name,'/',1)` for top-level folder, i.e. `certs/`, `invoices/`, `jobs/`) also returned zero rows. **The bucket is empty** — expected, not a bug: the same 2026-08-06 production data reset that zeroed every table in [05-database.md §1](05-database.md#1-current-data-state) also cleared Storage. Every code path in this document is verified from source, not from inspecting live files, because there currently are none to inspect.

---

## 2. What gets stored — by use case

Four distinct upload flows write to this bucket. A fifth thing that looks like it should be a fifth (company logos) deliberately isn't, and a sixth thing the brief expected to find (engineer profile photos) doesn't exist at all — both noted below rather than assumed.

| Use case | Triggered by | Path convention | Filename | Public/signed |
|---|---|---|---|---|
| Certificate PDF (auto-generated PAT) | `generateCertPdf()` — office user clicks "Generate PDF" on a cert with appliance data | `certs/{certId}/{filename}` | Cert reference number (`certNum`), sanitized | Signed URL, 1hr in-app / 10yr in emails |
| Certificate PDF (manual upload) | `uploadCertPdf()` — office user uploads/replaces a PDF for any cert type | `certs/{certId}/{filename}` | Same `_certFilename()` convention | Signed URL, 1hr in-app / 10yr in emails |
| Invoice PDF (auto-generated) | `generateAndStoreInvoicePDF()` — fires after any edit that changes what the invoice PDF would look like | `invoices/{invoiceId}/{filename}` | Invoice number, sanitized | Signed URL, 1hr (Office/Engineer) or 6hr (Portal) |
| Job photo (standard) | Engineer app, `handleUpload(input,'photo')` | `jobs/{jobId}/{timestamp}-{random}.{ext}` | Timestamp + random suffix | Signed URL, 1hr (Office/Engineer) or 6hr (Portal) |
| Job photo (before/after pair) | Engineer app, `_handleBAUpload()` | `jobs/{jobId}/{timestamp}-{random}.{ext}` — identical format to standard photos; only the `attachments.photo_slot`/`photo_role` metadata columns distinguish a pair from a loose photo | Same as above | Signed URL, 1hr (Office/Engineer) or 6hr (Portal) |
| Job document (engineer-uploaded PDF) | Engineer app, `handleUpload(input,'certificate')` — a separate upload input (`#pdf-input`) from the photo one, for e.g. a manufacturer's certificate photographed/scanned on site | `jobs/{jobId}/{timestamp}-{random}.{ext}` | Same as photos | Signed URL, 1hr (Office/Engineer) or 6hr (Portal) |
| Company logo | `handleLogoUpload()` / `uploadProfileLogo()` | **Not stored in Supabase Storage at all** — read via `FileReader.readAsDataURL()` into a base64 data URL and saved as a plain string inside the `app_settings` JSON blob (`S.logoData` / `S.companyProfiles[i].logoUrl`) | n/a | n/a — embedded inline in every page that renders it |
| Engineer profile photo / avatar | — | **Does not exist.** Grepped for `avatarUrl`/`photoUrl`/"profile photo" across all three apps — the only avatars in the codebase are CSS-styled initial-letter badges (`(c.author||'?')[0].toUpperCase()`, `apps/office/main.js:797,839,5086,5254`), never an uploaded image | n/a | n/a |

**Certificate PDF naming — confirmed, not just described in a comment.** `_certFilename()` (`apps/office/certs.js:40-48`) builds the filename from `certNum` first, falling back to `type` only if there's no reference number yet:
```js
function _certFilename(c){
  return (c?.certNum||c?.type||'certificate').replace(/[^\w-]/g,'_')+'.pdf';
}
```
Both `generateCertPdf()` and `uploadCertPdf()` (`apps/office/certs.js`) build the storage path as `certs/${certId}/${_certFilename(cert)}` and PATCH it onto `certs.pdf_path` — the reference-number-based naming referenced in [05-database.md §3.2](05-database.md#32-certs--compliance-certificates) is real, current behavior, not aspirational. **`pdf_url` is no longer written by either function** (see Section 3 — since the bucket went private, a stored public-style URL string would never work as a direct link anyway; `pdf_path` is the one source of truth every viewer resolves a fresh signed URL from).

**Invoice PDFs follow the equivalent pattern one level up:** `_storeInvoicePDF()` (`apps/office/main.js`) writes to `invoices/${inv.id}/${(inv.number||'invoice').replace(/[^a-z0-9-]/gi,'_')}.pdf` — folder keyed by the invoice's internal id, filename keyed by its human-facing number, `pdf_path` the only column written for the same reason as certs above. `generateAndStoreInvoicePDF()` is the auto-regeneration entry point called after any edit that affects the rendered PDF (items, bill-to, status, dates) — the Client Portal and bulk-download features then just fetch this one stored file rather than each re-rendering their own copy.

**Client-side size/type limits** (enforced in JS before upload, not by the bucket):
- Certificate PDF manual upload: 25MB max, must look like a PDF (`apps/office/certs.js:1626`)
- Engineer app photo/document upload: 25MB max, JPEG/PNG/HEIC or PDF only (`_validateUploadFile`, `apps/engineer/photos.js:157-167`)
- Certificate-photo AI extraction (a separate, non-permanent flow — reads a photo to pre-fill form fields, never uploaded to Storage): 10MB max (`apps/office/certs.js:1571`)

---

## 3. Access control: private bucket, signed URLs, one Edge Function bridging Portal's missing session

### 3.1 What used to be here, and why it changed

This section originally documented the bucket as `public: true` and concluded that `storage.objects`' RLS policies (below) never actually stood between anyone with a file's URL and the file itself, because the unauthenticated `/object/public/...` URL form bypassed them entirely — access control for reads was effectively "the URL is unguessable," not a real authorization check. That finding was accurate as a description of the live system, and real enough that it was fixed in the same session that found it: the bucket was flipped to `public: false` (migration `20260808_make_deepflow_bucket_private.sql`), while it held zero objects, and all three apps were updated to resolve short-lived signed URLs instead of relying on the public form. Sections 3.2–3.3 below describe the current mechanism.

### 3.2 `storage.objects` RLS — now the real gate on every read, not just writes

Every write operation (`upload`/`insert`) and every read (`sign`, `list`, `download`) goes through `storage.objects` Row Level Security like any other table. Live policies, queried directly (`pg_policies where schemaname='storage'`) since none of the migrations that created them exist in the repo (`07-sql-migrations.md §3` lists `c5_lock_down_storage_bucket`, `fix_invoice_pdf_storage_upload_rls`, and `add_storage_select_policy_deepflow` as three of the 36 live migrations with no corresponding file):

| Policy | Command | Condition |
|---|---|---|
| `deepflow_staff_select` | SELECT | `bucket_id = 'deepflow' AND (is_office() OR is_engineer() OR is_valid_engineer_token())` |
| `deepflow_staff_insert` | INSERT | `bucket_id = 'deepflow' AND (is_office() OR is_engineer())` |
| `deepflow_staff_update` | UPDATE | `bucket_id = 'deepflow' AND (is_office() OR is_engineer())` |
| `deepflow_staff_delete` | DELETE | `bucket_id = 'deepflow' AND (is_office() OR is_engineer())` |
| `deepflow_engineer_token_insert` | INSERT | `bucket_id = 'deepflow' AND is_valid_engineer_token()` |
| `deepflow_engineer_token_update` | UPDATE | `bucket_id = 'deepflow' AND is_valid_engineer_token()` |
| `deepflow_engineer_token_delete` | DELETE | `bucket_id = 'deepflow' AND is_valid_engineer_token()` |

7 policies total, all `roles: {public}` (i.e. evaluated for both `anon` and `authenticated`, gated entirely by the helper function calls). The engineer-token policies duplicate the staff ones for INSERT/UPDATE/DELETE rather than folding `is_valid_engineer_token()` into a single combined policy — functionally equivalent (Postgres OR's multiple permissive policies for the same command together), just written as two policy sets instead of one.

The three helper functions, read directly from `pg_proc` (none of them are defined in the repo's `supabase/migrations/`):
- **`is_office()`** — `SECURITY DEFINER`, `EXISTS(SELECT 1 FROM users WHERE auth_id = auth.uid() AND role != 'engineer' AND active = true)`. True for any logged-in Office App user authenticated via real Supabase Auth.
- **`is_engineer()`** — same shape, `role = 'engineer'`. True for an Engineer app session authenticated via real Supabase Auth (password-mode login).
- **`is_valid_engineer_token()`** — reads the `x-engineer-token` request header, matches it against `users.session_token` for an active, unexpired engineer session. True for an Engineer app session authenticated via the PIN-login flow instead of Supabase Auth (see [05-database.md §6](05-database.md#6-portal-access-portal_token-vs-portal_pin_hash) for the equivalent client-portal PIN mechanism — this is the analogous engineer-side one).

**Notice what's still absent: there is no SELECT (or any) policy that returns true for a Client Portal visitor.** The Portal has no login at all — no Supabase Auth session, no `x-engineer-token` header, nothing `is_office()`/`is_engineer()`/`is_valid_engineer_token()` could ever match. That's still true after the bucket went private — it's *why* Portal needed its own mechanism rather than just calling `createSignedUrl()` itself (Section 3.3).

### 3.3 How each app actually gets a working URL now

- **Office App and Engineer App** — both have a real session (Supabase Auth password login, or the Engineer app's `x-engineer-token` PIN session), so both sign URLs themselves. `signedUrl(path, expiresIn)` — one copy in `apps/office/main.js`, one in `apps/engineer/main.js`, same shape — calls `POST /storage/v1/object/sign/deepflow/{path}` with the current auth (JWT or `x-engineer-token` header via `_storageAuthHeaders()`), which is checked against `deepflow_staff_select` above exactly like any other authenticated read. Office defaults to a 1-hour expiry for in-app viewing (`previewCertPdf`, the job-photo grid) and a 10-year expiry for links embedded in an emailed certificate (`_maybeEmailCertReady` — a short expiry would break a "Download Certificate" link opened from an old email).
- **Client Portal — still never touches Storage's HTTP API directly** (no session to authenticate the call with), but now has a purpose-built bridge: the **`portal-sign-url` Edge Function** (`supabase/functions/portal-sign-url/index.ts`). Portal calls it once per visit, right after loading attachments/certs/invoices, with the same `(type, id)` the `portal_get_*` RPCs already trust plus the full list of storage paths those records reference. The function re-resolves that identity's own jobs/certs/attachments/invoices server-side with the service role (bypassing RLS the same way `portal_get_*` does internally), and signs a requested path **only if it's found among that identity's own records** — a guessed or adjacent path is silently dropped, never signed. `_resolveFileUrls()` (`apps/portal/main.js`) then overwrites `.url`/`.pdf_url` on the in-memory records with the signed results, so every existing render site (`apps/portal/certs.js:119`, `apps/portal/main.js:995,1000,1017-1018,1135`) keeps reading the same field names unchanged and just gets a working 6-hour link instead of a dead public one.

**The practical result:** `deepflow_staff_select` now genuinely gates every read, for every app — Office/Engineer because they hold a real session that satisfies it directly, Portal because `portal-sign-url` runs under the service role (which bypasses RLS by design, same as every other `SECURITY DEFINER` portal RPC) and re-derives authorization from the identity check instead. There is no more "the URL is unguessable" fallback — a copied/leaked file URL now expires (1 hour to 6 hours depending on which app issued it, 10 years for the one deliberate exception of emailed certificates) and a Portal visitor can never sign a path that isn't genuinely theirs, regardless of what they pass to the function. `get_advisors` (security) was re-run immediately after the bucket flip and returned no new finding.

### 3.4 Delete behavior — best-effort, can orphan a file

Every delete path removes the `attachments`/`certs`/`invoices` **database row** first-class, and fires the matching Storage object delete as a secondary, non-blocking `fetch(...).catch(()=>{})` — e.g. `removeCertPdf()` (`apps/office/certs.js:1703-1717`), `deleteAttachment()` (`apps/office/main.js:4163-4179`), `_deleteBAPhoto()` (`apps/engineer/photos.js:232-251`). The Office App's version even says so directly in a code comment (`apps/office/main.js:4171`): *"Storage blob delete failed for ... the DB row is still being removed, leaving an orphaned file."* If the storage DELETE request fails (network blip, expired session) after the DB row is already gone, the file itself is left behind in the bucket with nothing in Postgres pointing at it any more — a known, accepted trade-off in the current code, not a hidden bug.

---

## 4. Free-tier usage — code already tracks this; confirmed still accurate

The Office App's Settings → Storage Usage panel (`loadStorageStats()`, `apps/office/main.js:9008-9098`) lists the Supabase project as **Free Plan** and computes usage against two hardcoded limits, both still correct for Supabase's free tier as of this session:
- **Files:** 1,024 MB (1 GB) — computed from `storage/v1/object/list/deepflow`'s returned file sizes, `apps/office/main.js:9036`.
- **Database:** 500 MB — estimated (Supabase doesn't expose exact bytes over the client REST API) from `totalRows × 1.5KB`, `apps/office/main.js:9044`.

Cross-checked against the live bucket this session: **0 bytes used of the 1,024 MB free allowance** (Section 1) — consistent with a fully-reset bucket and nowhere close to the limit. The dashboard's own file-count/size query (`POST storage/v1/object/list/deepflow`) is the same live-data approach this document's `execute_sql` count used, just via the Storage HTTP API instead of `execute_sql` against `storage.objects` directly — both would currently report zero.

---

## 5. Dead code: the `mo-cert` modal's upload UI is unreachable, but shares live storage functions — not a source of orphaned files

Two parallel certificate create/edit UIs exist in `apps/office/`:

- **Live path:** `editCertRecord(id)` (called from every cert-list row, `apps/office/certs.js:338,1077,1088,1178`) and the "+ Add Cert" button (`apps/office/index.html:2780`, `onclick="openCertForm()"`) both drive `openCertForm()` (`apps/office/certs.js:399`), an inline tab panel (`certs-form-panel`) using `cf2-*` field ids, including the PDF upload wrapper `#cf2-pdf-wrap` (`apps/office/index.html:2862`).
- **Dead path:** `openCertModal()` and `openEditCert(id)` (`apps/office/certs.js:1459,1889`) target a separate overlay, `<div class="overlay" id="mo-cert">` (`apps/office/index.html:4555`), with its own `cf-*` field ids and its own PDF upload wrapper `#cf-pdf-wrap` (`apps/office/index.html:4588`). **Neither function has any caller anywhere in the codebase** — not from an `onclick` in either app's HTML, not from `main.js`'s exported-to-`window` function bundle (`apps/office/main.js:8,14364` list `editCertRecord`/`openCertForm`, never `openEditCert`/`openCertModal`). A third function, `openCertModalFromJob()` (`apps/office/certs.js:1910`), is likewise defined and exported but has zero callers — its only remaining trace is a stale doc-comment above the modal's HTML (`apps/office/index.html:4590`) describing a wiring that no longer exists.

**This does not orphan any storage objects.** `uploadCertPdf()`/`generateCertPdf()`/`removeCertPdf()` — the actual functions that talk to Storage — update *both* `#cf-pdf-wrap` and `#cf2-pdf-wrap` if present (`wraps=['cf-pdf-wrap','cf2-pdf-wrap'].map(...).filter(Boolean)`, e.g. `apps/office/certs.js:1529`), and both the live `openCertForm()` and the dead `openEditCert()` write to the same shared `window._editCertModalId` variable the upload functions key off (`apps/office/certs.js:422` vs. `:1472`). So the upload/delete logic itself is fully live and correctly wired through the reachable `cf2-*` panel — the dead code is purely the old modal shell (`#mo-cert` and its `cf-*` fields) sitting unused in the DOM and bundle, not a second, broken storage code path.

---

## See also

- [05-database.md](05-database.md) — `attachments`, `certs`, `invoices` table schemas; the `portal_pin_hash` mechanism referenced in Section 3.2 above
- [06-supabase.md](06-supabase.md) — Auth, Realtime, and full RLS reference for `public` schema tables
- [`supabase/functions/portal-sign-url/index.ts`](../../supabase/functions/portal-sign-url/index.ts) — the Edge Function Section 3.3 describes
- [07-sql-migrations.md](07-sql-migrations.md) — the repo-vs-live migration gap; Section 3 of that document lists the four storage-related migrations (`c5_lock_down_storage_bucket`, `fix_invoice_pdf_storage_upload_rls`, `add_storage_select_policy_deepflow`, `add_invoice_pdf_path`) that exist live with no file in the repo
