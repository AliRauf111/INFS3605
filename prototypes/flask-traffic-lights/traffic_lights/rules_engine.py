"""The traffic light check.

This is plain if-then logic over the owner's rules. The AI agent never decides
the colour. It only helps fill in the wizard answers, which staff confirm
before this check runs.

The order follows section 5 of our Solution Design Document:
    1. Unknown request type or "something else"       -> amber
    2. Owner-only request type (complaints)            -> red
    3. Required answers missing                        -> amber
    4. First active rule whose conditions all match:
         rule says red, needs owner, or role too low   -> red
         rule says amber                               -> amber
         rule says green but not reviewed recently     -> amber
         otherwise                                     -> green
    5. No rule matches                                 -> amber

The idea is that the system fails safe. If anything is unclear, missing or out
of date, the answer is never green.
"""

from dataclasses import dataclass, field
from datetime import date, datetime

from .wizard_config import CATEGORIES, ROLE_LABELS, ROLES, format_answer

STALE_AFTER_DAYS = 180

OPERATORS = {
    "==": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
    "<": lambda a, b: a is not None and a < b,
    "<=": lambda a, b: a is not None and a <= b,
    ">": lambda a, b: a is not None and a > b,
    ">=": lambda a, b: a is not None and a >= b,
    "in": lambda a, b: a in b,
}


@dataclass
class CheckResult:
    colour: str  # "green", "amber" or "red"
    headline: str
    reasons: list = field(default_factory=list)
    missing: list = field(default_factory=list)  # question texts still unanswered
    rule: dict | None = None
    approver: str | None = None  # who has to sign off when red


def condition_matches(condition, answers):
    question_id = condition["q"]
    op = OPERATORS.get(condition["op"])
    if op is None:
        return False
    value = answers.get(question_id)
    expected = condition["value"]
    try:
        return bool(op(value, expected))
    except TypeError:
        # Comparing a number to text, for example. Treat as no match.
        return False


def rule_matches(rule, answers):
    return all(condition_matches(c, answers) for c in rule["conditions"])


def is_stale(rule, today=None):
    today = today or date.today()
    reviewed = rule.get("last_reviewed")
    if not reviewed:
        return True
    if isinstance(reviewed, str):
        reviewed = datetime.strptime(reviewed[:10], "%Y-%m-%d").date()
    return (today - reviewed).days > STALE_AFTER_DAYS


def describe_conditions(rule):
    if not rule["conditions"]:
        return "Applies to every request of this type"
    parts = []
    for c in rule["conditions"]:
        value = c["value"]
        if isinstance(value, list):
            value = " or ".join(format_answer(v) for v in value)
        else:
            value = format_answer(value)
        parts.append(f"{c['q'].replace('_', ' ')} {c['op']} {value}")
    return "; ".join(parts)


def check(category, answers, role, rules, today=None):
    """Work out the traffic light for one request.

    category: request type id from wizard_config.CATEGORIES
    answers:  dict of question id -> confirmed answer
    role:     "tutor", "admin" or "owner"
    rules:    list of rule dicts (id, category, priority, conditions, outcome,
              min_role, requires_owner, active, last_reviewed, title, procedure, note)
    """
    cat = CATEGORIES.get(category)
    if cat is None or category == "other":
        return CheckResult(
            colour="amber",
            headline="Check first: there is no rule set for this kind of request",
            reasons=["The owner hasn't written rules for this type of request yet.",
                     "Add as much detail as you can and send it to the owner if you can't resolve it."],
            approver="Owner",
        )

    if cat.get("owner_only"):
        return CheckResult(
            colour="red",
            headline="Owner approval needed",
            reasons=[f"{cat['label']}s always go to the owner. Parents expect a senior person to handle these."],
            approver="Owner",
        )

    missing = [q["text"] for q in cat["questions"] if answers.get(q["id"]) is None]
    if missing:
        return CheckResult(
            colour="amber",
            headline="Check first: some details are missing",
            reasons=["The rules can't be checked until these questions are answered."],
            missing=missing,
        )

    candidates = sorted(
        (r for r in rules if r["category"] == category and r["active"]),
        key=lambda r: r["priority"],
    )
    matched = next((r for r in candidates if rule_matches(r, answers)), None)

    if matched is None:
        return CheckResult(
            colour="amber",
            headline="Check first: no rule covers this exact situation",
            reasons=["None of the owner's rules match these answers.",
                     "Double-check the answers. If they are right, send it to the owner so a rule can be added."],
            approver="Owner",
        )

    role_rank = ROLES.get(role, 0)
    needed_rank = ROLES.get(matched["min_role"], ROLES["owner"])

    if matched["outcome"] == "red" or matched["requires_owner"]:
        return CheckResult(
            colour="red",
            headline="Owner approval needed",
            reasons=[matched.get("note") or "The owner's rule says this needs their approval."],
            rule=matched,
            approver="Owner",
        )

    if role_rank < needed_rank:
        approver = ROLE_LABELS[matched["min_role"]]
        return CheckResult(
            colour="red",
            headline=f"{approver} approval needed",
            reasons=[f"This rule can only be actioned by the {approver.lower()} or above. "
                     f"Your role is {ROLE_LABELS.get(role, role).lower()}."],
            rule=matched,
            approver=approver,
        )

    if matched["outcome"] == "amber":
        return CheckResult(
            colour="amber",
            headline="Check first before going ahead",
            reasons=[matched.get("note") or "The rule says to check something before acting."],
            rule=matched,
        )

    if is_stale(matched, today):
        return CheckResult(
            colour="amber",
            headline="Check first: this rule may be out of date",
            reasons=[f"The rule was last reviewed on {matched.get('last_reviewed') or 'an unknown date'}, "
                     f"more than {STALE_AFTER_DAYS} days ago.",
                     "Confirm with the owner that it still applies, or ask them to mark it reviewed."],
            rule=matched,
            approver="Owner",
        )

    return CheckResult(
        colour="green",
        headline="Go ahead: you can handle this yourself",
        reasons=[matched.get("note") or "This matches an approved rule within your authority."],
        rule=matched,
    )


def similar_cases(category, answers, description, past_requests, limit=3):
    """Rank past closed requests of the same type by how alike they are.

    A simple score: one point for each matching yes/no or number answer, three
    points for a matching choice answer (like the reason, which says the most
    about the situation), plus a point for each shared word of four letters or
    more in the description.
    """
    words = {w for w in description.lower().split() if len(w) >= 4}
    scored = []
    for past in past_requests:
        if past["category"] != category:
            continue
        score = sum(3 if isinstance(v, str) else 1
                    for k, v in answers.items() if past["answers"].get(k) == v)
        past_words = {w for w in (past["description"] or "").lower().split() if len(w) >= 4}
        score += len(words & past_words)
        scored.append((score, past))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [p for s, p in scored[:limit] if s > 0]
