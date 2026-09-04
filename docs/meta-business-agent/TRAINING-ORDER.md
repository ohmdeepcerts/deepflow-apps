# GB Electrical — Meta Business Agent Training Order

Paste the 29 numbered messages (`01-company-identity.md` through `29-conversation-summary.md`) into Meta's "Teach me more" chat in this order. Each message is self-contained, but later messages assume the ones before them are already known — following this order avoids the AI contradicting itself mid-training.

Priority key: **CRITICAL** = paste first, governs safety/accuracy of everything else · **HIGH** = core operational behaviour, paste early · **MEDIUM** = service-specific detail, can be paused/resumed without breaking anything already taught.

## Stage 1 — Foundation (CRITICAL)

Paste these first, in order. Nothing else should be taught before these.

1. `01-company-identity.md` — CRITICAL — correct naming, prevents every future message from using "GB Electricals"
2. `27-never-invent.md` — CRITICAL — the overriding rule; everything after this must be consistent with it
3. `02-ai-role-and-tone.md` — CRITICAL — establishes how the AI should behave and sound
4. `28-chat-learning-policy.md` — CRITICAL — stops the AI from generalising one-off remarks into policy

## Stage 2 — Operations (HIGH)

5. `04-client-types.md` — HIGH — who the AI is talking to shapes everything downstream
6. `05-new-job-intake.md` — HIGH — the core extraction behaviour (the "22 High Road" example)
7. `06-managing-agents.md` — HIGH — the most common high-volume message pattern
8. `07-multiple-properties.md` — HIGH — prevents cross-property data mixing
9. `16-appointments.md` — CRITICAL — a confirmation flag exists but defaults to "confirmed" before any date/time is actually agreed with the customer, so it can't be used to tell a customer their appointment is confirmed (corrected 2026-09-04 — see `SOFTWARE-FINDINGS.md` §4); this is the single highest-risk gap in the whole pack
10. `17-engineers.md` — HIGH — no engineer data exists to share; prevents invented ETAs/names
11. `26-human-handover.md` — HIGH — establishes when to stop and hand off, needed before safety content lands

## Stage 3 — Service Knowledge (MEDIUM)

12. `03-services.md` — MEDIUM — the full service list and validity periods
13. `08-eicr.md` — MEDIUM (contains a CRITICAL sub-rule on certificate integrity)
14. `09-gas.md` — MEDIUM (contains a CRITICAL sub-rule on gas emergencies)
15. `10-pat.md` — MEDIUM
16. `11-epc.md` — MEDIUM
17. `12-fire-alarm.md` — MEDIUM (contains a CRITICAL sub-rule on fire emergencies)
18. `13-emergency-lighting.md` — MEDIUM (contains a CRITICAL sub-rule on power-cut safety)
19. `14-electrical-repairs.md` — MEDIUM
20. `18-existing-jobs.md` — MEDIUM
21. `19-projects-and-visits.md` — MEDIUM

## Stage 4 — Safety (CRITICAL)

Paste this stage as a tight block — do not let a long gap or unrelated training fall between these.

22. `15-electrical-emergencies.md` — CRITICAL — the most important single message in the whole pack

## Stage 5 — Financial (HIGH)

23. `23-pricing.md` — CRITICAL — no exceptions rule; paste immediately after emergencies
24. `20-certificates.md` — HIGH
25. `21-invoices.md` — HIGH
26. `22-payments.md` — CRITICAL — never collect payment credentials
27. `25-privacy.md` — CRITICAL — data protection rules
28. `24-complaints.md` — HIGH

## Stage 6 — Testing (HIGH)

29. `29-conversation-summary.md` — HIGH — closes the loop on every conversation shape

Then run the cases in `TEST-CONVERSATIONS.md` against the trained AI (see that file for the full 115 cases across 31 categories) before connecting it to any real customer traffic. Pay special attention to categories 25 (Emergencies), 8/9 (EICR/Gas — certificate integrity and gas-leak handling), 20/21/22 (Payments/Certificate Chasing/Cancellation), and 31 (Unauthorised Data Requests) — these carry the highest cost if the AI gets them wrong.
