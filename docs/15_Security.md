# 15 — Security

A dedicated, OWASP-category-aligned security review of all three applications and the live Supabase project behind them. No code was modified while producing this document.

**Cross-references:** the authentication/authorization mechanics referenced throughout are documented in full in [08_Authentication_and_Roles.md](08_Authentication_and_Roles.md); the Storage findings are expanded in [09_Storage.md](09_Storage.md); every finding here also appears, consolidated alongside non-security issues, in [18_Known_Issues.md](18_Known_Issues.md), and the recommended fixes are prioritised alongside every other improvement in [19_Future_Roadmap.md](19_Future_Roadmap.md).

## 0. Methodology

Three sources of evidence, each labelled so you can judge how confident to be in each finding:

- 🟢 **LIVE-VERIFIED** — confirmed moments ago by directly, safely testing the running Supabase project, using only the same public anon key already embedded in the apps. This round of testing went further than the earlier Database Handbook: it specifically tested **write** access (`INSERT`/`UPDATE`/`DELETE`), not just reads, using a strict safety rule — every write test targeted either an already-empty table (and was immediately reversed) or a filter guaranteed to match zero real rows. **No real business data was created, changed, or deleted at any point.**
- 🟡 **FROM CODE** — established by reading the application source.
- 🔴 **COULD NOT VERIFY** — genuinely unknown; explained where relevant.

---

## Executive Risk Summary

| # | Finding | Category | Severity |
|---|---|---|---|
| 1 | Anonymous users can upload, list, **and delete** any file in Storage | Storage Policies / Uploads / Downloads | **Critical** |
| 2 | `get_auth_users()` lets anyone list every staff email/ID with no login | Supabase Policies / Secrets | **Critical** |
| 3 | Every database table can be read by anyone, no login required | RLS / Broken Access Control | **Critical** |
| 4 | Widespread unescaped HTML rendering (stored XSS) in Office & Engineer apps | XSS | **Critical** |
| 5 | Turning off `pinLock` disables authentication *and every permission check* | Authentication / Authorization | **Critical** |
| 6 | The Client Portal's "submit a request" feature appears to be broken in production right now | Broken Access Control (side-effect) | **High** |
| 7 | Client Portal has no authentication mechanism at all | Authentication | **High** |
| 8 | All authorization is enforced client-side only; no server-side checks exist | Authorization / Broken Access Control | **High** |
| 9 | Hardcoded "protected admin" email addresses visible in public page source | Secrets | **Medium** |
| 10 | No file type/size validation at the point of upload | Uploads | **Medium** |

---

## 1. Authentication

**Office app and Engineer app** both use real Supabase Auth (email + password). Each independently: authenticates against Supabase, then looks up a matching profile row in the `users` table to determine role, and rejects the login if the role doesn't match that app (Office rejects `engineer`; Engineer requires `engineer` + `active`).

- 🟡 **No multi-factor authentication anywhere.** Login is password-only in both apps.
- 🟡 **No visible account lockout / brute-force throttling in the application itself** — the login form does not track or block repeated failed attempts. Supabase's platform does apply its own baseline rate-limiting to the Auth API by default, but this is a platform-level backstop, not something this application adds on top, and its exact configuration for this project 🔴 **could not be verified**.
- 🟡 **Hardcoded emergency-admin bypass.** A fixed list of protected email addresses always receives Admin access, with the app auto-repairing their `users` profile/role if it's ever missing or downgraded (Architecture/Business Rules documents). This is a deliberate "can never be locked out" safety net, but it is a standing, code-level backdoor for those specific accounts that bypasses the normal role system.
- 🚨 **The `pinLock` setting is a full authentication bypass, not a convenience toggle.** Already documented in depth in the Business Rules document (Section 1.1) and the prior software Audit — restated here because it belongs squarely in a security audit: with this setting off, the app grants a real, working logged-in identity to anyone who loads the page, with **zero** credential check, **and** — separately but for the same underlying reason — every permission check in the app (`getUserPerm()`) also automatically returns "allowed" while this setting is off. This is two critical failures sharing one root cause.
- 🟡 **Session handling:** the Office app relies entirely on the Supabase Auth library's own session persistence. A separate, custom 12-hour session mechanism exists in the code (with matching `session_token`/`session_expires` columns confirmed live on the `users` table) but is dead — never called by anything. The Engineer app keeps its own 30-day session marker in `localStorage`, independent of (and longer-lived than) whatever Supabase Auth itself would otherwise enforce.
- 🚨 **The Client Portal has no authentication at all.** Identity is established purely by an ID present in the page's own URL. There is no password, no one-time code, no proof of ownership of the link, and — confirmed by reading the code — no expiry on the link either, despite the portal's own "invalid or expired" error wording implying one exists.

---

## 2. Authorization

All authorization in this system is **role-and-permission-flag-based, and enforced entirely in client-side JavaScript** — it decides what buttons/menus/fields to show, not what the server will actually allow (that's governed separately by RLS, Section 4).

- 🟡 Five roles (`Admin`, `Manager`, `Finance`, `Staff`, `Viewer`) plus the separate `Engineer` case. Full page-by-page and permission-by-permission matrix already documented in the Business Rules document (Sections 1.2–1.9).
- 🚨 **The `Viewer` role is broken, not just restrictive.** The permission-checking function denies it everything, but the separate navigation-visibility function has no rule for it at all — a Viewer-role login results in a completely empty application, which strongly suggests this role was never finished, not that it was deliberately designed to show nothing.
- 🚨 **Per-engineer field-visibility permissions have no effect.** Configurable in the Office app (`engPerms`), never read anywhere in the Engineer app's code. An admin who has restricted what a specific engineer can see has not actually restricted anything.
- 🔴 **Nothing here is re-checked by the database.** Because RLS is largely permissive on reads (Section 4) and, per the write-testing below, inconsistently configured on writes, the real authorization boundary for this system today is much weaker than the UI's role system suggests. A Staff-role user (or anyone bypassing the interface entirely) is not actually prevented by the server from doing anything the UI merely chooses not to show them a button for.

---

## 3. Supabase Policies — What Was Actually, Live, Tested Just Now

This section is new evidence, gathered specifically for this audit, going beyond what the earlier Database Handbook tested (which deliberately only tested reads).

### 3.1 Reads — 🟢 confirmed wide open (unchanged from the Database Handbook)
Every table tested returns data to a plain, unauthenticated request using only the public anon key.

### 3.2 Writes (INSERT) — 🟢 tested directly, and the result is more nuanced than the app's own documentation suggests
Using the safety rule "only test on tables confirmed to already have 0 rows, and only insert an obviously-marked test record": an anonymous `INSERT` was attempted against `persons`, `certs`, and `engineer_requests`. **All three were rejected** with a genuine Postgres RLS error (`new row violates row-level security policy…`, HTTP 401) — not a silent failure, a real policy rejection. **This is a materially better security posture on writes than the "allow_all" pattern documented in the app's own Settings → Guide & SQL panel would suggest** — either that panel's example SQL was never actually run, or a more restrictive policy was applied afterward. This is worth knowing precisely because it means the picture painted in the Architecture and Audit documents (which relied on the app's own embedded documentation for the write-side story) was more pessimistic than what's actually configured, for these three tables at least.

**Important, high-value side effect of this finding:** `engineer_requests` is the exact table the Client Portal's "submit a job request" feature (`submitReq()`) writes to, using this same anon key, with no login. **Given this table now confirmed-rejects anonymous inserts, that feature is very likely failing in production right now** — a real client attempting to submit a request through the portal would receive the same 401 rejection this test did, and (per the app's own error handling) would simply see "Could not send. Please call us directly." This deserves being checked directly against the live app as a priority, separate from any security remediation — it's a functional break, potentially self-inflicted by a well-intentioned RLS tightening that didn't account for this specific legitimate anonymous-write use case.

### 3.3 Writes (UPDATE / DELETE) — 🔴 genuinely could not be conclusively determined, and it's important to understand why
An `UPDATE` and a `DELETE` were both attempted against `persons`, using a filter constructed to match **zero** real rows (a nonexistent ID) — both returned `HTTP 200` with an empty result. **This does not prove anonymous UPDATE/DELETE would succeed against a real row.** This is a well-known characteristic of how Postgres Row-Level-Security combines with PostgREST: an UPDATE/DELETE policy is evaluated per candidate row, and if the filter matches no rows to begin with, there is nothing to evaluate the policy against — the request "succeeds" trivially, regardless of whether the underlying policy would have allowed or blocked a real match. Because every table with real data (`jobs`, `users`, `agencies`, `invoices`, `activity`, `audit_log`) was deliberately excluded from write-testing to avoid any risk to your actual records, **whether an anonymous visitor can currently modify or delete a real job, a real user account, or a real invoice remains unverified by this audit.** This is the single most important open question left by this review, and it should be checked directly, with proper access, in the Supabase dashboard (see Suggested Improvements).

### 3.4 The `get_auth_users()` RPC — 🟢 confirmed anonymously callable
Already covered in the Database Handbook; restated here as the security finding it is. Calling this function with only the public anon key — no login — returns every Supabase Auth account's real email address and internal ID. This function is `SECURITY DEFINER` (correctly, since it needs to read `auth.users`, which is otherwise protected), but its *execute grant* has not been restricted away from the `anon` role, which it should be.

### 3.5 Other documented RPCs — 🟢 confirmed not installed
`create_confirmed_user`, `send_cert_reminders`, and `exec_sql` all return "function not found" — they exist only as copy-paste SQL in the app's admin panel, not as live database objects. This is not itself a vulnerability, but **`exec_sql` specifically is worth flagging as a standing risk to guard against**: it's designed to let the app run arbitrary SQL from the browser as a self-repair mechanism. If it is ever installed, granting it to anything broader than the most trusted internal role (certainly never `anon`, and arguably not blanket `authenticated` either) would hand out the ability to run arbitrary SQL against the database — effectively full compromise.

---

## 4. Row Level Security (RLS) — Consolidated Picture

| Operation | Tables tested | Result |
|---|---|---|
| SELECT | Every table checked | 🟢 Open to `anon`, no login required |
| INSERT | `persons`, `certs`, `engineer_requests` | 🟢 Blocked for `anon` (real RLS rejection) |
| UPDATE / DELETE (real rows) | Not safely testable | 🔴 Unverified |
| RPC execute (`get_auth_users`) | — | 🟢 Open to `anon` — should not be |

**Overall assessment:** this is not a uniformly "wide open" system, as earlier documentation (based on the app's own admin-panel SQL, not live testing) suggested — reads are wide open everywhere, but at least some writes are genuinely locked down. The practical risk today is dominated less by "can someone write to my tables" and more by **"can someone read everything, and can someone list/upload/delete files"** (Section 5) — both of which are unambiguously, currently, true.

---

## 5. Storage Policies

This is the most severe finding in this entire audit.

- 🟢 **Anonymous file upload succeeds, to any path in the bucket.** Tested directly: a file was uploaded to a path outside the app's normal `jobs/` convention, with no authentication, and it succeeded (`HTTP 200`).
- 🟢 **Anonymous file listing succeeds** (already known from the Database Handbook, re-confirmed here) — every folder and filename in the bucket can be enumerated by anyone, without logging in.
- 🟢 **Anonymous file deletion succeeds.** The test file above was then deleted, anonymously, successfully. **This means the same is very likely true for any real file already in the bucket, including every job photo ever uploaded by an engineer** — this was not tested against a real file (to avoid any actual data loss), but there is no reason from the tested behaviour to expect real files are treated differently from the test file.
- 🟡 **General bucket enumeration** (listing *which buckets exist* at all) is separately restricted — but this offers essentially no protection once the one bucket's name (`deepflow`) is known, which it is, in plain text, in every copy of the application source.
- 🟡 **No upload validation at the platform level was found or implied** — the application's own client-side compression/type-handling (Engineer app) is a courtesy for legitimate use, not a security control, since anyone bypassing the app entirely (as this test did) can upload literally any file, of any type or size, to any path.

**Why this matters more than the database findings:** unlike the database tables (where at least INSERT was found to be blocked), Storage currently offers **no protection at all** against an anonymous visitor uploading arbitrary content (a foothold for hosting phishing pages or malware at a trusted-looking `supabase.co` URL, or planting fake "evidence" documents into a real business's real job folders), or — far more seriously — **permanently deleting every photo and document this business has ever collected**, with a handful of unauthenticated HTTP requests and no login of any kind.

---

## 6. Permissions

Covered in depth in Section 2 (Authorization) and the Business Rules document. The one point worth adding here, specifically through a security lens: **the permission system's entire purpose is to shape the interface, not to protect the data.** Every permission flag, every role check, every hidden button exists to make the *app* behave correctly for a well-intentioned user following the normal screens — none of it is a security boundary, because (Sections 3–5) the actual data underneath is reachable directly, bypassing all of it.

---

## 7. Environment Variables

🟢 **None exist.** There is no `.env` file, no build-time variable injection, and no server runtime of any kind — every one of the three apps is a static HTML file with every value (including the Supabase URL and anon key) written directly into the JavaScript source. This is not a flaw introduced by omission — given the project's architecture (no build tooling, no server), there is nowhere else these values *could* live. It does mean, however, that there is no mechanism available in this project's current design to ever have a genuinely private configuration value on the frontend — anything placed in these files is public, by construction, forever (until the file is edited and redeployed).

---

## 8. Secrets

- 🟢 **The Supabase anon key** is present, identically, in all three files. This is expected and normal for a Supabase application — the anon key is designed to be public, with RLS as the real protection layer (Section 4).
- 🟢 **No `service_role` key was found anywhere** in the codebase — correctly; that key must never be shipped to a browser, and it hasn't been.
- 🟢 **No third-party API keys were found.** The weather, UK postcode-geocoding, OpenStreetMap/Nominatim, and Land Registry lookups used by the Engineer app's mapping features all use free, keyless public APIs — there is nothing to leak there.
- 🚨 **The hardcoded "emergency admin" email address list is a real, if narrower, exposure.** These are specific, real people's work email addresses, sitting in plain text in every copy of the app's public source, explicitly marked (by their role in the code) as always-privileged accounts. This doesn't leak a password, but it does hand a would-be attacker a short, high-value target list — "these exact email addresses are guaranteed Admin access" is genuinely useful reconnaissance information that a normal user list wouldn't provide as directly (compare to Finding 3.4/2, where *all* staff emails are exposed via the RPC bug — that's broader but not specifically flagged as "these ones matter most").

---

## 9. Uploads

Covered technically in Section 5. Summarising the upload-specific risk surface:

- Who can upload, as designed: engineers only, to jobs they have open, via the Engineer app.
- Who can *actually* upload, as tested: **anyone**, to **any path**, with **no authentication** (Section 5).
- No file-type allow-list or size cap was found enforced anywhere except as a courtesy in the app's own client-side code (which, again, is trivially bypassed).
- Uploaded files are watermarked and compressed by the app for legitimate photo uploads, but this happens entirely client-side, before the file is sent — it provides no security property at all (an attacker's upload never passes through this code).

---

## 10. Downloads

- 🟢 **Every file in the bucket is downloadable via a predictable public URL pattern** (`storage/v1/object/public/deepflow/<path>`), and — per Section 5 — the exact paths of every file can simply be listed rather than needing to be guessed.
- 🟡 No download activity logging or access auditing of any kind was found — there is no way, from within the application, to know who has downloaded a given file, or how many times, or from where.
- 🟡 Generated PDFs (invoices, reports, payslips) are built entirely client-side and never uploaded or stored anywhere — there is no "download" security surface for these at all; they exist only transiently in the requesting browser.

---

## 11. XSS (Cross-Site Scripting)

Full technical detail already established in the prior Audit document (Section 8.4) — summarised here for completeness of this security-focused review:

- **`index.html`:** 326 places dynamic content is injected into the page via `innerHTML`, against only 10 calls to an escaping helper. The large majority of job addresses, descriptions, notes, and contact names are rendered without any output encoding.
- **`engineer.html`:** 38 `innerHTML` injection points, **zero** escaping mechanism defined anywhere in the file.
- **`client-portal.html`:** meaningfully better discipline (55 escaping calls against 24 injection points), though not verified to be complete.
- **Realistic attack path:** any logged-in Office user — including the lowest-privilege role, or a compromised account — can type a script payload into a job's address, description, or notes field. The next time *any other* user (including an Admin) opens that job, the payload executes in their already-authenticated browser session.
- **Why this is escalated to Critical in a security-specific audit, beyond what a general code audit would say:** combined with Section 3.1 (anyone can already read every table) and Section 4 (the real state of write access on sensitive tables like `jobs` is unverified), a successful XSS here is not a contained, cosmetic issue — the Supabase Auth session token lives in the browser's own storage for any logged-in user, exactly where a successful script injection could reach it.

---

## 12. CSRF (Cross-Site Request Forgery)

🟡 **This system is structurally resistant to classic CSRF, for a specific, explainable reason — but that resistance is not unconditional.**

Classic CSRF relies on a browser *automatically* attaching a user's credentials (a cookie) to a request, even one triggered by a malicious third-party page the user happens to have open in another tab. This system doesn't use cookie-based auth for its API calls — every request carries its access token explicitly, in an `Authorization: Bearer <token>` header, built by JavaScript running on the DeepFlow page itself. A malicious third-party website cannot make a browser automatically attach that header the way it can a cookie, and it cannot read the token out of another origin's `localStorage` due to the browser's Same-Origin Policy. **On these grounds, traditional CSRF is not a meaningful risk here.**

**However, this protection is not a deliberate CSRF defence — it's a side-effect of the authentication architecture, and it evaporates completely wherever XSS succeeds (Section 11).** An attacker who gets a script running *on* the DeepFlow page itself (as opposed to a separate malicious page) is running in the same origin, with direct access to the same JavaScript context — including whatever access token Supabase Auth's library has stored, and the ability to simply call the same `fetch()` functions the real app uses. In that scenario, "CSRF protection" is irrelevant, because the attacker doesn't need to forge a cross-site request at all — they're already inside. **In practice, for this system, the real question is not "is CSRF possible" (no) but "is XSS possible" (yes, per Section 11) — and a successful XSS achieves everything a CSRF attack would have tried to achieve, and more.**

---

## 13. Injection Risks

- 🟢 **Classic SQL injection is architecturally unlikely.** Every one of the three apps talks to the database exclusively through Supabase's PostgREST REST API (`column=eq.value`-style filters in URLs), never through raw, hand-built SQL strings. PostgREST translates these filters into parameterised queries internally — this is a structural property of using PostgREST as designed, not something this specific codebase had to get right itself. This is a genuine strength worth recording, not just an absence of a weakness.
- 🟡 **A narrower, lower-severity concern: unescaped user input forming part of a filter string.** Several places build a filter URL by directly inserting user-typed text (e.g. a search term) into a query string without URL-encoding special characters first. This is very unlikely to allow an attacker to reach data they couldn't already reach some other way (Section 3.1 already gives read access to everything), but it could, in principle, cause unexpected filter behaviour (e.g. a name containing a comma or ampersand altering how a filter is parsed) — a correctness/robustness issue more than an exploitable one, given the current wide-open read posture makes it largely moot.
- 🟡 **The `exec_sql` RPC (Section 3.5) is this system's actual, meaningful SQL-injection-equivalent risk** — not because it exists today (it doesn't), but because the pattern of "let the browser send a SQL string and have the server run it" is present in the codebase's *design intent*, ready to be installed. This is the one place a future well-intentioned "quick fix" could reintroduce a genuine SQL injection / remote-code-execution-equivalent vulnerability into this system.
- 🟡 **HTML injection is covered fully under XSS (Section 11)** — the two are the same underlying issue in this codebase (unescaped user input reaching a rendering context), and this audit treats XSS as the primary framing rather than duplicating it here.

---

## 14. Broken Access Control

This is the unifying theme behind nearly every other finding in this document, so it's worth stating plainly on its own: **DeepFlow's access control today is almost entirely a UI concern, not a data concern.**

- **Insecure Direct Object Reference (IDOR), by design, in the Client Portal:** the entire portal access model *is* an ID passed in a URL, with a database that will answer for any ID it's given (Sections 3.1, and Authentication Section 1).
- **IDOR in practice, for the Office/Engineer apps too:** because table-level SELECT is open to `anon` (Section 3.1), a logged-in user of *any* role — or, for that matter, someone with no login at all, using only the public anon key — can query any table for any record directly, entirely bypassing whatever role-based filtering the interface would normally apply. A "Staff" user who is only supposed to see jobs, not financial reports, is only *shown* less by the interface; nothing stops a direct request for the same data the interface withholds from them.
- **Function-level access control exists, but only as UI hiding:** Section 2 already covers this — hidden buttons and hidden menu items are not the same thing as a server refusing a request.
- **Storage has no access control at all beyond obscurity** (Section 5) — the strongest possible example of broken access control in this system, since even the pretence of role-based restriction that exists for database tables was not found for files.

---

## 15. Suggested Improvements

Ranked by urgency, since this audit — unlike the earlier general software audit — was specifically asked to suggest fixes (no code was changed; these are recommendations only, to be applied by someone with direct access to the Supabase dashboard and the application source).

### Immediate (fix this week)

1. **Lock down Storage RLS.** This is the single highest-impact fix available. At minimum: restrict `INSERT`/`UPDATE`/`DELETE` on `storage.objects` for the `deepflow` bucket to `authenticated` role only (ideally further scoped so an engineer can only write under paths for jobs assigned to them, though role-only scoping is a strong, fast first step). Keep read/public access if the apps' current design of showing images via public URLs is to be preserved, or move to short-lived signed URLs if tighter control over *downloads* specifically is also wanted.
2. **Revoke anonymous execute on `get_auth_users()`.** `REVOKE EXECUTE ... FROM anon; GRANT EXECUTE ... TO authenticated;` — a single SQL statement, no application code changes needed, since the Office app already only calls this after a real login.
3. **Verify UPDATE/DELETE policies directly, on every table, with real Supabase dashboard access** — this audit could not safely determine this for tables holding real data (Section 3.3), and it is the single largest remaining unknown. Do not assume the INSERT-blocked result from `persons`/`certs`/`engineer_requests` generalises to every table without checking directly.
4. **Re-enable anonymous INSERT specifically on `engineer_requests`** (or introduce a purpose-built, narrowly-scoped mechanism for the Client Portal's request feature specifically, such as a `SECURITY DEFINER` function that only allows inserting a new pending request and nothing else) — otherwise the Client Portal's request-submission feature will keep silently failing for real clients.

### Near-term (fix this quarter)

5. **Apply output-encoding systematically, not ad hoc, across `index.html` and `engineer.html`.** Every place user-controllable text (address, description, notes, names) is placed into an `innerHTML` template should pass through a single, always-applied escaping function — the existing `escHtml`/`_escHtml` helpers already in the Office app's code are a reasonable basis; the fix is consistent *application*, not invention of a new mechanism.
6. **Restrict `S.pinLock` from being a full authentication/authorization bypass.** At minimum, decouple "is a login prompt shown" from "does every permission check pass" — these should never have been the same flag.
7. **Give the Client Portal a real (if lightweight) verification step**, appropriate to how sensitive the data behind it actually is — for example, a one-time code sent to a phone/email already on file, checked before showing anything, rather than the ID-in-URL alone.
8. **Replace the general, wide-open table-level SELECT policies with per-role, per-row policies**, starting with the most sensitive tables (`users`, `invoices`, `payments`) — the app's own admin panel already contains a working example of a tighter policy for `users` to use as a template.
9. **Remove or rotate the hardcoded emergency-admin email list's exposure** — consider moving the *check* server-side (e.g. into a Postgres function or a policy condition) rather than a plain, publicly-readable list in the JavaScript source, even though the mechanism itself (a break-glass admin recovery path) is reasonable to keep.

### Longer-term / structural

10. **Never install `exec_sql` (or any equivalent "run arbitrary SQL from the browser" function) with a grant broader than the most trusted internal service** — ideally, don't install it at all, and build any future self-repair/setup automation as a one-time admin action taken directly in the Supabase dashboard instead.
11. **Add basic upload validation at the Storage-policy level** (file type, size ceiling) once write access is properly restricted (Recommendation 1) — client-side validation alone, as it stands today, protects nothing against a direct API caller.
12. **Consider whether file access should be logged/audited** if these documents (compliance certificates, in a regulated-trades business) ever need to demonstrate a chain of custody.

---

*This audit combined static review of all three application files with direct, careful, safety-bounded live testing of the running Supabase project's actual read and write permissions — going beyond documentation or code comments to establish what is actually enforced today. Every live test either targeted data already confirmed empty (and was fully reversed) or used a filter guaranteed to match zero real records. No customer or staff personal data retrieved during testing has been reproduced in this document, and no code was modified. See [00_Project_Overview.md](00_Project_Overview.md) for the full documentation index.*
