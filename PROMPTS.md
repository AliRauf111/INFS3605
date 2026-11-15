# How We Used AI Tools

This file shows how AI tools were used to build Tutor Compass (https://tutorcompass.app). It lists the main prompts for each feature, what each one produced and how we checked or changed the result. It does not include every message. Follow-up requests are summarised where they changed the outcome.

All prompts below were written by Ali (group H18A-5) unless the entry says otherwise. They are quoted or lightly trimmed from the project's chat history. Long prompts are shortened with "..." and obvious spelling slips are corrected, but nothing has been added to them.

## Tools

- **Claude, through Claude Code projects (cloud sessions).** Used for research write-ups, planning, all of the code, database migrations, tests, documentation and screenshots. Each feature was built on its own branch and pull request (PRs #1 to #14), and all of them are now merged into the default branch.
- **Claude skills and add-ons.** The UI UX Pro Max skill was used for the glass restyle. A 21st.dev MCP server was set up once (PR #3) but was closed without being used in the app.
- **ChatGPT, outside this project.** The Studio visual reference used in the 29 October prompts was a ChatGPT-hosted demo, and the 19 October audit was written so it could be uploaded to ChatGPT for design advice.
- **Anthropic API inside the app.** Compass AI calls Claude from the server only, and only when `ANTHROPIC_API_KEY` is set. Without a key, every AI feature falls back to a clearly labelled demo or template mode. See "Prompts inside the app" below.

## How we worked

1. Ali wrote a detailed prompt: the goal, the users, what must not change and how the result should be tested.
2. Claude read the existing code first, built the feature on a separate branch and opened a pull request with a Vercel preview link.
3. Ali tried the preview, sent screenshots of anything wrong and asked for changes in plain language.
4. Claude reported what was tested and what was not (for example "live Gmail sending is untested"). Unfinished work was never described as done.

## Prompts used to build the app

### 1. Research and first idea: Traffic Lights (15 October)

- **Prompt (summary):** Ali pasted the team's Week 2 research on small tutoring businesses (owner workload, AI adoption, trust and privacy barriers, with sources) and asked for app ideas. Ali then replied: *"number 2 sounds good, lets make an appointment for this but I need to integrate an AI agent with this as well"* ("appointment" meant "app").
- **Produced:** Four app ideas in `app-ideas.md`, then a small Flask and SQLite prototype with a decision wizard, fixed traffic-light rules and an AI step to read requests. It now lives in `prototypes/flask-traffic-lights`.
- **Checked or changed:** 25 rule tests. The AI step was only tested against a fake response because there was no API key. This prototype was replaced by Tutor Compass the same day.

### 2. Build Tutor Compass (15 October, PR #1)

- **Prompt (trimmed):** *"Build a working web app called Tutor Compass, an AI-assisted administrative decision platform for small tutoring businesses. Act as a product designer, full-stack developer and business analyst. Implement the app, rather than stopping at a plan or static mock-up... Both routes must use the same server-side validation and deterministic decision engine... Refund below $50: green... $50 to $200 inclusive: amber... above $200: red. Any confirmed complaint: red. Any confirmed welfare concern: red... The AI must never choose the permission colour or override the rule engine... Do not describe unfinished stages as complete."* The full prompt also set the stack (Next.js, TypeScript, Supabase, Vercel), four build stages, the database fields and security rules.
- **Produced:** The Next.js app with the rule engine, guided wizard, AI-assisted intake, owner approval queue, rule editor with versions, knowledge hub, drafts and coverage dashboard. Also README.md, SPEC.md and the first version of this file.
- **Checked or changed:** 72 unit tests and a 47-step end-to-end test against a local copy of Supabase, plus phone and laptop screenshots. Ali then deployed it to Vercel and Supabase step by step and signed in on the live preview. A sign-in error on the hosted version was fixed in PR #2.

### 3. Make it easier to use (18 to 19 October, PR #4)

- **Prompts:**
  - *"for the website tutor compass, I want to make changes, its not user friendly at all, suggest me 10 changes I can make and make it more ui/ux friendly"*
  - *"use the new skill ui ux pro max skill from GitHub to give the website glassmorphism, Apple's website is the reference, and I want to use White base and blues for the font throughout the website"*
- **Produced:** Ten suggestions, then a glass restyle, a new sign-in page, a footer, the HSC subject catalogue and the Display and Accessibility panel.
- **Checked or changed:** Ali tested the preview and found a bug: *"whenever I am clicking on any requests, it is only showing the page of bk 1047"*. This was fixed so each row opens its own request. Ali also asked for a red Remove button on each request (first called "Remove from list", then renamed) and a 3 second loading screen so users can see the Compass robot animation.

### 4. Read-only system audit (19 October)

- **Prompt (trimmed):** *"Perform a thorough, read-only audit of the entire TutorCompass project. Create a technical handover document that I can give to another AI assistant so it can understand the application and help design an AI agent that operates across the website, with approval before changes are committed... Do not invent functionality. Mark anything you cannot verify as Unknown, Not Implemented or Not Inspected."*
- **Produced:** `TutorCompass_Full_System_Handover.md`, covering every page, table, rule, action and the existing chatbot, plus a proposed approval design.
- **Checked or changed:** No code was changed. The document became the input for the next prompt, which told Claude to check its findings against the current code first because the code may have moved on.

### 5. Compass AI owner assistant (20 October, PR #5)

- **Prompt (trimmed):** *"Extend the existing TutorCompass project with three connected Compass AI capabilities: 1. Decision-ready owner reviews. 2. Routine enquiry and request assistance. 3. An owner briefing and follow-up assistant... Approval of a refund records a decision. It must not claim that money has been transferred... The sequence should be: Understand → Retrieve → Validate → Preview → User Confirms → Revalidate → Execute → Report Result... An administrator's confirmation must never bypass an owner approval requirement... Route sensitive cases through the approved escalation process without sending welfare narratives to an external model."*
- **Follow-up prompts:** Ali asked for exactly four Compass shortcuts (*"What Needs My Attention?, Lesson Change, Payment Extension, Tutor Absence"*) and for Compass to open as an expanded glass workspace.
- **Produced:** Server-side Compass tools, review cards, the "What Needs My Attention?" briefing, and an `agent_proposals` table so every change shows a preview and needs Confirm before it is saved. Welfare cases use a fixed template and never go to the AI.
- **Checked or changed:** Tests for permissions, expired previews, double clicks and welfare routing. Ali also asked how to show the three use cases to the group, which led to a class demo script.

### 6. Reset demo mode on refresh (27 October, PR #6)

- **Prompt (trimmed):** *"Make TutorCompass demo mode reset to its original starting state whenever the browser page is refreshed. CURRENT ISSUE: The Lesson Change workflow finds booking BK-1042... but reports 'no upcoming lessons'... Find and fix the cause... Generate demo dates relative to the current week so the demonstration continues working on future presentation dates... Prevent demo actions from changing live Supabase records or sending real messages."*
- **Produced:** The cause was demo lesson dates that had passed. Demo data is now rebuilt with dates relative to the current week on every full page load.
- **Checked or changed:** The lesson change, payment extension and tutor absence demos were each run, refreshed and run again.

### 7. Project handover (29 October)

- **Prompt (trimmed):** *"Create a professional handover document for Tutor Compass that allows a new developer, project team or assessor to understand the project... Use the codebase as the main source of truth... clearly distinguish between requested features and what has actually been implemented. Do not modify the application."*
- **Produced:** `Tutor_Compass_Handover.md`. No code changes.

### 8. Studio design and Schedule (29 to 30 October, PR #7)

- **Prompts:** A first prompt asked Claude to apply the Studio demo's look while keeping all real data, rules and permissions: *"Do not copy the demo's fictional names, booking references... fixed dates or sample figures into the application."* After seeing the result, Ali sent a second prompt: *"Update the existing Tutor Compass website to match this reference demo 1:1... The attached screenshot shows your previous implementation. It is the version I want corrected... Passing tests and builds does not establish visual fidelity."* A third prompt split "Schedule and Knowledge Hub" into two pages with a full month calendar.
- **Produced:** The current lavender Studio design, red, yellow and green status cards on the Overview, a separate Insights page, the accessibility drawer and the Schedule calendar.
- **Checked or changed:** Side-by-side screenshots against the reference, with the remaining differences written up. Ali then made small layout changes, for example *"rename all statuses to 'All'"*, *"over to you should be named as Over to You and show only three cards"* and removing the Compass AI card from the Overview.

### 9. Languages (30 October, PR #8)

- **Prompts:** *"Add website-wide multilingual support to the existing Tutor Compass website... Support exactly these ten languages... Apply right-to-left layout when Arabic is selected... Translate interface text without rewriting stored business data... Clearly identify translations that still require review by fluent speakers."* A later prompt added Tamil, Telugu, Marathi and Bengali.
- **Produced:** A language menu and translations for 14 languages, including right-to-left Arabic. Compass replies follow the chosen language.
- **Checked or changed:** Tests that IDs, numbers and permissions stay the same in every language, plus screenshots of each language on phone, tablet and desktop. All translations are marked as AI drafts that still need checking by native speakers. Payments, Retention and the Weekly Briefing text are still English only.

### 10. Font sizes, greeting and a declined change (30 October to 5 November, PRs #9 and #10)

- **Prompts:** *"Increase the font size across the Tutor Compass dashboard so everything is comfortable to read, but keep the current layout intact... Keep colour contrast at WCAG AA or better... give a short list of what changed (old size to new size)."* Then: *"capitalise the E of Good Evening, and M of Good Morning"*.
- **Produced:** A shared type scale, darker helper text that passes WCAG AA, and the capitalised greeting.
- **Checked or changed:** Before and after screenshots at four screen widths in four languages, with a script checking for clipped text.
- **Declined:** Ali asked for a plan to fill the capacity chart with made-up demo data. After reading the plan, Ali stopped it: *"stop I don't want to add this... I just need the capitalised letter"*. No code was written for it.

### 11. Payments module and recovery agent (5 November, PR #11)

- **Prompt (trimmed):** *"Integrate the complete Payments module and Autonomous Payment Recovery Agent into my existing Tutor Compass website... Clicking this button must automatically perform all five operations in sequence: Retrieve authorised accounting records from Xero... Cross-check Gmail for payment arrangements, extensions and disputes... Payments Recovered must never display the total overdue balance... It must represent payments confirmed as recovered... If live provider credentials are not configured, retain an explicitly labelled demo mode using fictional data. Never misrepresent simulated activity as a successful live API operation."*
- **Produced:** The Payments page with four tabs, a one-click five-step scan, invoices grouped by family, editable drafts, a single owner approval screen and a green Payments Recovered figure.
- **Checked or changed:** Claude could not find the Payments prototype the prompt mentioned, so Ali uploaded reference screenshots instead. Claude pointed out that the prompt's "Students" and "Reports" menu items and "Vite" setup did not exist in the real app and placed things to fit the real code. The full flow was run in a browser ($0 to $500 to $740 recovered), with 420 tests passing. Drafts use templates, not AI, so billing data never reaches the AI. Live Xero, Gmail and SMS code is written but untested.

### 12. Student Retention Agent (5 November, PR #12)

- **Prompt (trimmed):** *"Implement a fully functional Student Retention Agent within the existing Tutor Compass website, powered by Compass AI... Core principle: Compass AI investigates, recommends and prepares actions, but the business owner retains full control and final approval... Avoid presenting AI-generated assessments as confirmed predictions that a student will leave... Do not unnecessarily disclose internal risk scores... in outgoing messages... Editing an approved message must invalidate the previous approval."* Ali's prompt ended with a recommendation to build it in two phases: a working demo with fictional data first, then real records and messaging later.
- **Produced:** A Student Retention section on Insights with explainable risk scores, three tabs (Students at Risk, Draft and Approve, Tracking and Outcomes), owner-only approval and a simulated send in demo mode.
- **Checked or changed:** Built demo-first as Ali suggested. 444 tests, database checks and a full browser walkthrough on desktop, phone and dark mode. The AI check-in prompt is told never to mention attendance, risk or anything that could feel like blame. Live Gmail and SMS are untested.

### 13. Weekly Owner Briefing (6 November, PR #13)

- **Prompt (trimmed):** *"Implement a new AI-powered feature called Weekly Owner Briefing Agent... Use deterministic calculations for financial totals, counts, percentages and comparisons. Use AI primarily for interpretation, explanation and recommended next steps... Do not claim that Compass completed an action simply because it generated a recommendation or draft... If previous-week information is unavailable, clearly display Insufficient historical data... Do not claim that an email was delivered unless the provider confirms successful delivery."*
- **Produced:** A Weekly Briefing page, an Overview card, Compass answers to briefing questions and a Monday 8 am email schedule (simulated in demo mode).
- **Checked or changed:** 467 tests and a clean build. Ali reviewed it on the live site and asked for several changes: show the Ask Compass robot on every page and make it 20% bigger, remove menu items that were duplicated in the top bar, reorder the Overview cards and remove the demo labels from the Payments and Briefing pages.

### 14. Landing page: Compass Decision Orbit (6 to 9 November, PR #14)

- **Prompt (trimmed):** *"Redesign and implement the existing TutorCompass landing and authentication page based on the attached Compass Decision Orbit reference image... The Compass AI avatar is the most important visual element... Do not replace any real authentication function with a mock interaction... Do not add decorative navigation links that lead nowhere... Avoid implying that the AI can independently approve decisions that require owner authorisation."*
- **Produced:** An animated Compass robot surrounded by four request cards, with the existing sign-in panel restyled. It was built at a separate preview page first.
- **Checked or changed:** Claude changed two benefit lines from the reference ("Automated decisions" and "24/7, always on") because they overstated what the app does. Ali then made about a dozen layout changes from screenshots, such as removing the "How Compass AI works" section, centring the robot and fitting the page on one screen. After approving it, Ali made it the real sign-in page. Ali also asked to see a list of headings before they were changed to title case, then approved 51 changes.

### 15. Submission preparation (15 November)

- **Prompts:** Ali asked what the judges' requirements meant and said *"don't make any changes tell me first"*, then *"lets start with 1 how to make it public and merge all the prs"*.
- **Produced:** All open PRs merged into the default branch, which now matches tutorcompass.app. Typecheck, 467 tests, the build and a secrets scan all passed. This file was drafted by Claude from the project history and reviewed by Ali before it was added to the repo.

## Prompts inside the app

These run on the server and only when `ANTHROPIC_API_KEY` is set. Every reply must match a fixed schema, and the server checks it again before anything is shown. None of them can choose a traffic-light colour, approve a request, activate a rule or send a message.

| Prompt | File | What it does |
| --- | --- | --- |
| `EXTRACTION_SYSTEM` | `src/lib/ai/intake-logic.ts` | Reads a pasted parent or tutor message and suggests facts. Treats the message as data, never invents IDs or amounts and flags text that tries to give the system instructions. |
| `UNDERSTAND_SYSTEM` | `src/lib/assistant/turn.ts` | Works out what a Compass chat message is asking for, in any language. It does not decide whether anything is allowed. |
| Owner review summary | `src/lib/assistant/owner.ts` | Summarises what the parent wants in one or two sentences, using only the staff note. It must not say whether to approve. |
| Draft rewrite | `src/lib/actions/drafts.ts`, `src/lib/assistant/owner.ts` | Rewrites a template draft in a warmer tone without adding promises. If the AI draft promises something that has not happened, the template is kept instead. Welfare cases never use AI. |
| Rule proposal | `src/lib/actions/policies.ts` | Turns the owner's plain-English rule into a draft rule and lists anything unclear. The owner edits, tests and activates it. |
| Retention check-in | `src/lib/retention/server.ts` | Writes a short, warm check-in to a parent. It is told never to mention attendance, cancellations, risk or anything that could feel like blame. |

Emails and phone numbers are removed before text is sent to the AI (`redactForAi` in `src/lib/ai/client.ts`). Payments drafts and the Weekly Briefing figures are worked out by fixed code and templates, not by AI.

## Human oversight and limits

- **People decide.** Traffic-light colours come from a fixed rule engine with tests. The AI only reads, summarises and drafts. Every saved change in Compass needs a preview and a Confirm click, and owner-only decisions stay owner-only.
- **We checked the AI's work.** Each feature came with tests, a Vercel preview and screenshots. Ali reviewed each preview and asked for fixes when something was wrong or did not match the brief.
- **We said no when needed.** Ali stopped the capacity chart demo data, Claude pushed back on wording that overclaimed, and parts of prompts that did not fit the real app (such as "Vite" or menu items that did not exist) were adapted rather than faked.
- **Known limits.** Live AI depends on an Anthropic API key being set in Vercel, and without one Compass runs in its labelled demo mode. Live Xero, Gmail and SMS connections are written but untested. All data in the demo is fictional. Translations are AI drafts that still need native speaker review.
