"""SQLite storage: users, rules, rule history and requests.

Requests double as the decision log. Once a request is closed (handled by
staff or decided by the owner) it becomes a past decision that later searches
can find.
"""

import json
import sqlite3
from datetime import datetime

from flask import current_app, g

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('tutor', 'admin', 'owner'))
);

CREATE TABLE IF NOT EXISTS rules (
    id INTEGER PRIMARY KEY,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 100,
    conditions TEXT NOT NULL DEFAULT '[]',
    outcome TEXT NOT NULL CHECK (outcome IN ('green', 'amber', 'red')),
    min_role TEXT NOT NULL DEFAULT 'admin',
    requires_owner INTEGER NOT NULL DEFAULT 0,
    procedure TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1,
    last_reviewed TEXT,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rule_history (
    id INTEGER PRIMARY KEY,
    rule_id INTEGER NOT NULL REFERENCES rules(id),
    version INTEGER NOT NULL,
    snapshot TEXT NOT NULL,
    changed_by TEXT NOT NULL,
    changed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY,
    created_by TEXT NOT NULL,
    created_role TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    answers TEXT NOT NULL DEFAULT '{}',
    colour TEXT NOT NULL,
    headline TEXT NOT NULL DEFAULT '',
    reasons TEXT NOT NULL DEFAULT '[]',
    rule_id INTEGER REFERENCES rules(id),
    ai_used INTEGER NOT NULL DEFAULT 0,
    ai_notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    action_taken TEXT NOT NULL DEFAULT '',
    outcome TEXT NOT NULL DEFAULT '',
    staff_note TEXT NOT NULL DEFAULT '',
    escalation TEXT NOT NULL DEFAULT '',
    owner_decision TEXT NOT NULL DEFAULT '',
    owner_comment TEXT NOT NULL DEFAULT '',
    decided_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    closed_at TEXT
);
"""

# Request statuses
NEEDS_INFO = "needs_info"
READY = "ready"  # green, staff yet to record what they did
TO_OWNER = "to_owner"  # red, staff yet to send it to the owner
AWAITING_OWNER = "awaiting_owner"
RESOLVED = "resolved"
APPROVED = "approved"
REJECTED = "rejected"
MODIFIED = "modified"
CLOSED_STATUSES = (RESOLVED, APPROVED, REJECTED, MODIFIED)

STATUS_LABELS = {
    NEEDS_INFO: "Needs more info",
    READY: "Ready to action",
    TO_OWNER: "To send to owner",
    AWAITING_OWNER: "Waiting on owner",
    RESOLVED: "Handled by staff",
    APPROVED: "Approved by owner",
    REJECTED: "Rejected by owner",
    MODIFIED: "Approved with changes",
}


def now():
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(current_app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def close_db(_error=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db(seed=True):
    db = get_db()
    db.executescript(
        "DROP TABLE IF EXISTS requests; DROP TABLE IF EXISTS rule_history;"
        "DROP TABLE IF EXISTS rules; DROP TABLE IF EXISTS users;"
    )
    db.executescript(SCHEMA)
    if seed:
        from .seed_data import seed
        seed(db)
    db.commit()


def ensure_db():
    """Create and seed the database on first run."""
    db = get_db()
    exists = db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='rules'"
    ).fetchone()
    if not exists:
        init_db()


# ---- rules ---------------------------------------------------------------

def rule_from_row(row):
    rule = dict(row)
    rule["conditions"] = json.loads(rule["conditions"])
    rule["active"] = bool(rule["active"])
    rule["requires_owner"] = bool(rule["requires_owner"])
    return rule


def all_rules(active_only=False):
    sql = "SELECT * FROM rules"
    if active_only:
        sql += " WHERE active = 1"
    sql += " ORDER BY category, priority"
    return [rule_from_row(r) for r in get_db().execute(sql).fetchall()]


def get_rule(rule_id):
    row = get_db().execute("SELECT * FROM rules WHERE id = ?", (rule_id,)).fetchone()
    return rule_from_row(row) if row else None


def insert_rule(db, rule):
    cur = db.execute(
        """INSERT INTO rules (category, title, priority, conditions, outcome, min_role,
               requires_owner, procedure, note, source, active, last_reviewed, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            rule["category"], rule["title"], rule.get("priority", 100),
            json.dumps(rule.get("conditions", [])), rule["outcome"],
            rule.get("min_role", "admin"), int(rule.get("requires_owner", False)),
            rule.get("procedure", ""), rule.get("note", ""), rule.get("source", ""),
            int(rule.get("active", True)), rule.get("last_reviewed"), now(),
        ),
    )
    return cur.lastrowid


def update_rule(rule_id, changes, changed_by):
    """Save a new version of a rule and keep the old one in rule_history."""
    db = get_db()
    old = get_rule(rule_id)
    db.execute(
        "INSERT INTO rule_history (rule_id, version, snapshot, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)",
        (rule_id, old["version"], json.dumps(old), changed_by, now()),
    )
    merged = {**old, **changes}
    db.execute(
        """UPDATE rules SET title = ?, priority = ?, conditions = ?, outcome = ?, min_role = ?,
               requires_owner = ?, procedure = ?, note = ?, source = ?, active = ?,
               last_reviewed = ?, version = version + 1, updated_at = ?
           WHERE id = ?""",
        (
            merged["title"], merged["priority"], json.dumps(merged["conditions"]),
            merged["outcome"], merged["min_role"], int(merged["requires_owner"]),
            merged["procedure"], merged["note"], merged["source"], int(merged["active"]),
            merged["last_reviewed"], now(), rule_id,
        ),
    )
    db.commit()


def rule_history(rule_id):
    rows = get_db().execute(
        "SELECT * FROM rule_history WHERE rule_id = ? ORDER BY version DESC", (rule_id,)
    ).fetchall()
    history = []
    for row in rows:
        item = dict(row)
        item["snapshot"] = json.loads(item["snapshot"])
        history.append(item)
    return history


def next_top_priority(category):
    row = get_db().execute(
        "SELECT MIN(priority) AS p FROM rules WHERE category = ?", (category,)
    ).fetchone()
    return (row["p"] or 100) - 1


# ---- requests ------------------------------------------------------------

def request_from_row(row):
    req = dict(row)
    req["answers"] = json.loads(req["answers"])
    req["reasons"] = json.loads(req["reasons"])
    req["escalation"] = json.loads(req["escalation"]) if req["escalation"] else None
    return req


def insert_request(db, req):
    cur = db.execute(
        """INSERT INTO requests (created_by, created_role, description, category, answers, colour,
               headline, reasons, rule_id, ai_used, ai_notes, status, action_taken, outcome,
               owner_decision, owner_comment, decided_by, created_at, closed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            req["created_by"], req["created_role"], req["description"], req["category"],
            json.dumps(req.get("answers", {})), req["colour"], req.get("headline", ""),
            json.dumps(req.get("reasons", [])), req.get("rule_id"), int(req.get("ai_used", False)),
            req.get("ai_notes", ""), req["status"], req.get("action_taken", ""),
            req.get("outcome", ""), req.get("owner_decision", ""), req.get("owner_comment", ""),
            req.get("decided_by", ""), req.get("created_at", now()), req.get("closed_at"),
        ),
    )
    return cur.lastrowid


def get_request(request_id):
    row = get_db().execute("SELECT * FROM requests WHERE id = ?", (request_id,)).fetchone()
    return request_from_row(row) if row else None


def update_request(request_id, **fields):
    if "escalation" in fields and not isinstance(fields["escalation"], str):
        fields["escalation"] = json.dumps(fields["escalation"])
    cols = ", ".join(f"{k} = ?" for k in fields)
    get_db().execute(f"UPDATE requests SET {cols} WHERE id = ?", (*fields.values(), request_id))
    get_db().commit()


def list_requests(status=None, closed_only=False, search=None, category=None, colour=None):
    sql = "SELECT * FROM requests WHERE 1=1"
    params = []
    if status:
        sql += " AND status = ?"
        params.append(status)
    if closed_only:
        sql += f" AND status IN ({', '.join('?' * len(CLOSED_STATUSES))})"
        params.extend(CLOSED_STATUSES)
    if search:
        sql += " AND (description LIKE ? OR action_taken LIKE ? OR outcome LIKE ? OR owner_comment LIKE ?)"
        params.extend([f"%{search}%"] * 4)
    if category:
        sql += " AND category = ?"
        params.append(category)
    if colour:
        sql += " AND colour = ?"
        params.append(colour)
    sql += " ORDER BY created_at DESC, id DESC"
    return [request_from_row(r) for r in get_db().execute(sql, params).fetchall()]
