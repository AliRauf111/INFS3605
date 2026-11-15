# How We Used AI Tools

This file explains how AI tools were used to build Tutor Compass (https://tutorcompass.app). For each feature it gives the main prompts, the follow-up requests that changed the result, what the AI produced and how we checked or changed it. It does not reproduce every message, but every prompt quoted here was actually sent.

All prompts were written by Ali (group H18A-5) unless an entry says otherwise. They are quoted or trimmed from the project's chat history. Long prompts are shortened with "..." and obvious spelling slips are corrected, but nothing has been added to them. Where Claude reported a result, the numbers (test counts, screen sizes and so on) come from its replies at the time.

## Contents

1. Tools
2. How We Worked
3. Prompts Used To Build The App (sections 3.1 to 3.16)
4. Prompts Inside The App
5. Human Oversight And Limits
6. What We Learned About Prompting

## 1. Tools

- **Claude, through Claude Code projects (cloud sessions).** This was the main tool. It was used for research write-ups, planning, all of the code, database migrations, tests, documentation, screenshots and step-by-step setup guides. Each feature was built on its own branch with its own pull request (PRs #1 to #14). All of them are now merged into the default branch.
- **Claude skills and add-ons.** The UI UX Pro Max skill was used for the glass restyle in October. A 21st.dev MCP server was set up once (PR #3), but it was closed without being used in the app.
- **ChatGPT, outside this project.** The Studio visual reference used in the 29 October prompts was a ChatGPT-hosted demo site. The 19 October audit document was written so it could be uploaded to ChatGPT for design advice.
- **Anthropic API inside the app.** Compass AI calls Claude from the server only, and only when `ANTHROPIC_API_KEY` is set. Without a key, every AI feature falls back to a clearly labelled demo or template mode. Section 4 lists these prompts.

## 2. How We Worked

Most features followed the same loop:

1. **Brief.** Ali wrote a detailed prompt covering the goal, the users, what must not change, what counts as done and how the result should be tested. Many prompts ended with an instruction such as "Do not claim successful integration or testing unless the corresponding checks were actually completed."
2. **Build.** Claude read the existing code first, built the feature on a separate branch and opened a pull request. Vercel built a preview link for each branch.
3. **Review.** Ali opened the preview, sent screenshots of anything wrong and asked for changes in plain language. Small requests (renaming a label, moving a card) usually took a few minutes each. Larger ones got their own thread.
4. **Report.** Claude listed which tests ran, what was checked in a browser and what was still untested, such as live Gmail sending. Ali ran any database updates in Supabase using the SQL files and simple instructions Claude provided.

Ali is new to Supabase and Vercel, so many follow-up prompts asked for setup steps in very plain words, for example *"tell me how to do it step by step like a kid"*. Those setup conversations are not listed below because they did not change the app.

## 3. Prompts Used To Build The App

### 3.1 Research And First Idea: Traffic Lights (15 October)

- **Prompt (summary):** Ali pasted the team's Week 2 research on small tutoring businesses. It covered how many tutoring businesses operate in Australia, a day in the life of an owner (tutor management, parent communication, scheduling, escalations), current AI adoption among small businesses and the main barriers (trust, relevance, skills, time, data and privacy, cost), with sources. Ali asked for app ideas based on it.
- **Produced:** Four app ideas in `app-ideas.md`: a rulebook and approvals app, a guided decision wizard, an owner's inbox board and an "Ask the Rulebook" chat. Claude recommended the first with the wizard from the second, and explained how each idea handled the peer question about unclear rules.
- **Follow-up:** *"number 2 sounds good, lets make an appointment for this but I need to integrate an AI agent with this as well"* ("appointment" meant "app").
- **Produced next:** A Flask and SQLite prototype. Staff type a request, the AI reads it and fills in the wizard, fixed rules give green, amber or red, and the AI writes a short brief for the owner on red cases. The sample rules came from the team's owner interview (refunds, tutor swaps, exam booklets, payments). It now lives in `prototypes/flask-traffic-lights`.
- **Checked or changed:** 25 rule tests passed. Claude said plainly that the AI step had only been tested against a fake response, because there was no API key yet. The prototype was replaced by Tutor Compass the same day.

### 3.2 Build Tutor Compass (15 October, PRs #1 And #2)

- **Prompt (trimmed):** *"Build a working web app called Tutor Compass, an AI-assisted administrative decision platform for small tutoring businesses. Act as a product designer, full-stack developer and business analyst. Implement the app, rather than stopping at a plan or static mock-up. Keep the scope manageable for a university alpha by building the core workflow first, then adding the remaining features in stages."*
- **Key requirements in the same prompt:**
  - Two users: *"Sarah, an administrator: needs clear guidance, supporting information and practical next steps"* and the owner, who *"sets policies, approves exceptions and reviews activity"*.
  - Two ways to start a request (a guided wizard and AI-assisted intake), and *"Both routes must use the same server-side validation and deterministic decision engine."*
  - The stack: Next.js with TypeScript, Supabase, Vercel and GitHub, with *"All database reads and writes must pass through server-side code."*
  - Demo rules: *"Refund below $50: green... from $50 to $200 inclusive: amber... above $200: red. Any confirmed complaint: red. Any confirmed welfare concern: red. Unknown required answers, missing information, conflicting records or missing policies: amber."*
  - Safety: *"Evaluate money in integer cents... The AI must never choose the permission colour or override the rule engine... Never label an external action 'completed' unless it actually occurred."*
  - Honesty: *"Do not describe unfinished stages as complete. Avoid decorative screens with controls that do nothing."*
- **Coordinator brief:** The project's coordinating Claude session added its own instructions when it handed the work over: work on a separate branch, reuse the prototype's sample rules, test against a local database because no accounts were connected yet, and write in British English. This brief was not written by a team member.
- **Produced:** The full first version: database migrations and fictional seed data, the rule engine, the five-step wizard, AI intake, request log, owner approval queue, rule editor with versions, knowledge hub, drafts, activity panel and coverage dashboard. Claude also wrote README.md, SPEC.md and the first version of this file.
- **Checked or changed:** 72 unit tests and a 47-step end-to-end test, run against a local stand-in for Supabase. The tests covered every threshold, the complaint and welfare rules, duplicate submissions, admins being blocked from owner actions and pasted messages saying "ignore the rules". Claude listed what was not yet tested: hosted Supabase, Vercel, live AI and real phones. Ali then set up Supabase and Vercel with step-by-step help and sent screenshots at each step. When sign-in failed on the hosted site, Claude found the Supabase address had extra text in it and fixed this in PR #2.

### 3.3 Making It Easier To Use (18 To 19 October, PR #4)

This was the longest run of follow-up prompts. Ali tested the preview screen by screen and asked for changes as they came up.

- **Opening prompts:**
  - *"for the website tutor compass, I want to make changes, its not user friendly at all, suggest me 10 changes I can make and make it more ui/ux friendly"*
  - *"use the new skill ui ux pro max skill from GitHub to give the website glassmorphism, Apple's website is the reference, and I want to use White base and blues for the font throughout the website"*
- **Produced:** Ten suggestions in `ux-suggestions.md`, each with the problem, the fix and a before and after, ranked by importance. For example: separate menus for each user, put the answer at the top of the result page and use plain words instead of code names. Then a glass restyle with frosted cards, blue text and rounded buttons, with every text colour checked for readability.
- **Navigation follow-ups:** Ali reshaped the menu in a series of short prompts:
  - *"change the name for this to 'Requests' add the log below the two boxes named guided wizard and paste a message, remove the separate request log"*
  - *"Rules should be part of the Knowledge Hub"*
  - *"bring integrations in coverage and change owner queue to Approval Alley"*
  - This left five menu items: Dashboard, Requests, Approval Alley, Knowledge Hub and Coverage. Old links were redirected so nothing broke.
- **First Compass AI assistant:** A long prompt asked Claude to *"add Compass AI as a floating assistant available across the authenticated application"* using a mock-up, with *"the animated robot avatar, bottom-right launcher, floating chat panel and voice interface"*. It also said: *"If an external AI or speech service needs configuration, prepare the integration, document the required environment variables and clearly identify anything that cannot work until configured. Never expose API keys in browser code."* Claude built the robot launcher and chat panel, wired to the real rule engine, so the colour always came from the rules and not the AI.
- **Page redesigns:** *"this is not user friendly, make it like the second picture"* and *"dashboard should also look like this"*. Claude rebuilt the request page with a step tracker (Submitted, Rule check, Owner review, Recorded) and a plain-language rule card.
- **Footer and sign-in page:** Ali sent detailed prompts for a dark footer (*"a full-width dark background, several clearly organised columns... Avoid overcrowding it with links"*) and a new sign-in page (*"create this landing page, use this logo"*). Follow-ups added account creation, forgot password, Apple, Google and Microsoft sign-in, and Support, Privacy and Terms pages. Claude made each one work for real. New accounts cannot sign in until the owner approves them in Approval Alley, and Claude refused to invent a support email address.
- **Bug found by Ali:** *"whenever I am clicking on any requests, it is only showing the page of bk 1047 whereas it should show the different details of each request, please fix"*. Claude traced it to a Safari quirk where an invisible link on the last row caught every click, then tested each row.
- **Remove button:** *"when I open each request there should be an option like a red button under What happens next to remove this request from the list"*, then *"change remove from list to just 'Remove'"*. Claude chose to hide requests rather than delete them, so they can be restored, and stopped admins from removing anything waiting for the owner or involving a welfare concern.
- **Other prompts in this period:**
  - An HSC subject catalogue for Years 11 and 12 with exact custom codes (for example ENG1011 and MTH1012), which became the Subjects page.
  - A loading screen: *"Create a full-screen animated loading page... Make the companion perform a gentle, continuous dance"*, then *"I want the loading screen to show for 3 seconds after I click a button which changes the page so the users can actually see the robot dancing"*.
  - Checkboxes, bulk Archive and Remove actions and three-dot menus on the Saved Requests table.
  - A Recent Requests table with a real Class column, using data linked through each request's booking.
  - A microphone fix: *"After I use voice input, the orange microphone indicator on my Mac stays on even after I finish... Do not assume the cause before inspecting the implementation."* Claude found that voice input opened two microphone captures and only closed one. Because it could not test Safari or a real microphone, it wrote a 10-step manual check for Ali.
  - A footer "soft landing" animation that replays each time the footer scrolls back into view.
  - An animated Display and Accessibility panel with text size, themes, reduced motion and larger controls.
  - About 15 short wording prompts, mostly title case (*"Owner Review Required"*, *"Waiting for a Decision"*, *"Saved Requests"*), and removing sentences Ali found unclear.
- **A question, not a change:** *"why did we change the colour ways of the website... just tell me the reason don't make any changes yet"*. Claude explained that the original colours were unchanged and that the panel's "Follow Device" setting had switched on dark mode. No code was changed.
- **Checked:** The build and all 72 tests passed after each change. Claude was open that it could not open the preview from its own network, so Ali checked most changes visually and reported back.

### 3.4 Read-Only System Audit (19 October)

- **Prompt (trimmed):** *"Perform a thorough, read-only audit of the entire TutorCompass project. Create a technical handover document that I can give to another AI assistant so it can understand the application and help design an AI agent that operates across the website, with approval before changes are committed... Do not implement changes yet... Never include API keys, passwords, tokens, connection strings or private user data... Do not invent functionality. Mark anything you cannot verify as Unknown, Not Implemented or Not Inspected, and explain why."*
- **The prompt asked for eight parts:** architecture, a page and feature inventory, the data model, business rules, the existing chatbot, a full action inventory, a proposed approval design and a list of gaps in priority order.
- **Produced:** `TutorCompass_Full_System_Handover.md` (about 94 KB). It also found inconsistencies, for example in how welfare cases were handled.
- **Checked or changed:** No code was changed. The document became the input for the Compass AI prompt in 3.5. That prompt told Claude to check the document against the current code first, because the code may have changed since.

### 3.5 Compass AI Owner Assistant (20 October, PR #5)

- **Prompt (trimmed):** *"Extend the existing TutorCompass project with three connected Compass AI capabilities: 1. Decision-ready owner reviews. 2. Routine enquiry and request assistance. 3. An owner briefing and follow-up assistant. The goal is to reduce the owner's investigation work, repeated interruptions and time spent checking queues, while keeping people in control of saved changes."*
- **Key requirements in the same prompt:**
  - *"Do not invent a recommendation when evidence is incomplete. Explain what prevents a decision and prepare a targeted information request."*
  - *"Approval of a refund records a decision. It must not claim that money has been transferred."*
  - *"If a written procedure conflicts with the executable policy, show the conflict and require clarification rather than silently choosing whichever answer is easier."*
  - *"The sequence should be: Understand → Retrieve → Validate → Preview → User Confirms → Revalidate → Execute → Report Result."*
  - *"An administrator's confirmation must never bypass an owner approval requirement."*
  - *"Route sensitive cases through the approved escalation process without sending welfare narratives to an external model."*
  - Ten test scenarios, including *"Changed records invalidate an earlier preview"* and *"Repeated clicks do not duplicate actions."*
- **Produced:** Server-side Compass tools, owner review cards, the "What Needs My Attention?" briefing with counts from the whole database and an `agent_proposals` table. Every change shows a preview first and is only saved after Confirm. Welfare cases use a fixed template and never go to the AI.
- **Follow-ups from testing the preview:**
  - *"I want the tasks in the chatbot according to their lights red first then yellow and then green"*. The briefing was regrouped by colour.
  - Ali removed a paragraph about unused-lesson refund figures from the review cards. Claude had added it to explain that the rules do not define that calculation.
  - Ali rewrote the rule wording in the review card: *"Rule 'Medium Refund' (from $50.00 up to and including $200.00) in Refund Policy applies. This needs owner approval before anything is promised."*
  - Ali spotted that the owner was being asked to "Send to Owner": *"BK1043 is giving me an option to send to owner even though I have logged in with the owner account"*. Two follow-up prompts asked for role-aware actions and *"Complete Missing Details"* as the first step when information is missing. Claude added the same checks on the server, not only on screen. 190 tests passed, and it was tested as both Sarah and the owner.
  - The shortcuts prompt: *"The final welcome screen must contain exactly four shortcuts, in this order: 1. What Needs My Attention? 2. Lesson Change 3. Payment Extension 4. Tutor Absence... Each shortcut must start a working conversation or workflow. Do not make these decorative buttons."* Claude built the three workflows behind them. 228 tests passed, and every shortcut was clicked through as Sarah and as the owner on desktop and phone.
  - The glass workspace prompt: *"Expand the chatbot into a workspace covering almost the entire browser viewport... Blur and gently dim the underlying website... Provide a sufficiently opaque fallback where backdrop-filter is unsupported."* This was checked with the keyboard, at phone size, with 150% text, reduced motion and the dark and high contrast themes. 244 tests passed.
- **For the class demo:** *"for all 3 simulations can you tell me here step by step what to select so I can do the same in front of the class"*. Claude wrote `class-demo-script.md`.

### 3.6 Reset Demo Mode On Refresh (27 October, PR #6)

- **Prompt (trimmed):** *"Make TutorCompass demo mode reset to its original starting state whenever the browser page is refreshed. CURRENT ISSUE: The Lesson Change workflow finds booking BK-1042 for Leo Nguyen with Priya Shah, but reports 'no upcoming lessons'... 1. FIND AND FIX THE CAUSE... Generate demo dates relative to the current week so the demonstration continues working on future presentation dates... Prefer an in-memory demo store... Prevent demo actions from changing live Supabase records or sending real messages... Do not clear authentication, unrelated storage or accessibility preferences."*
- **Produced:** Claude found the cause. Lesson LSN-4001 took its date from a slot set once, around 21 October, and that date had passed. Re-running the SQL never overwrote existing rows. Demo data is now rebuilt with dates worked out in Sydney time on every full page load. Only rows labelled as fictional demo data are reset.
- **Where Claude did not follow the prompt:** Ali suggested an in-memory store. Claude explained why it used Supabase instead: Vercel does not share memory between requests, so changes would have vanished at random. It pointed out the trade-off, which is that refreshing one window resets the other too, and added a note to the class demo script.
- **Checked:** All three workflows were run on a local copy, refreshed and run again, three times in a row. 33 browser checks, database checks and 249 unit tests passed. Records not labelled as demo data were never touched. Claude noted it had not yet checked tutorcompass.app itself.

### 3.7 Project Handover (29 October)

- **Prompt (trimmed):** *"Create a professional handover document for Tutor Compass that allows a new developer, project team or assessor to understand the project and continue working on it without relying on our previous conversations... Use the codebase as the main source of truth. Use our conversation history to explain design decisions, but clearly distinguish between requested features and what has actually been implemented. Do not modify the application."*
- **Produced:** `Tutor_Compass_Handover.md`, which covers features, architecture, data and access controls, key user journeys, setup, known issues and next steps. No code was changed. It was used as the input for the next prompt.

### 3.8 Studio Design, Insights And Schedule (29 To 30 October, PR #7)

- **First prompt (trimmed):** *"Implement the Tutor Compass demo's design and user experience in my existing Tutor Compass website... This is an upgrade to the existing application, not a replacement website or standalone mock-up... Do not copy the demo's fictional names, booking references, Years 9–10 examples, fixed dates or sample figures into the application... Reserve green for traffic-light status indicators... The demo simplified some classifications. Do not copy those simplifications into the existing application... Green means the rules permit an action. It must not trigger automatic changes or bypass confirmation... Preserve the existing 100%–200% text-size range. Do not reduce it to the demo's 150% maximum."*
- **Produced:** Red, Yellow and Green cards on the Overview that filter requests, a new Insights page using real records in Sydney time, the Compass button moved into its own card and a restyled accessibility panel. 270 tests passed. Claude said it could not open the reference site from its network and had worked from Ali's screenshots.
- **Second prompt, after Ali saw the result:** *"Update the existing Tutor Compass website to match this reference demo 1:1 in its visual design, layout and interaction behaviour... The attached screenshot shows your previous implementation. It is the version I want corrected... If you cannot access the reference, explain the blocker and request the minimum screenshots or source files needed. Do not guess the design... Passing tests and builds does not establish visual fidelity. Show the finished screenshots alongside the reference and identify any remaining differences honestly."*
- **What happened next:** Claude asked for the source files. Ali uploaded the demo's code with a `CLAUDE_READ_FIRST.md` note: *"read CLAUDE_READ_FIRST.md first. It can now inspect the source without opening the private website."* Claude moved the reference styles into the app and rebuilt the Overview in three columns, all from real data.
- **Checked:** Side-by-side screenshots against the reference on desktop, tablet and phone, as owner and admin, in dark and high contrast themes at 200% text. Claude called it "a close match, not an exact one" and listed every remaining gap in `differences.md`. 275 tests passed.
- **Schedule split:** A third prompt asked to split "Schedule and Knowledge Hub" into two pages with a full month calendar. Claude used real lesson records instead of the fixed October dates in the reference, and explained why: the Lesson Change demo depends on dates relative to today. 281 tests passed.
- **Choices Ali made:** Ali asked to remove a $75 refund card from the Overview. Claude asked how, with three options, and warned that deleting it would leave Approval Alley with nothing to show. Ali chose "Hide it on the Overview only". Later small prompts included *"move filter a little bit to the left so all statuses is beside it, also rename all statuses to 'All'"*, *"over to you should be named as Over to You and show only three cards on the front page"* and a prompt to replace the Compass AI card with a floating "Ask Compass" launcher.

### 3.9 Languages (30 October, PR #8)

- **First prompt (trimmed):** *"add the language drop down bar replacing the interactive demo on the top right corner. Add website-wide multilingual support to the existing Tutor Compass website... This is a change to the whole website... Do not limit it to Compass AI... Support exactly these ten languages... Keep Mandarin and Cantonese as separate options with separate translations... Avoid country flags because languages are not tied to one country... Selecting a language must immediately update the current page... Preserve the current route, open workflow, entered form values... Apply right-to-left layout when Arabic is selected... Translate interface text without rewriting stored business data... Do not send personal information to an external translation service... Clearly identify translations that still require review by fluent speakers."*
- **Second prompt (trimmed):** *"Integrate four additional languages into the existing Tutor Compass website: Tamil, Telugu, Marathi, Bengali... This must be an actual implementation, not a visual demonstration or partial translation."*
- **Produced:** A globe language menu, also available under Settings, with 14 languages and right-to-left Arabic. Switching keeps anything already typed. Compass replies follow the chosen language, while its decisions and permissions stay the same.
- **Checked:** 200 page checks in all ten languages on desktop, tablet and phone found four problems, which were fixed. Tests check that IDs, numbers and permissions are unchanged in every language. 392 tests passed after the four new languages were added.
- **Limits stated:** Every language other than English is a first draft and needs checking by a native speaker. Payments, Retention and the Weekly Briefing were added later and their text is English only.

### 3.10 Font Sizes And Greeting (30 October To 5 November, PRs #9 And #10)

- **Font prompt (trimmed):** *"Increase the font size across the Tutor Compass dashboard so everything is comfortable to read, but keep the current layout intact. Goal: a modest, consistent bump, not a redesign... Scale up the smallest text the most... Use the existing type scale or CSS variables if there are any... If a size increase causes layout problems in a particular component, pull that component back to the largest size that still fits cleanly rather than forcing it. Keep colour contrast at WCAG AA or better... give a short list of what changed (old size to new size for each text style) and flag anything you had to hold back."*
- **Produced:** Claude found there was no type scale, because sizes were hardcoded at 8 to 12px. It added one (12, 13, 14, 15 and 18px) and reported each change, for example status pills from 8 to 9px up to 12px, and chart axis labels that used to shrink to about 5px on phones. Pale helper text measured at 2.2 to 4.2:1 contrast was darkened to at least 4.5:1.
- **Checked:** Screenshots at 1280, 1440, 1920 and 390px wide in English, Tamil, Telugu and Greek, with a script checking for clipped text. Claude listed what it held back, such as long Greek and Tamil status pills that now wrap onto two lines.
- **Greeting:** *"capitalise the E of Good Evening, and M of Good Morning"*. Claude also changed "Good Afternoon" so all three matched.

### 3.11 A Change We Declined: Capacity Chart Demo Data (30 October To 5 November)

- **Prompt (trimmed):** *"Tutor Compass is a demo site. I want realistic test data so the 'A little room to grow' capacity chart looks full and natural. Start by exploring the codebase, then show me a short plan before changing anything."* It included target hours for each day (about 76% booked).
- **What happened:** Claude explained how the chart works and proposed a plan: 10 made-up tutors, about 200 lessons a week and an "Illustrative demo figures" note. Ali asked for it *"in easy words"*. After reading the simpler version, Ali said: *"stop... I don't want to add this"* and *"I just need the capitalised letter"*. No code was written for this plan. We decided a full-looking chart was not worth filling the demo with invented activity.

### 3.12 Payments Module And Recovery Agent (5 November, PR #11)

- **Prompt (trimmed):** *"Integrate the complete Payments module and Autonomous Payment Recovery Agent into my existing Tutor Compass website... This is a major feature addition, not a website redesign."*
- **Key requirements in the same prompt:**
  - A **Complete Entire Scan** button that runs five steps in order: read Xero invoices, check enrolled students, match families, check Gmail for arrangements and disputes, then apply the owner's rules. *"Do not introduce a 'Run Next Agent Action' button."*
  - Group invoices by family, for example two children under one parent.
  - Personalised email and SMS drafts, where *"Student messages must use age-appropriate wording and must not disclose sensitive billing information."*
  - One owner approval screen, and *"The system must check invoice balances, recipient permissions and active exceptions again immediately before sending."*
  - A green Payments Recovered figure that *"must never display the total overdue balance or the total value of reminders sent"*, with an example sequence: $0, then $500, then $740.
  - A business impact view that *"Clearly distinguish[es] measured outcomes from estimated financial benefits."*
  - *"Never misrepresent simulated activity as a successful live API operation."*
- **What Claude flagged:** It could not find the Payments prototype the prompt referred to. Ali then sent screenshots: *"this is the reference ui/ux"*. Claude also noted that the app has no Students or Reports menu items (so Payments went between Subjects and Insights) and that the app uses Next.js, not Vite as the prompt said.
- **Produced:** A Payments page with Overview, Invoices, Autonomous Recovery and Agent Activity tabs, the one-click scan, family grouping, editable drafts, bulk approval and a "simulate a payment" option for demo mode. Drafts are built from templates, not AI, so billing data never reaches the AI.
- **Checked:** The full flow was run in a browser: scan, four eligible families, drafts, simulated send, then recovered amounts of $260, $500 and $740. 420 unit tests, database tests, typecheck, build and secrets scan passed at phone, tablet and desktop widths. Known gaps were listed: English only, no screen to edit recovery rules, and live Xero and Gmail untested.

### 3.13 Student Retention Agent (5 November, PR #12)

- **Prompt (trimmed):** *"Implement a fully functional Student Retention Agent within the existing Tutor Compass website, powered by Compass AI... Core principle: Compass AI investigates, recommends and prepares actions, but the business owner retains full control and final approval."*
- **Key requirements in the same prompt:**
  - Keep every existing Insights card and add a Student Retention section below them, with Red, Yellow and Green risk counts.
  - *"Risk thresholds should be configurable rather than permanently hard-coded. A risk score can be displayed from 0 to 100, but the system must explain how it was calculated. Avoid presenting AI-generated assessments as confirmed predictions that a student will leave."*
  - *"Allow the owner to dismiss incorrect risk flags and record the reason."*
  - *"Avoid language that makes parents feel blamed, pressured or uncomfortable. Do not unnecessarily disclose internal risk scores, confidential notes or sensitive student information in outgoing messages."*
  - *"Editing an approved message must invalidate the previous approval... Prevent duplicate sends from repeated button clicks... Check permissions on the server, not only in the frontend."*
  - *"Do not claim that the agent caused improvements in retention without appropriate supporting evidence."*
  - A 13-step demo journey ending with Reset Demo.
- **Ali's own recommendation at the end of the prompt:** *"ask Claude to implement the feature in two parts. First, build the full UI and functional demo using fictional records so you can present it for INFS3605. Then connect it to real Supabase records and communication services once the workflow has been tested. This reduces the risk of affecting your existing Tutor Compass website."*
- **Produced:** Built demo first, as Ali suggested. It added risk scoring with reasons, three tabs (Students at Risk, Draft and Approve, Tracking and Outcomes), owner-only approval with a fingerprint so any edit needs fresh approval, a simulated send, Compass questions such as "Which students are at risk of leaving?" and an alert in What Needs My Attention.
- **Checked:** 444 unit tests, database checks, typecheck and build passed. A full browser walkthrough covered sending, tracking, batch drafts, reset and Compass, on phone and in dark mode. One of the prompt's example questions mentioned "Sophie's parent", but there is no Sophie in the demo data, so Compass asks which student is meant rather than inventing one. Live Gmail and SMS are untested.

### 3.14 Weekly Owner Briefing (6 November, PR #13)

- **Prompt (trimmed):** *"Implement a new AI-powered feature called Weekly Owner Briefing Agent into the existing Tutor Compass website. This feature will act as an intelligent business assistant that reviews the tutoring company's weekly activities, identifies outstanding issues, summarises operational performance and provides recommended actions to the business owner."*
- **Key requirements in the same prompt:**
  - A sidebar item, an Overview card and Compass questions such as *"What happened in my business last week?"*, while keeping the four existing shortcuts.
  - Six page sections, including Financial Overview, Parent Communications and "What Compass Completed This Week", which must *"Clearly distinguish between: Actions completed automatically under approved rules, Actions completed by administrators, Actions approved by the owner, Actions assisted by Compass AI."*
  - *"Do not claim that Compass completed an action simply because it generated a recommendation or draft."*
  - *"Avoid using improvement colours automatically for numerical increases. An increase in overdue invoices is negative, while an increase in completed administrative tasks may be positive... If previous-week information is unavailable, clearly display Insufficient historical data."*
  - *"Use deterministic calculations for financial totals, counts, percentages and comparisons. Use AI primarily for interpretation, explanation and recommended next steps."*
  - A Monday 8 am email, where *"Do not claim that an email was delivered unless the provider confirms successful delivery"* and *"Ensure scheduled jobs are safe to retry and cannot accidentally send duplicate weekly briefings."*
  - Twelve non-negotiable requirements, such as *"Do not hardcode demo metrics as production figures."*
- **Produced:** The Weekly Briefing page, an Overview card, Compass answers that allow short follow-ups like "Why?", email preview and schedule settings, delivery history and a daily scheduled job. Figures and recommendations are worked out by fixed code from stored records.
- **Checked:** 467 tests, a clean build and the SQL run on a fresh database. Claude listed what was not done: email is simulated, real Gmail sending is untested, live inbox reading is not built and the briefing text is English only. It also said its screenshots came from sample data, so it had not yet seen the card on the real site.
- **Follow-ups after Ali checked the live site:**
  - *"I cant see it on other pages just the overview page make sure to show it on every page of the website, also make the icon 20 percent bigger"*. The Ask Compass robot now shows on every page.
  - *"remove overview, requests, schedule and insights from this bar on the left as they are already present on the top"*. Claude checked the top bar first so no page became unreachable.
  - Title case for "Your Business, Your Rules" and "Quietly Getting Things Done", and the briefing card moved below them.
  - *"remove demo environment and demo mode caution"* on Payments, then the same for the briefing page. Claude listed which demo labels were still showing so Ali could decide on them.

### 3.15 Landing Page: Compass Decision Orbit (6 To 9 November, PR #14)

- **Prompt (trimmed):** *"Act as a senior UI/UX designer, frontend engineer and creative director... redesign and implement the existing TutorCompass landing and authentication page based on the attached Compass Decision Orbit reference image... Replace the existing paragraph underneath with the following approved wording: Less admin. Smarter decisions. More time for what matters. Let Compass AI handle the routine while you stay in control."*
- **Key requirements in the same prompt:**
  - *"The Compass AI avatar is the most important visual element"*, with idle floating, blinking, reacting to the cursor and *"an accessible reduced-motion alternative"*.
  - Four request cards orbiting the robot (Lesson Change, Payment Extension, Tutor Absence, Owner Approval).
  - *"Do not replace any real authentication function with a mock interaction."*
  - *"Only display additional destinations such as Product, Solutions, Resources or Pricing when their corresponding pages or functions exist."*
  - *"Avoid implying that the AI can independently approve decisions that require owner authorisation."*
- **Produced:** The landing page at a separate preview address first, so the working sign-in page was untouched until Ali approved. It has an animated SVG robot that floats, blinks, follows the cursor and stays still with reduced motion, and the existing sign-in panel restyled.
- **Where Claude changed the reference:** It left out Product, Solutions, Resources and Pricing because those pages do not exist. It also rewrote two benefit lines, "Automated decisions" and "24/7, always on", because they overstated the app, to "Checks every request against your rules" and "You approve the big decisions".
- **Follow-ups (all from screenshots):**
  - *"remove this part from the landing page"* (the "How Compass AI works" section).
  - *"align the 4 tiles with the login tile"*, which Claude checked at 1920, 1440 and 1366 wide.
  - *"remove all these tiles I don't want to see them"* (the request detail panels).
  - *"move this part exactly to the centre"*, followed by vertical centring.
  - *"zoom out the landing page such that I don't need to scroll up and down"*, then *"I don't want empty sides"*. The page now fits one screen at six desktop sizes from 1280x720 to 1920x1080.
  - *"make it"*, which made the new design the real sign-in page. Sign-in, account creation and password reset were tested again on it.
  - *"throughout the website for headings like this make the first letter of the word capital, don't implement it yet show it to me here first"*. Claude listed 51 headings and Ali replied *"go ahead"*. When Ali found one it had missed (*"Coming Up Next"*), Claude searched again and fixed 37 more.
  - Size changes: Requests page text 10% larger, side menu icons 15% larger, top tab bar 10% larger.
  - Final wording on the sign-in page: *"Contact Support"*, *"Create Account"*, *"Sign In"*, *"Forgot Password"* and *"Trying The Demo?"*.
- **Checked:** Type check, 467 tests and the build after each change, with screenshots at several desktop sizes plus tablet and phone. The landing page text is English only.

### 3.16 Submission Preparation (15 November)

- **Prompts:** Ali pasted the judges' requirements and asked *"what does this mean don't make any changes tell me first"*. Then: *"lets start with 1 how to make it public and merge all the prs"*. Then, about this file: *"what to do about this"*, *"go ahead"* and *"no I want a more detailed version"*.
- **Produced:** Ali made the repository public. Claude merged all open pull requests into the default branch, which now matches tutorcompass.app. Typecheck, 467 tests, the build and a secrets scan all passed. PR #3, a developer tool setting, was closed instead of merged.
- **This file:** Drafted by Claude from the project's chat history and reviewed by Ali before each version went into the repository. One message in the history contained a third-party API key, and it was left out on purpose.

## 4. Prompts Inside The App

These run on the server and only when `ANTHROPIC_API_KEY` is set. Every reply must match a fixed schema, and the server checks it again before anything is shown. None of them can choose a traffic-light colour, approve a request, activate a rule or send a message.

| Prompt | File | What it does |
| --- | --- | --- |
| `EXTRACTION_SYSTEM` | `src/lib/ai/intake-logic.ts` | Reads a pasted parent or tutor message and suggests facts. It treats the message as data, never invents IDs or amounts and flags text that tries to give the system instructions. Complaint and welfare are "yes" only when clearly stated, otherwise "unknown". |
| `UNDERSTAND_SYSTEM` | `src/lib/assistant/turn.ts` | Works out what a Compass chat message is asking for, in any language. It is told: "You do not decide whether anything is allowed. A separate rule engine and the owner do that." |
| Owner review summary | `src/lib/assistant/owner.ts` | Summarises what the parent wants in one or two sentences, using only the staff note. It must not add amounts, dates or promises, or say whether to approve. |
| Draft rewrite | `src/lib/actions/drafts.ts`, `src/lib/assistant/owner.ts` | Rewrites a template draft in a warmer tone without adding promises. If the AI draft promises something that has not happened, the template is kept and the reason is shown. Welfare cases never use AI. |
| Rule proposal | `src/lib/actions/policies.ts` | Turns the owner's plain-English rule into a draft rule and lists anything unclear. It is told: "You only draft. The owner edits, tests and activates rules." |
| Retention check-in | `src/lib/retention/server.ts` | Writes a short, warm check-in to a parent. It is told never to mention attendance, cancellations, risk or anything that could feel like blame. |

Emails and phone numbers are removed before text is sent to the AI (`redactForAi` in `src/lib/ai/client.ts`). Payments drafts and the Weekly Briefing figures are worked out by fixed code and templates, not by AI.

## 5. Human Oversight And Limits

- **People decide.** Traffic-light colours come from a fixed rule engine with tests. The AI reads, summarises and drafts, but it never decides. Every saved change in Compass needs a preview and a Confirm click, and owner-only decisions stay owner-only, with checks on the server.
- **We checked the AI's work.** Each feature came with tests, a Vercel preview and screenshots. Ali reviewed each preview, found real bugs (the Safari row link, the owner being asked to send requests to themselves) and asked for fixes.
- **We said no when needed.** Ali stopped the capacity chart demo data. Claude pushed back on wording that overclaimed, refused to invent a support email or missing students, and adapted parts of prompts that did not match the real app (such as "Vite" or menu items that did not exist) instead of faking them.
- **We kept things reversible.** New features were built on separate branches with preview links, and big design changes (the landing page) were built at a separate address before replacing anything. "Remove" hides requests instead of deleting them.
- **Known limits.** Live AI depends on an Anthropic API key being set in Vercel. Without one, Compass runs in its labelled demo mode. Live Xero, Gmail and SMS connections are written but untested. All data in the demo is fictional. Translations are AI drafts that still need native speaker review. Much of Claude's browser testing used a local copy of the database, so final checks on the live site were done by Ali.

## 6. What We Learned About Prompting

- **Say what must not change.** The prompts that worked best listed what to keep (rules, permissions, shortcuts) as clearly as what to add.
- **Ask for honesty directly.** Lines such as "Do not claim... unless the corresponding checks were actually completed" led to clear reports of what was and was not tested.
- **Show, don't describe.** Screenshots and the Studio source files worked much better than written design descriptions. The first Studio attempt from screenshots alone was close but not exact.
- **Ask for a plan before anything risky.** Asking for a plan first, as with the capacity chart and the heading capitals, gave Ali the chance to say no before any code changed.
- **Long prompts still needed checking.** Some detailed prompts described things that did not exist in the app. Asking Claude to inspect the code first meant it caught these mismatches rather than building around them.
