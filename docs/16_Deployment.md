# 16 — Deployment

## 1. What "Deployment" Means for This Project

There is no build step, no compilation, and no bundling anywhere in DeepFlow. Deploying this system means **making three static HTML files available over HTTPS**, each of which is entirely self-contained and ready to run exactly as it sits in the repository. There is no server-side runtime requirement (no Node.js, no PHP, no Python) — any web server capable of serving a plain file will work.

## 2. Current File Inventory

| File | Purpose | Notes |
|---|---|---|
| `index.html` | Office App | Must be served over HTTPS (required by both the Geolocation and Notification browser APIs it uses indirectly via shared code, and by Supabase Auth's own requirements) |
| `engineer.html` | Employee App | Same HTTPS requirement — this app actively uses Geolocation and Notifications |
| `client-portal.html` | Client Portal | HTTPS strongly recommended (this is the one app external clients access; a plain HTTP link looks untrustworthy and some browser features may be restricted) |

*(A fourth file, `office.html`, previously existed as a byte-identical duplicate of `index.html` — see [00_Project_Overview.md](00_Project_Overview.md). It has since been removed from the repository. If any previously-shared link or QR code points at `office.html`, it should be redirected to `index.html` at the hosting layer.)*

## 3. Minimum Hosting Requirements

- Any static file host: a plain web server (Nginx/Apache/IIS), a cloud static host (Netlify, Vercel in static mode, Cloudflare Pages, GitHub Pages, AWS S3 + CloudFront), or even a shared hosting account's public folder.
- HTTPS (see Section 2).
- No server-side language runtime, no database on the hosting side (the only database is the separate, already-running Supabase project), no environment variable support needed (there are none — see [06_Supabase.md](06_Supabase.md) Section 10).

## 4. Recommended URL Structure

Whatever domain/subdomain this is hosted on, a sensible structure (not currently enforced by anything in the code, since there's no router) would be:
- `/` or `/office` → `index.html`
- `/engineer` or a separate subdomain (e.g. `field.yourdomain.com`) → `engineer.html`
- `/portal` or a separate subdomain (e.g. `portal.yourdomain.com`) → `client-portal.html`

The Client Portal in particular benefits from a short, memorable domain/path, since it's the one link regularly shared externally with non-technical clients.

## 5. Release Process (current state: none)

🔴 There is no CI/CD pipeline, no automated testing gate (see [17_Testing_and_QA.md](17_Testing_and_QA.md)), and no staging environment distinct from production found anywhere in this project. "Releasing a change" today means directly editing the live file (or uploading a new version) with no automated safety net. **This is a significant operational risk for a new team to address early** — see [19_Future_Roadmap.md](19_Future_Roadmap.md) for a recommended minimum-viable pipeline.

## 6. Recommended Minimum Deployment Process (for a new team to adopt)

1. Keep the three files in version control (Git), even without a build step — version history alone is valuable given there is currently no other way to know what changed, when, or why (see [07_SQL_Migrations.md](07_SQL_Migrations.md) for the equivalent, currently-missing, gap on the database side).
2. Stand up a second, non-production copy of all three files (a "staging" deployment) pointed at either the same Supabase project (with obvious risk — see below) or, ideally, a second Supabase project seeded with non-real test data, to allow safe testing of changes before they reach real users.
3. Introduce basic automated checks before merging changes — even simple ones (HTML validity, a check that the Supabase URL/key constants haven't been accidentally altered, a manual QA checklist — see [17_Testing_and_QA.md](17_Testing_and_QA.md)) would be a meaningful improvement over the current "edit and hope" process.
4. Because all three apps duplicate the same core connection logic independently (see [01_System_Architecture.md](01_System_Architecture.md) Section 3), **any change to the Supabase project URL or key must be manually applied to all three files** — there is no single place to update this once.

## 7. Environment Configuration

🔴 None exists, and none is needed given the current architecture — see [06_Supabase.md](06_Supabase.md) Section 10 for the full explanation of why there are no environment variables in this project, and what that implies for secrets management.

## 8. Rollback

Because there is no build artefact and no deployment pipeline, "rollback" today means restoring a previous copy of the affected HTML file from version control (or backup) and re-uploading it — there is no automated one-click rollback mechanism. Database-side rollback is even less available — see [07_SQL_Migrations.md](07_SQL_Migrations.md) Section 1 for why there is currently no way to reverse a schema change either.

## 9. Monitoring & Alerting

🔴 Not present. No error-tracking service (e.g. Sentry), no uptime monitoring, and no usage analytics were found referenced anywhere in the code. The only "monitoring" that exists is what a user notices themselves (a toast error, an "Offline" badge) — see [10_Synchronization.md](10_Synchronization.md) Section 9 for the client-side failure-recovery mechanisms that exist in place of real monitoring.

## 10. Cross-References

GitHub-specific findings (no workflows, no CI): [01_System_Architecture.md](01_System_Architecture.md) Section 13. Recommended roadmap items for improving all of the above: [19_Future_Roadmap.md](19_Future_Roadmap.md).
