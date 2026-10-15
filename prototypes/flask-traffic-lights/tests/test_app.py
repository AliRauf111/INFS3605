"""End-to-end tests of the main flows, in offline mode (no API key)."""

import pytest

from traffic_lights import ai_agent, create_app, db


@pytest.fixture
def app(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    app = create_app({"TESTING": True, "DATABASE": str(tmp_path / "test.db")})
    with app.app_context():
        db.init_db()
    return app


@pytest.fixture
def client(app):
    return app.test_client()


def login(client, name):
    ids = {"Sarah": 1, "Tom": 2, "Alex": 3}
    client.post("/", data={"user_id": ids[name]})


def submit(client, description, category, answers):
    client.post("/new", data={"description": description, "mode": "manual", "category": category})
    return client.post("/wizard", data={"category": category, **answers}, follow_redirects=True)


def test_pages_load(client):
    assert client.get("/").status_code == 200
    login(client, "Sarah")
    for path in ["/new", "/log", "/rules", "/rules/1"]:
        assert client.get(path).status_code == 200, path


def test_staff_cannot_open_owner_page(client):
    login(client, "Sarah")
    assert client.get("/owner").status_code == 403


def test_green_flow_records_outcome(client, app):
    login(client, "Sarah")
    page = submit(client, "Family moving, wants $40 back", "refund",
                  {"amount": "40", "lessons_used": "1", "reason": "Moving away", "within_term": "yes"})
    assert b"Go ahead" in page.data
    client.post("/requests/12/record", data={"action_taken": "Refunded $40", "outcome": "Done"})
    with app.app_context():
        req = db.get_request(12)
        assert req["status"] == db.RESOLVED
        assert "Refunded $40" in req["action_taken"]


def test_red_flow_escalate_and_owner_saves_rule(client, app):
    login(client, "Sarah")
    page = submit(client, "Wants $150 back after injury", "refund",
                  {"amount": "150", "lessons_used": "1", "reason": "Illness or injury", "within_term": "yes"})
    assert b"Owner approval needed" in page.data
    client.post("/requests/12/escalate", data={"staff_note": "Long-time family"})
    with app.app_context():
        req = db.get_request(12)
        assert req["status"] == db.AWAITING_OWNER
        assert req["escalation"]["source"] == "offline"

    # Staff can't decide
    assert client.post("/requests/12/decide", data={"decision": "approve"}).status_code == 403

    login(client, "Alex")
    assert b"need you" in client.get("/owner").data
    client.post("/requests/12/decide", data={
        "decision": "approve", "comment": "Fine for injuries", "save_rule": "1",
        "staff_can_handle": "1", "rule_title": "Injury refund up to $150"})
    with app.app_context():
        assert db.get_request(12)["status"] == db.APPROVED
        new_rule = [r for r in db.all_rules() if r["title"] == "Injury refund up to $150"][0]
        assert new_rule["outcome"] == "green"

    # Next time the same request is green for staff.
    login(client, "Sarah")
    page = submit(client, "Another injury refund", "refund",
                  {"amount": "150", "lessons_used": "1", "reason": "Illness or injury", "within_term": "yes"})
    assert b"Go ahead" in page.data


def test_amber_then_fix_answers(client, app):
    login(client, "Sarah")
    page = submit(client, "Refund request", "refund", {"amount": "40"})
    assert b"some details are missing" in page.data
    client.post("/requests/12/edit")
    page = client.post("/wizard", data={"category": "refund", "amount": "40", "lessons_used": "1",
                                        "reason": "Moving away", "within_term": "yes"}, follow_redirects=True)
    assert b"Go ahead" in page.data


def test_owner_edits_rule_and_keeps_history(client, app):
    login(client, "Alex")
    client.post("/rules/2", data={
        "title": "Small refund early in the term", "priority": "20", "outcome": "green", "min_role": "admin",
        "conditions": '[{"q": "amount", "op": "<=", "value": 80}]', "active": "1",
        "note": "Raised to $80", "procedure": "", "source": "Owner"})
    with app.app_context():
        assert db.get_rule(2)["version"] == 2
        assert len(db.rule_history(2)) == 1


def test_bad_conditions_are_rejected(client, app):
    login(client, "Alex")
    client.post("/rules/2", data={"title": "x", "outcome": "green", "min_role": "admin", "conditions": "not json"})
    with app.app_context():
        assert db.get_rule(2)["version"] == 1


def test_offline_reader_picks_refund():
    reading = ai_agent.offline_read_request("Parent wants a refund of $40 after 1 lesson")
    assert reading["category"] == "refund"
    assert reading["answers"]["amount"] == 40.0
    assert reading["answers"]["lessons_used"] == 1.0


def test_redact_masks_contact_details():
    text = ai_agent.redact("Call me on 0412 345 678 or jane.doe@example.com")
    assert "0412" not in text and "example.com" not in text


def test_ai_answers_are_checked_before_use(monkeypatch):
    fake = {"category": "refund", "confidence": "high", "summary": "Refund after injury",
            "answers": [{"question_id": "amount", "value": "150"},
                        {"question_id": "reason", "value": "Illness or injury"},
                        {"question_id": "within_term", "value": "maybe"},   # invalid, dropped
                        {"question_id": "made_up", "value": "yes"}],        # unknown, dropped
            "missing_info": []}
    monkeypatch.setattr(ai_agent, "_ask_for_json", lambda *a, **k: fake)
    reading = ai_agent.read_request("Mum wants $150 back, son broke his arm")
    assert reading["source"] == "ai"
    assert reading["answers"] == {"amount": 150.0, "reason": "Illness or injury"}


def test_red_request_is_not_waiting_on_owner_until_sent(client, app):
    login(client, "Sarah")
    submit(client, "Big refund", "refund",
           {"amount": "500", "lessons_used": "1", "reason": "Moving away", "within_term": "yes"})
    with app.app_context():
        assert db.get_request(12)["status"] == db.TO_OWNER
