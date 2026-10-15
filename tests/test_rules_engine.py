"""Tests for the traffic light check, using the sample rules."""

from datetime import date, timedelta

import pytest

from traffic_lights.rules_engine import check, similar_cases
from traffic_lights.seed_data import RULES


@pytest.fixture
def rules():
    # Give each sample rule an id and the defaults the database would add.
    out = []
    for i, r in enumerate(RULES, start=1):
        out.append({"id": i, "min_role": "admin", "requires_owner": False, "active": True,
                    "note": "", "procedure": "", **r})
    return out


def test_small_early_refund_is_green_for_admin(rules):
    result = check("refund", {"amount": 40.0, "lessons_used": 1.0, "reason": "Moving away", "within_term": True},
                   "admin", rules)
    assert result.colour == "green"
    assert result.rule["title"] == "Small refund early in the term"


def test_same_refund_is_red_for_a_tutor(rules):
    result = check("refund", {"amount": 40.0, "lessons_used": 1.0, "reason": "Moving away", "within_term": True},
                   "tutor", rules)
    assert result.colour == "red"
    assert result.approver == "Admin team"


def test_large_refund_needs_owner(rules):
    result = check("refund", {"amount": 200.0, "lessons_used": 1.0, "reason": "Moving away", "within_term": True},
                   "admin", rules)
    assert result.colour == "red"
    assert result.approver == "Owner"


def test_refund_linked_to_tutor_complaint_needs_owner_even_if_small(rules):
    result = check("refund", {"amount": 20.0, "lessons_used": 1.0, "reason": "Unhappy with tutor", "within_term": True},
                   "admin", rules)
    assert result.colour == "red"


def test_missing_answers_give_amber(rules):
    result = check("refund", {"amount": 40.0}, "admin", rules)
    assert result.colour == "amber"
    assert len(result.missing) == 3


def test_no_matching_rule_gives_amber(rules):
    # Small amount, but last term: no rule covers it.
    result = check("refund", {"amount": 40.0, "lessons_used": 1.0, "reason": "Moving away", "within_term": False},
                   "admin", rules)
    assert result.colour == "amber"
    assert result.rule is None


def test_unknown_type_gives_amber(rules):
    assert check("other", {}, "admin", rules).colour == "amber"
    assert check("made_up", {}, "admin", rules).colour == "amber"


def test_complaints_always_red(rules):
    assert check("complaint", {"about": "Billing"}, "owner", rules).colour == "red"


def test_stale_green_rule_drops_to_amber(rules):
    # The sibling discount rule is seeded as last reviewed over a year ago.
    result = check("discount", {"percent": 10.0, "sibling": True, "first_request": True}, "admin", rules)
    assert result.colour == "amber"
    assert "out of date" in result.headline


def test_reviewed_rule_is_green_again(rules):
    for r in rules:
        if r["title"] == "Sibling discount up to 10%":
            r["last_reviewed"] = (date.today() - timedelta(days=1)).isoformat()
    result = check("discount", {"percent": 10.0, "sibling": True, "first_request": True}, "admin", rules)
    assert result.colour == "green"


def test_inactive_rules_are_ignored(rules):
    for r in rules:
        if r["title"] == "Small refund early in the term":
            r["active"] = False
    result = check("refund", {"amount": 40.0, "lessons_used": 1.0, "reason": "Moving away", "within_term": True},
                   "admin", rules)
    assert result.colour == "amber"


def test_rule_order_matters(rules):
    # A tutor swap because of a complaint is red even if a replacement is free.
    result = check("tutor_change", {"reason": "Complaint about tutor", "replacement_available": True,
                                    "same_level": True}, "admin", rules)
    assert result.colour == "red"


def test_amber_rule(rules):
    result = check("exam_booklet", {"has_both": False, "fees_paid": True}, "tutor", rules)
    assert result.colour == "amber"


def test_similar_cases_ranks_matching_answers_first():
    past = [
        {"id": 1, "category": "refund", "description": "moving away refund", "answers": {"reason": "Moving away"}},
        {"id": 2, "category": "refund", "description": "schedule clash", "answers": {"reason": "Schedule clash"}},
        {"id": 3, "category": "payment", "description": "moving away", "answers": {}},
    ]
    found = similar_cases("refund", {"reason": "Moving away"}, "family moving interstate", past)
    assert [f["id"] for f in found] == [1]
