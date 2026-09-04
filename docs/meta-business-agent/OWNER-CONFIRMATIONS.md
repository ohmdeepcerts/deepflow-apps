# Owner Confirmations Required

None of the items below exist anywhere in the software, the database, or any existing documentation. They are business decisions, not technical facts, so nothing in the training pack states them as fixed policy — every training file that touches one of these topics tells Meta to collect the details and hand over to a human rather than answer, until you've confirmed the real policy here.

Once you answer these, the relevant training message(s) can be updated with the real policy and re-pasted.

## Operating basics
1. **Opening hours** — exact days/times GB Electrical is open for calls and bookings.
2. **Geographic coverage area** — how far out you travel, and whether there's a surcharge beyond a certain distance.
3. **Weekend / out-of-hours work** — do you do it, and is there a surcharge.

## Emergency / call-out
4. **Emergency call-out policy** — is there a same-day emergency service, what counts as qualifying, and what it costs.
5. **Emergency call-out charge** — fixed fee, or "confirmed on the day."

## Pricing
6. **Any pricing GB Electrical is comfortable giving as a rough guide** — the training pack currently instructs Meta to never state a price at all. If you're happy for Meta to give a *typical range* for a small number of very standard services (e.g. "a standard EICR on a 2-bed flat is typically £X–£Y, confirmed on booking"), tell me which services and the range — otherwise Meta collects details and always says "GB Electrical will confirm the price."
7. **Call-out fee**, if one exists independent of the job price itself.
8. **Discount policy** for repeat/portfolio agents, if any — and whether Meta should ever be allowed to mention it exists (recommend: no, this stays human-only regardless).

## Certificates
9. **Certificate turnaround-time commitment** — how long after a job/inspection a customer should expect their certificate (e.g. "within 5 working days"), if you make any such promise at all.
10. **Whether the live `S.certTypes` configuration in Settings matches the 7-type default list in the Master Operational Truth doc**, or has been customised (renamed, added, removed) since. This directly affects `08-eicr.md` through `14-electrical-repairs.md` and the service list in `03-services.md`.

## Cancellation / rescheduling
11. **Cancellation policy** — notice period, any cancellation charge.
12. **Rescheduling policy** — any limit on how many times, any charge for late reschedules.

## Refunds / disputes
13. **Refund policy** — under what circumstances, if any, GB Electrical issues a refund, and who authorises it.
14. **Compensation policy** for missed appointments or engineer no-shows, if one exists.

## Company/legal
15. **Confirm live Settings → Company Name field** actually reads "GB Electrical" (not "GB Electricals") — see `00-MASTER-OPERATIONAL-TRUTH.md` §1. This is a live data check, not a policy decision, but it needs a human to look at the actual Settings page since I don't have login access to verify it myself.
16. **Confirm whether VAT is currently enabled** in Settings (`vatEnabled`) — affects whether Meta should ever mention VAT on pricing-adjacent conversations.

## Service-level detail (needed before the service-specific files can go beyond "collect and escalate")
17. **PAT testing**: does GB Electrical price/schedule by number of appliances, and is there a minimum charge?
18. **Fire alarm / emergency lighting**: what property information genuinely changes how the job is scoped (e.g. number of zones, number of fittings) — the software has no dedicated fields for this, so if it matters operationally, Meta needs to know to ask for it as free text.
19. **EPC**: does GB Electrical only do EPCs alongside another service, or as a standalone booking?

None of these gaps blocked writing the training pack — every relevant message below is written to collect information and route to a human rather than invent an answer. But the pack will be noticeably more useful once these are filled in, particularly #6 (pricing) and #9 (certificate turnaround), since "how much" and "how long" are two of the most common things a real customer asks first.
