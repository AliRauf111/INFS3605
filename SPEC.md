# Tutor Compass: specification

## Problem

In a small tutoring business the owner makes most decisions, so staff wait for answers on routine requests, or guess and get it wrong. Tutor Compass lets the administrator check a request against the owner's written rules, act straight away when the rules allow it, and send everything else to the owner with the facts already gathered. The owner keeps control: only the owner changes rules or approves exceptions.

## Users

| User | Needs |
| --- | --- |
| **Sarah, administrator** | Record a request quickly on a phone or laptop, know whether she can act, see which records were checked, get a draft reply and know what the owner decided. |
| **Owner** | See only the requests that need them, with facts, sources and a prepared summary. Approve, decline or ask for more information with a reason. Change rules safely and see where the rules fall short. |

## Must-haves and where they stand

| Must-have | Status |
| --- | --- |
| Requests saved in Supabase through the server only | Done |
| Guided wizard (5 steps) and AI-assisted intake, both using the same validation and engine | Done |
| Deterministic engine: green, amber or red with rule ID, version, explanation, evidence, missing information and permitted actions | Done |
| Refund thresholds: under $50 green, $50 to $200 inclusive amber, over $200 red, in integer cents | Done |
| Confirmed complaint or welfare concern is always red and checked first | Done |
| Missing, unknown, stale or conflicting facts never give green | Done |
| Sign-in with server-enforced admin and owner roles | Done (Supabase Auth) |
| Owner queue with approve, decline and request information, reason required | Done |
| Request details with full decision, approval and activity history | Done |
| Knowledge hub of fictional bookings, payments, availability, policies and articles, each labelled | Done |
| Owner rule builder with draft, active and archived versions, validation and a test area | Done |
| "Describe a rule": AI proposes a draft, owner edits, tests and activates | Done (simulated without an API key) |
| Activity panel built from real saved events | Done |
| Compass owner briefing, decision-ready reviews and routine enquiries, with every saved change going through a server-side proposal (preview, confirm, recheck, execute once, audit) | Done |
| Welfare narratives never sent to the AI service (Quick Capture, Compass, drafts and summaries); welfare cases follow the fixed escalation | Done |
| Editable drafts that never claim an action happened | Done |
| Coverage dashboard and rule suggestions from repeated exceptions | Done |
| Lesson change and payment extension categories | Done |
| Integration settings that show what is really connected | Done |
| Deployed on Vercel and checked on a phone | **Not done.** Needs the team's Supabase and Vercel accounts. Phone layout was checked in a headless browser at iPhone 13 size only. |
| Live AI tested with a real key | **Not done.** No key was available. The fallback path is tested. |

## Decision rules

The engine (`src/lib/engine/evaluate.ts`) runs in this order:

1. Confirmed welfare concern: red (`safety.welfare`).
2. Confirmed complaint: red (`safety.complaint`).
3. Request type with no active rules, or "something else": amber.
4. Find the rule whose range contains the amount, days or fee answer. No match: amber.
5. A green result is lowered to amber if any required fact is missing or unsure, the booking is not found or is ambiguous, payment records conflict or are older than 30 days, the refund is more than was paid, or (for lesson changes) the new slot is not free.

The same confirmed facts, evidence and policy version always give the same result. Each decision stores a SHA-256 fingerprint of its inputs. The AI never chooses the colour. It only suggests facts, which a person must confirm, and drafts text.

## Data model

All tables have row level security turned on with no policies, so only the server's secret key can read or write them. Changes that touch several tables run inside database functions so they either all happen or none do.

| Table | Purpose |
| --- | --- |
| `requests` | One row per request: confirmed facts, current colour, rule, policy version, status, idempotency key |
| `decisions` | Every evaluation of a request, with facts, result, policy snapshot and input fingerprint. Cannot be edited or deleted. |
| `evidence_snapshots` | The exact records the engine saw for each decision. Cannot be edited or deleted. |
| `request_events` | Workflow history: created, sent to owner, approved, declined, information requested, closed |
| `policy_versions` | Rule sets per category with draft, active or archived status. Active and archived versions cannot be edited. Only one active version per category. |
| `app_users` | Name and role (admin or owner) for each Supabase Auth user |
| `families`, `tutors`, `bookings`, `payments`, `tutor_availability`, `knowledge_articles` | Fictional source records, each with a data label and last synced time |
| `ai_activity` | Activity panel events, including whether each was live AI, simulated or a system step |
| `drafts` | Saved draft text per request and kind |
| `audit_events` | Rule changes, activations and other owner actions |
| `rule_suggestions` | Patterns found in past exceptions, waiting for the owner |

Workflow status is kept separate from the decision colour. Statuses: ready, needs clarification, review required, awaiting owner, more information requested, approved, declined, closed.

## Slices

| Slice | Contents | State |
| --- | --- | --- |
| 1 | Requests table, 3 seeded rows, request log, refund wizard, result screen | Complete, tested locally |
| 2 | Sign-in and roles, owner queue, request details and history, knowledge hub, rule builder with versions | Complete, tested locally |
| 3 | AI intake with clarification, record retrieval, activity panel, drafts and escalation summary, "Describe a rule" | Complete in simulated mode. Live AI untested. |
| 4 | Coverage dashboard, suggestions, extra categories, accessibility and error states | Complete, tested locally. No screen reader test yet. |
| Next | Connect hosted Supabase and Vercel, test live AI, test on real phones, user testing with the team | Not started |

## Decisions and why

- **Next.js API routes in front of Supabase.** The brief requires the browser never to reach Supabase. Keeping every query on the server also means roles are checked in one place.
- **Supabase Auth, called from the server.** It gives real passwords and sessions without building our own. Tokens sit in httpOnly cookies. A role picker is not used because it would not be secure.
- **Roles checked twice.** The API checks the role, and the database functions check it again, so a direct API call cannot skip the check.
- **A fixed plan instead of an AI agent choosing tools.** The server always looks up the booking, payments, availability and policy, then runs the engine. This is easier to test and explain, and an AI cannot be talked into skipping a check.
- **Welfare cases are never sent to the AI.** Only a short factual handover template is offered.
- **AI output is grounded.** IDs, amounts and quotes the message does not contain are dropped before Sarah sees them, and pasted text is treated as data.
- **Idempotency keys.** Each wizard session has a key, so a double click or a retry saves one request, not two.
- **Rule suggestions without AI.** Counting repeated owner approvals is enough and gives the same answer every time.

## Out of scope

- Sending emails or SMS, processing payments or refunds, changing bookings
- Real business data or connections to real booking, payment or calendar systems
- Multiple businesses, user invitations and password reset screens
- Any claim of time saved. The coverage page only reports counts from saved records.
