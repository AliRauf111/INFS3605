"""The AI agent: reads staff requests and drafts escalations for the owner.

What the agent does:
    1. read_request()    - reads Sarah's free-text description, picks the
                           request type and pre-fills the wizard answers it can
                           find. Staff check and correct every answer.
    2. draft_escalation() - writes a short brief for the owner with the key
                           facts, the rule that triggered it, similar past
                           decisions and two or three options.

What the agent does NOT do:
    - decide the traffic light colour (rules_engine.py does that)
    - take any action (refunds, emails, bookings)

Privacy: emails and phone numbers are masked before anything is sent to the
API, and staff are asked to use first names or initials only.

If no API key is set, or the API call fails, a simple keyword matcher is used
instead so the app still works offline.
"""

import json
import os
import re

from .wizard_config import CATEGORIES, coerce_answer, format_answer

DEFAULT_MODEL = "claude-opus-5-5"

EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE_RE = re.compile(r"(?:\+?61|0)[\s-]?\d(?:[\s-]?\d){7,9}")


def redact(text):
    text = EMAIL_RE.sub("[email removed]", text)
    return PHONE_RE.sub("[phone removed]", text)


def _client():
    """Return an Anthropic client, or None when no credentials are configured."""
    if not os.environ.get("ANTHROPIC_API_KEY") and not os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        return None
    try:
        import anthropic
    except ImportError:
        return None
    return anthropic.Anthropic()


def ai_available():
    return _client() is not None


def _model():
    return os.environ.get("CLAUDE_MODEL", DEFAULT_MODEL)


def _ask_for_json(system, user_text, schema, max_tokens=4000):
    """Send one request and return the parsed JSON, or None if anything goes wrong."""
    client = _client()
    if client is None:
        return None
    import anthropic

    try:
        response = client.beta.messages.create(
            model=_model(),
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user_text}],
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
            # If the main model declines, the API retries on a fallback model.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.APIError as exc:
        print(f"[ai_agent] API error, using offline mode: {exc}")
        return None

    if response.stop_reason in ("refusal", "max_tokens"):
        return None
    text = next((b.text for b in response.content if b.type == "text"), None)
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


# ---- 1. Reading a request ------------------------------------------------

READ_SYSTEM = """You help the admin team at a small Australian tutoring company.
A staff member has described a request from a parent, student or tutor.
Pick the request type that fits best and fill in any wizard answers that the
description states clearly. Leave out anything you would have to guess.
You never decide whether the request is approved. A separate rules check does that.

Request types and their questions:
{catalogue}

Rules for answers:
- question_id must be one of the ids listed under the chosen request type.
- yesno answers are "yes" or "no". number answers are digits only. choice answers must
  match one of the listed options exactly.
- Use "other" as the request type if nothing fits.
- missing_info lists in plain words anything staff should find out before deciding."""

READ_SCHEMA = {
    "type": "object",
    "properties": {
        "category": {"type": "string", "enum": list(CATEGORIES.keys())},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "summary": {"type": "string"},
        "answers": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "question_id": {"type": "string"},
                    "value": {"type": "string"},
                },
                "required": ["question_id", "value"],
                "additionalProperties": False,
            },
        },
        "missing_info": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["category", "confidence", "summary", "answers", "missing_info"],
    "additionalProperties": False,
}


def _catalogue():
    lines = []
    for cid, cat in CATEGORIES.items():
        lines.append(f"- {cid}: {cat['label']}")
        for q in cat["questions"]:
            extra = f" options: {', '.join(q['options'])}" if q["type"] == "choice" else ""
            lines.append(f"    - {q['id']} ({q['type']}): {q['text']}{extra}")
    return "\n".join(lines)


def _clean_answers(category, raw_answers):
    """Keep only answers for real questions in this category, with the right types."""
    clean = {}
    questions = {q["id"]: q for q in CATEGORIES.get(category, {}).get("questions", [])}
    for item in raw_answers:
        q = questions.get(item.get("question_id"))
        if q is None:
            continue
        value = coerce_answer(q, item.get("value"))
        if value is not None:
            clean[q["id"]] = value
    return clean


def read_request(description):
    """Return {category, answers, confidence, summary, missing_info, source}."""
    safe_text = redact(description)
    data = _ask_for_json(READ_SYSTEM.format(catalogue=_catalogue()), safe_text, READ_SCHEMA)
    if data and data.get("category") in CATEGORIES:
        return {
            "category": data["category"],
            "answers": _clean_answers(data["category"], data.get("answers", [])),
            "confidence": data.get("confidence", "low"),
            "summary": data.get("summary", ""),
            "missing_info": data.get("missing_info", []),
            "source": "ai",
        }
    return offline_read_request(safe_text)


def offline_read_request(description):
    """Keyword fallback used when the AI is not available."""
    text = description.lower()
    best, best_hits = "other", 0
    for cid, cat in CATEGORIES.items():
        hits = sum(1 for kw in cat["keywords"] if kw in text)
        if hits > best_hits:
            best, best_hits = cid, hits

    answers = {}
    questions = {q["id"]: q for q in CATEGORIES[best]["questions"]}
    money = re.search(r"\$\s?(\d+(?:\.\d+)?)", description)
    if money and "amount" in questions:
        answers["amount"] = float(money.group(1))
    percent = re.search(r"(\d+(?:\.\d+)?)\s?%", description)
    if percent and "percent" in questions:
        answers["percent"] = float(percent.group(1))
    lessons = re.search(r"(\d+)\s+lessons?", text)
    if lessons and "lessons_used" in questions:
        answers["lessons_used"] = float(lessons.group(1))
    hours = re.search(r"(\d+)\s*(?:hours?|hrs?)", text)
    if hours and "notice_hours" in questions:
        answers["notice_hours"] = float(hours.group(1))
    days = re.search(r"(\d+)\s*days?", text)
    if days and "days_overdue" in questions:
        answers["days_overdue"] = float(days.group(1))
    if "who_cancelled" in questions:
        if "tutor" in text and ("sick" in text or "cancel" in text):
            answers["who_cancelled"] = "Tutor"
        elif "student" in text or "parent" in text:
            answers["who_cancelled"] = "Student"
    if "within_term" in questions and "this term" in text:
        answers["within_term"] = True
    if "reason" in questions and best == "refund":
        reason_words = {
            "Illness or injury": ["sick", "ill", "injur", "broke", "hospital"],
            "Moving away": ["moving", "move to", "relocat", "interstate"],
            "Schedule clash": ["clash", "schedule", "timetable", "sport"],
            "Unhappy with tutor": ["unhappy", "not happy", "complain"],
        }
        for option, words in reason_words.items():
            if any(w in text for w in words):
                answers["reason"] = option
                break
    if "sibling" in questions and ("sibling" in text or "brother" in text or "sister" in text):
        answers["sibling"] = True

    return {
        "category": best,
        "answers": answers,
        "confidence": "medium" if best_hits >= 2 else "low",
        "summary": "Matched on keywords (offline mode). Please check the request type and answers.",
        "missing_info": [],
        "source": "offline",
    }


# ---- 2. Drafting an escalation for the owner -----------------------------

DRAFT_SYSTEM = """You prepare short escalation briefs for the owner of a small tutoring company.
The owner wants to decide in under a minute without asking follow-up questions.
Use plain Australian English. Be factual. Do not make up details that are not given.
Give two or three realistic options, each with its likely consequence, and say which
one fits the owner's past decisions best. The owner makes the final call."""

DRAFT_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "key_facts": {"type": "array", "items": {"type": "string"}},
        "options": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "option": {"type": "string"},
                    "consequence": {"type": "string"},
                },
                "required": ["option", "consequence"],
                "additionalProperties": False,
            },
        },
        "suggested": {"type": "string"},
        "questions_for_owner": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["summary", "key_facts", "options", "suggested", "questions_for_owner"],
    "additionalProperties": False,
}


def _brief_input(request, rule, similar, staff_note):
    cat = CATEGORIES.get(request["category"], {})
    lines = [
        f"Request type: {cat.get('label', request['category'])}",
        f"Raised by: {request['created_by']} ({request['created_role']})",
        f"Description: {redact(request['description'])}",
        "Answers:",
    ]
    for q in cat.get("questions", []):
        lines.append(f"  - {q['text']} {format_answer(request['answers'].get(q['id']))}")
    lines.append(f"Traffic light: {request['colour']} - {request['headline']}")
    if rule:
        lines.append(f"Rule triggered: {rule['title']}. {rule.get('note', '')}")
    if staff_note:
        lines.append(f"Staff note: {redact(staff_note)}")
    if similar:
        lines.append("Similar past decisions:")
        for s in similar:
            decision = s.get("owner_comment") or s.get("action_taken") or ""
            lines.append(f"  - {redact(s['description'])} -> {s['status']}: {decision}")
    return "\n".join(lines)


def draft_escalation(request, rule, similar, staff_note=""):
    """Return {summary, key_facts, options, suggested, questions_for_owner, source}."""
    data = _ask_for_json(DRAFT_SYSTEM, _brief_input(request, rule, similar, staff_note), DRAFT_SCHEMA)
    if data:
        data["source"] = "ai"
        return data
    return offline_draft(request, rule, similar, staff_note)


def offline_draft(request, rule, similar, staff_note=""):
    cat = CATEGORIES.get(request["category"], {})
    facts = [f"{q['text']} {format_answer(request['answers'].get(q['id']))}"
             for q in cat.get("questions", []) if request["answers"].get(q["id"]) is not None]
    if staff_note:
        facts.append(f"Staff note: {staff_note}")
    options = [
        {"option": "Approve as requested", "consequence": "Staff go ahead and record the outcome."},
        {"option": "Approve with changes", "consequence": "Staff follow your conditions."},
        {"option": "Reject", "consequence": "Staff explain the decision to the family."},
    ]
    suggested = ""
    if similar:
        s = similar[0]
        status = {"resolved": "handled by staff"}.get(s["status"], s["status"])
        suggested = f"Most similar past case was {status}: {s.get('owner_comment') or s.get('action_taken')}"
    return {
        "summary": f"{cat.get('label', 'Request')} from {request['created_by']}. "
                   f"{rule['title'] if rule else 'No matching rule'}.",
        "key_facts": facts,
        "options": options,
        "suggested": suggested,
        "questions_for_owner": [],
        "source": "offline",
    }
