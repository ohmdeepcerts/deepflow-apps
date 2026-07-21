# 00 — Project Overview

## 1. What This Document Set Is

This `/docs` folder is a complete technical handover package for **DeepFlow**, written so that a new development team can understand, maintain, extend, secure, and redeploy the entire system without ever needing to contact the original developer or business owner. It was produced by directly reading every line of source code in the repository, and by safely, directly testing the live Supabase backend the applications run on (read and write permission testing, table/column verification, storage bucket testing — see [15_Security.md](15_Security.md) and [05_Database.md](05_Database.md) for exactly what was tested and how).

Nothing in this documentation is guessed. Where something could not be verified (for example, because it requires database credentials beyond what was available), that is stated explicitly rather than assumed.

## 2. What DeepFlow Is

DeepFlow is a job-management, compliance-certificate-tracking, and invoicing system built for a UK trades/property-services business (electrical, gas safety, and general compliance work). It replaces what would otherwise be a mix of spreadsheets, paper job sheets, WhatsApp messages, and phone calls with three purpose-built web applications, all sharing one live database.

## 3. Who Uses It

| Audience | Application | What they do with it |
|---|---|---|
| Office staff (Admin, Manager, Finance, Staff, Viewer roles) | **Office App** | Schedule jobs, manage clients, raise invoices, track certificates, run reports, manage the team. |
| Field engineers | **Employee (Engineer) App** | See their day's jobs, update job status, log hours, take before/after photos, request overtime/leave. |
| Landlords, letting agencies, and individual agents | **Client Portal** | View their own jobs, certificates, and invoices, and raise new job requests — with no account or password needed. |

## 4. The Three Applications, at a Glance

| File | Size (current) | What it is |
|---|---|---|
| `index.html` | ~1.3 MB | The Office App — a full single-page application covering every back-office function. |
| `engineer.html` | ~209 KB | The Employee App — a mobile-first Progressive Web App for field engineers. |
| `client-portal.html` | ~140 KB | The Client Portal — an unauthenticated, link-based self-service page for clients. |

**A note on file history, for anyone auditing the repository's past state:** earlier in this project's life, a fourth file, `office.html`, existed as a byte-for-byte duplicate of `index.html` (confirmed during an earlier review pass of this documentation effort). It has since been removed from the repository. If you find any reference to `office.html` elsewhere (in old links, bookmarks, or QR codes previously generated and shared with staff), redirect it to `index.html` — they were, and would still be, identical.

There is no separate backend server, no mobile app store app (both mobile-facing apps are installable web apps, not native apps), and no build process. Each file is a complete, self-contained web page — open it in a browser (or host it on any static web server) and the whole application runs, with no compilation step required. Full detail in [01_System_Architecture.md](01_System_Architecture.md).

## 5. What Powers It

All three applications connect directly to one shared **Supabase** project (project reference `dzqyqpuhxdrrpipbehpk`). Supabase is a hosted platform that bundles a Postgres database, a REST API generated automatically from that database, a user-login (Auth) service, a file-storage service, and a live-update (Realtime) service. There is no other backend of any kind — no custom server was written for this project. Full detail in [06_Supabase.md](06_Supabase.md).

## 6. High-Level Feature List

- Job scheduling, assignment, and day-by-day management, with a kanban board view and calendar
- Automatic certificate creation from completed jobs (keyword-matched against the job description)
- Automatic and manual invoicing, including proformas, disposable invoices, and credit notes
- Compliance certificate expiry tracking and reminders
- A client/landlord/agency/agent directory, with duplicate detection and record merging
- A property register
- Field-engineer photo capture (with automatic compression and a visible watermark), GPS tracking, and a live map
- Company-to-engineer broadcast alerts
- Engineer overtime/leave requests and client self-service job requests, both landing in one shared office inbox
- Financial reporting: a P&L dashboard, statements, and per-engineer performance/payslip reports
- A fully self-service Client Portal requiring no login
- Three built-in electrician reference calculators (volt drop, earth fault loop impedance, conduit fill) in the Employee App

Every one of these is documented in full, screen by screen, in [02_Office_App.md](02_Office_App.md), [03_Employee_App.md](03_Employee_App.md), and [04_Client_Portal.md](04_Client_Portal.md), and as end-to-end pipelines in [12_Workflows.md](12_Workflows.md).

## 7. How to Use This Documentation Set

Read in whatever order suits your immediate need — every document is written to stand largely on its own, with cross-references to related documents where the topics overlap. That said, if you are starting from zero, this is the recommended reading order:

1. **This document** — the big picture.
2. [01_System_Architecture.md](01_System_Architecture.md) — how everything fits together.
3. [20_Developer_Onboarding.md](20_Developer_Onboarding.md) — practical first steps if you're about to start working in this codebase.
4. The three application documents ([02](02_Office_App.md), [03](03_Employee_App.md), [04](04_Client_Portal.md)) — what each app actually does, screen by screen.
5. [05_Database.md](05_Database.md) and [06_Supabase.md](06_Supabase.md) — the data layer.
6. [13_Business_Rules.md](13_Business_Rules.md) and [12_Workflows.md](12_Workflows.md) — the exact logic governing every feature.
7. [15_Security.md](15_Security.md), [18_Known_Issues.md](18_Known_Issues.md), and [19_Future_Roadmap.md](19_Future_Roadmap.md) — what needs attention, and in what order.

## 8. Document Index

| File | Contents |
|---|---|
| [00_Project_Overview.md](00_Project_Overview.md) | This document. |
| [01_System_Architecture.md](01_System_Architecture.md) | Every layer of the system, end to end. |
| [02_Office_App.md](02_Office_App.md) | Full Office App reference, screen by screen. |
| [03_Employee_App.md](03_Employee_App.md) | Full Employee (Engineer) App reference. |
| [04_Client_Portal.md](04_Client_Portal.md) | Full Client Portal reference. |
| [05_Database.md](05_Database.md) | Every table, column, and relationship. |
| [06_Supabase.md](06_Supabase.md) | Auth, Storage, Realtime, and Functions in detail. |
| [07_SQL_Migrations.md](07_SQL_Migrations.md) | Every SQL statement in the project, and the (lack of a) migration system. |
| [08_Authentication_and_Roles.md](08_Authentication_and_Roles.md) | Login mechanics and the full role/permission model. |
| [09_Storage.md](09_Storage.md) | File uploads, downloads, and the Storage bucket. |
| [10_Synchronization.md](10_Synchronization.md) | Exactly how data moves between the three apps. |
| [11_APIs.md](11_APIs.md) | Every API call the apps make, with example requests/responses. |
| [12_Workflows.md](12_Workflows.md) | Every feature, traced end to end. |
| [13_Business_Rules.md](13_Business_Rules.md) | Every conditional rule in the system, and why it exists. |
| [14_UI_Documentation.md](14_UI_Documentation.md) | Every screen's components, catalogued. |
| [15_Security.md](15_Security.md) | Full security review, including live-tested findings. |
| [16_Deployment.md](16_Deployment.md) | How to host and release this system. |
| [17_Testing_and_QA.md](17_Testing_and_QA.md) | Current testing state and a recommended strategy. |
| [18_Known_Issues.md](18_Known_Issues.md) | Every bug, gap, and risk found, in one list. |
| [19_Future_Roadmap.md](19_Future_Roadmap.md) | A prioritised plan for what to do about them. |
| [20_Developer_Onboarding.md](20_Developer_Onboarding.md) | Practical first-week guidance for a new team. |

## 9. A Word on How This System Was Built

This is important context for how you approach maintaining it: DeepFlow was built entirely as hand-written HTML, CSS, and JavaScript, with **no framework, no build tool, and no package manager**. This was very likely a deliberate choice by a single developer prioritising speed of iteration and zero-infrastructure deployment (any of the three files can be hosted anywhere that serves static files, or even opened directly from a hard drive). It has real, direct consequences for how you should plan to work on it, covered in full in [01_System_Architecture.md](01_System_Architecture.md) and [20_Developer_Onboarding.md](20_Developer_Onboarding.md) — most importantly, that the three applications do not share any code with each other, so a fix made in one must be manually, separately applied to the others if it applies there too.
