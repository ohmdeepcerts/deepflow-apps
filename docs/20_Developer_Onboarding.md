# 20 — Developer Onboarding

A practical, first-week guide for a new development team taking over DeepFlow. This assumes you've skimmed [00_Project_Overview.md](00_Project_Overview.md) but haven't yet worked in the codebase itself.

## 1. Before You Touch Anything

Get access to, and confirm you can reach:
1. The Supabase dashboard for project `dzqyqpuhxdrrpipbehpk` (or whatever project it may have been migrated to by the time you read this) — you will need at least read access to the SQL Editor, Table Editor, Authentication, and Storage sections.
2. The hosting location for the three HTML files (wherever `index.html`, `engineer.html`, and `client-portal.html` are currently served from).
3. A copy of this `/docs` folder, and the four companion documents at the repository root ([../ARCHITECTURE.md](../ARCHITECTURE.md), [../AUDIT.md](../AUDIT.md), [../SECURITY_AUDIT.md](../SECURITY_AUDIT.md), [../PERFORMANCE_AUDIT.md](../PERFORMANCE_AUDIT.md), [../DATABASE_HANDBOOK.md](../DATABASE_HANDBOOK.md), [../BUSINESS_RULES.md](../BUSINESS_RULES.md), [../SYNCHRONIZATION.md](../SYNCHRONIZATION.md), [../WORKFLOWS.md](../WORKFLOWS.md)) — the `/docs` folder reorganises and cross-references this material, but these are the original, most exhaustively-detailed sources for several topics.

## 2. What to Read First, and Why

1. [00_Project_Overview.md](00_Project_Overview.md) and [01_System_Architecture.md](01_System_Architecture.md) — the shape of the whole system.
2. **[15_Security.md](15_Security.md), before you do anything else with real data.** This project has live-confirmed, currently-open security issues (Critical severity — see [19_Future_Roadmap.md](19_Future_Roadmap.md) items C1–C5). You need to know about these before you start poking around the live database or Storage bucket yourself, so you don't accidentally make the situation worse, and so you know which of your own actions might already be visible/reversible by anyone else.
3. [08_Authentication_and_Roles.md](08_Authentication_and_Roles.md) — critically, read the section on the `pinLock` setting before you ever toggle it, on any environment.
4. The app you'll actually be working in first: [02_Office_App.md](02_Office_App.md), [03_Employee_App.md](03_Employee_App.md), or [04_Client_Portal.md](04_Client_Portal.md).

## 3. There Is No "Getting the Dev Environment Running" Step

This will feel unusual if you're used to modern web projects: there is no `npm install`, no build command, and no local dev server required. To work on any of the three apps:

1. Open the relevant `.html` file directly in a text editor.
2. Open the same file directly in a browser (via `file://`, or any simple local static server if you prefer — either works identically, since there's no build step to run).
3. Edit, save, refresh the browser. That's the entire feedback loop.

The one thing to be aware of: because the file connects directly to the **live, real Supabase project** (there is no separate "local" or "test" database configured anywhere — see [16_Deployment.md](16_Deployment.md) Section 6), **opening any of these files at all, even just to look at it in a browser, immediately starts reading and potentially writing real data.** Read [15_Security.md](15_Security.md) and consider setting up a separate Supabase project seeded with fake data for your own development and testing, rather than working directly against production from day one.

## 4. The Single Most Important Thing to Internalise

**These three apps do not share code.** If you fix a bug, add a validation rule, or change how data is fetched in `index.html`, that change does **not** automatically apply to `engineer.html` or `client-portal.html`, even where the same underlying logic conceptually exists in more than one of them. This is the direct cause of at least one confirmed, live bug already found during this review (the settings-table mismatch, [18_Known_Issues.md](18_Known_Issues.md) Section 1) — treat every cross-app change as three separate changes, and check [01_System_Architecture.md](01_System_Architecture.md) Section 3 before assuming otherwise.

## 5. How to Find Things in a 22,000-Line File

`index.html` in particular is large. A few practical navigation tips, based on how it's organised (see [01_System_Architecture.md](01_System_Architecture.md) Section 2):
- The `<style>` block comes first, then all the page markup, then one large `<script>` block at the end — if you're looking for logic, skip past the CSS and HTML entirely.
- Function names are a reliable way to search — every workflow in [12_Workflows.md](12_Workflows.md) names the specific function(s) involved, so you can jump straight to the relevant code rather than reading linearly.
- The settings object (`S`) and the logged-in user object (`_appUser`) are the two most important pieces of global state — most functions read from one or both of these.

## 6. Common Early Mistakes to Avoid

- **Assuming a fix in one app applies to the others** (Section 4 above).
- **Treating `office.html` as still relevant** — it was a duplicate of `index.html` and has been removed; see [00_Project_Overview.md](00_Project_Overview.md).
- **Assuming the database enforces business rules** — it mostly doesn't (see [13_Business_Rules.md](13_Business_Rules.md) Section 0 and [05_Database.md](05_Database.md) Section 4). If you're used to relying on database constraints to catch bad data, you'll need to be more deliberate here, since almost everything is client-side only.
- **Testing destructive actions (delete, bulk-delete, "Clear All Data") against the live project** without first confirming you're not touching real business records — see the safety approach used throughout this documentation set's own live testing (Sections in [15_Security.md](15_Security.md) and [../DATABASE_HANDBOOK.md](../DATABASE_HANDBOOK.md)) as a model.
- **Assuming `pinLock` is a minor setting** — see Section 2, point 3, above.

## 7. Who Owns What (roles, not people)

There is no formal ownership documented anywhere in the project itself; this documentation set is, as of this writing, the closest thing to a design record this project has. Until your team establishes its own ownership model, treat every one of the 20 documents in this folder as the shared source of truth, and update them as you make changes — they will go stale quickly if changes to the actual code aren't reflected back here.

## 8. Your First Practical Tasks (suggested)

1. Read [19_Future_Roadmap.md](19_Future_Roadmap.md) and decide, with whoever owns the business relationship, which Critical items to act on first — most are fast, low-risk fixes.
2. Set up a second Supabase project for safe development/testing, per Section 3 above.
3. Introduce basic version control discipline and a simple deployment checklist, per [16_Deployment.md](16_Deployment.md) Section 6, if none exists yet.
4. Verify the two "likely broken in production" findings directly against the live apps — the Client Portal's request form ([18_Known_Issues.md](18_Known_Issues.md) Section 1) and the Employee App's WhatsApp button (same section) — both are quick to confirm and quick to fix once confirmed.

## 9. Getting Help From This Documentation Set

Every document cross-references the others heavily — if you're reading one and a term or feature isn't fully explained, it's very likely covered in depth elsewhere, and linked. Start from [00_Project_Overview.md](00_Project_Overview.md)'s document index if you're ever unsure where to look.
