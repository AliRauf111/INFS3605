# Traffic Lights

A decision wizard for small tutoring businesses. INFS3605, group H18A-5.

Admin staff describe a request (a refund, a tutor swap, a late payment). An AI agent reads it and fills in a short wizard for them. Staff check the answers. The owner's rules then decide the colour:

- **Green**: go ahead. Staff follow the steps and record what they did.
- **Amber**: check or clarify first. Something is missing, unclear or out of date.
- **Red**: owner approval needed. The AI agent packs the case up for the owner, who approves, rejects or changes it, and can save the decision as a new rule.

Every outcome goes into a searchable decision log, so the same question doesn't have to be answered from scratch next time.

## Run it

You need Python 3.10 or newer.

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
flask --app traffic_lights run --debug
```

Open http://127.0.0.1:5000 and pick a sample user: Sarah (admin), Tom (tutor) or Alex (owner).

The database is created with sample rules and past decisions on first run. To reset it:

```bash
flask --app traffic_lights init-db
```

### Turning on the AI agent

The app works without AI, using simple keyword matching. To use Claude, copy `.env.example` to `.env` and add an Anthropic API key (from https://console.anthropic.com). Restart the app and the footer will say "connected to Claude".

### Tests

```bash
pytest
```

## How it fits our Solution Design Document

| Design doc | Where it is in the app |
|---|---|
| User flow steps 1 to 3: staff receive and enter the request, see the rule and similar cases | New request page, wizard, result page with "Rule applied" and "Similar past decisions" |
| Step 4: check authority | `traffic_lights/rules_engine.py`, using each rule's `min_role` and `requires_owner` |
| Step 5 to 7 (yes branch): follow guidance, confirm, record | Green result shows the steps and a "Record what you did" form |
| No branch: pack for owner, owner decides, staff see it | "Send to the owner" (AI brief), owner Approvals page, decision shown back on the request |
| Data and logic rules 1 to 5 | `check()` in `rules_engine.py`, in the same order |
| Could: owner updates rules, old versions kept | Rules page. Every edit saves the previous version in `rule_history` |
| Won't: act automatically | Nothing in the app sends emails, changes bookings or processes refunds |

## Answering the peer question

> How will the system reliably decide whether a request is routine or needs owner approval, especially when rules are incomplete, outdated or unclear?

1. **The AI never decides the colour.** It only suggests wizard answers, which staff confirm. The colour comes from fixed if-then rules the owner controls, so the same answers always give the same result.
2. **It fails safe.** No matching rule, a missing answer, an unknown request type or a rule not reviewed for 180 days all give amber, never green.
3. **Some things are always red.** Complaints, payment plans and children with extra needs always go to the owner, matching what our interviews said parents expect.
4. **Gaps shrink over time.** When the owner decides an escalated case they can tick "Save as a rule". Next time the same situation comes up, staff get an answer straight away.
5. **The owner can see what needs attention.** The Approvals page lists out-of-date rules, and the decision log shows which kinds of request keep landing in amber.

## Privacy

Children's information is sensitive, so:

- Staff are asked to use first names or initials only.
- Email addresses and phone numbers are masked before anything is sent to the AI.
- The AI only sees the request description, the answers and short summaries of similar past cases.
- Sign in is a prototype user picker. A real version would need proper accounts and passwords.

## Project layout

```
traffic_lights/
  app.py            Flask routes (pages and forms)
  rules_engine.py   The traffic light check and similar-case search
  ai_agent.py       Claude calls: read a request, draft an owner brief (plus offline fallback)
  wizard_config.py  Request types and wizard questions
  db.py             SQLite tables and queries
  seed_data.py      Sample users, rules and past decisions
  templates/        HTML pages
  static/style.css
tests/              pytest tests for the rules and the main flows
```

## Changing the rules or questions

- Owners can edit rules in the app (Rules page, signed in as Alex).
- To add a new request type or question, edit `traffic_lights/wizard_config.py`, then add rules for it in `seed_data.py` and run `flask --app traffic_lights init-db`.
- Rule conditions look like `[{"q": "amount", "op": "<=", "value": 50}]`. All conditions in a rule must match. Rules are checked in order (lowest number first) and the first match wins.
