# Prompts

This file records the significant prompts used to build Tutor Compass and the prompts the app itself sends to an AI model. Only prompts that were actually used are listed. Add your own entries when you use an AI tool on this project: who wrote the prompt, what came back and what you kept, changed or threw away.

## Prompts used to build the app

### 1. Build Tutor Compass

- **Contributor:** Ali, in the INFS3605 project thread, 15 October 2026
- **Tool:** Claude Code (cloud session)
- **Prompt (summary):** Build a working web app called Tutor Compass for small tutoring businesses using Next.js, TypeScript, Supabase and Vercel. Two users (Sarah the administrator and the owner). A guided wizard and AI-assisted intake that share one server-side validator and one deterministic rule engine. Refund thresholds of under $50 green, $50 to $200 amber and over $200 red, with complaints and welfare concerns always red. Owner approval queue, rule builder with versions, knowledge hub, activity panel, drafts, coverage dashboard and integration settings. Keep secrets on the server, use fictional data only, never let the AI choose the colour, build in four stages and report verification results honestly. The full prompt is in the project thread.
- **Outcome:** The app in this repository: migrations and seed data, the engine and its tests, all nine screens, the API routes, docs and the smoke test.
- **Kept:** The stage plan, the threshold rules, the separation of concerns, the verification list (turned into `npm test` and `npm run smoke`).
- **Changed:** The earlier Flask prototype in this repo was moved to `prototypes/flask-traffic-lights` rather than deleted. Its sample rules informed the seed policies.
- **Not done from this prompt yet:** Vercel deployment, testing with a hosted Supabase project, live AI testing and real phone testing. These need the team's accounts. See README.md.

### 2. Coordinator brief

- **Contributor:** Written by the project's coordinating Claude session when it handed Ali's request to the build session. Not written by a team member.
- **Prompt (summary):** Work on a separate branch, reuse the prototype's sample rules where useful, verify against a local database because no Supabase, Vercel or Anthropic credentials are available, ask Ali once for account details, use Claude through the Anthropic API on the server, and write in British English without em dashes or Oxford commas.
- **Outcome:** Followed. Verification was done against a local Postgres, PostgREST and Supabase Auth set-up.

### 3. Earlier prototype (`prototypes/flask-traffic-lights`)

- **Contributor:** Committed by Claude in an earlier session of this project. The exact prompt for that session is not recorded in this repository, so it is not reproduced here.

## Prompts inside the app

These are sent to the Anthropic API only when `ANTHROPIC_API_KEY` is set. In every case the reply must match a schema, and the server checks it again before anything is shown. None of them can choose a colour, approve a request or activate a rule.

| Prompt | File | Purpose |
| --- | --- | --- |
| `EXTRACTION_SYSTEM` | `src/lib/ai/intake-logic.ts` | Read a pasted message and suggest facts. Told to treat the message as data, never invent IDs or amounts, and flag text that tries to instruct the system. |
| Draft prompt | `src/lib/actions/drafts.ts` | Rewrite a template draft in a friendlier tone without adding promises. Welfare cases are never sent. |
| Rule proposal prompt | `src/lib/actions/policies.ts` | Turn the owner's plain-language rule into a draft rule set and list any unclear parts. The result is always a draft. |

Personal details such as emails and phone numbers are removed from messages before they are sent (`redactForAi` in `src/lib/ai/client.ts`).
