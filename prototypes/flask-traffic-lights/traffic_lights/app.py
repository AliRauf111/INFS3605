"""Flask routes for the Traffic Lights decision wizard.

Staff flow:  describe request -> AI pre-fills wizard -> staff confirm answers
             -> rules check gives green / amber / red -> act or escalate -> log
Owner flow:  approvals queue -> approve / reject / modify -> optionally save
             the decision as a new rule
"""

import json
import os
from datetime import date
from functools import wraps

from flask import (Flask, abort, flash, g, redirect, render_template, request,
                   session, url_for)

from . import ai_agent, db
from .rules_engine import check, describe_conditions, is_stale, similar_cases
from .wizard_config import (CATEGORIES, ROLE_LABELS, ROLES, category_label,
                            coerce_answer, format_answer)


def create_app(test_config=None):
    app = Flask(__name__, instance_relative_config=True)
    app.config.from_mapping(
        SECRET_KEY=os.environ.get("SECRET_KEY", "dev-only-change-me"),
        DATABASE=os.path.join(app.instance_path, "traffic_lights.db"),
    )
    if test_config:
        app.config.update(test_config)
    os.makedirs(app.instance_path, exist_ok=True)

    app.teardown_appcontext(db.close_db)

    @app.cli.command("init-db")
    def init_db_command():
        """Reset the database and load the sample rules."""
        db.init_db()
        print("Database reset with sample data.")

    @app.before_request
    def load_user():
        db.ensure_db()
        g.user = None
        if "user_id" in session:
            row = db.get_db().execute("SELECT * FROM users WHERE id = ?", (session["user_id"],)).fetchone()
            g.user = dict(row) if row else None

    @app.context_processor
    def helpers():
        return {
            "CATEGORIES": CATEGORIES,
            "ROLE_LABELS": ROLE_LABELS,
            "STATUS_LABELS": db.STATUS_LABELS,
            "category_label": category_label,
            "format_answer": format_answer,
            "describe_conditions": describe_conditions,
            "ai_on": ai_agent.ai_available(),
            "owner_queue_count": _owner_queue_count() if g.get("user") else 0,
        }

    register_routes(app)
    return app


def _owner_queue_count():
    return len(db.list_requests(status=db.AWAITING_OWNER))


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            return redirect(url_for("index"))
        return view(*args, **kwargs)
    return wrapped


def owner_required(view):
    @wraps(view)
    @login_required
    def wrapped(*args, **kwargs):
        if g.user["role"] != "owner":
            abort(403)
        return view(*args, **kwargs)
    return wrapped


def _past_decisions():
    return db.list_requests(closed_only=True)


def _run_check(category, answers, description):
    rules = db.all_rules(active_only=True)
    result = check(category, answers, g.user["role"], rules)
    similar = similar_cases(category, answers, description, _past_decisions())
    return result, similar


def _status_for(colour):
    return {"green": db.READY, "amber": db.NEEDS_INFO, "red": db.TO_OWNER}[colour]


def register_routes(app):

    # ---- sign in -----------------------------------------------------------

    @app.route("/", methods=["GET", "POST"])
    def index():
        if request.method == "POST":
            session.clear()
            session["user_id"] = int(request.form["user_id"])
            user = db.get_db().execute("SELECT role FROM users WHERE id = ?", (session["user_id"],)).fetchone()
            if user and user["role"] == "owner":
                return redirect(url_for("owner_home"))
            return redirect(url_for("new_request"))
        users = db.get_db().execute("SELECT * FROM users ORDER BY id").fetchall()
        return render_template("index.html", users=users)

    @app.route("/logout")
    def logout():
        session.clear()
        return redirect(url_for("index"))

    # ---- step 1: describe the request ---------------------------------------

    @app.route("/new", methods=["GET", "POST"])
    @login_required
    def new_request():
        if request.method == "POST":
            description = request.form.get("description", "").strip()
            if not description:
                flash("Describe the request first.", "error")
                return redirect(url_for("new_request"))
            if request.form.get("mode") == "manual":
                reading = {"category": request.form.get("category", "other"), "answers": {},
                           "confidence": None, "summary": "", "missing_info": [], "source": "manual"}
            else:
                reading = ai_agent.read_request(description)
            session["draft"] = {
                "description": description,
                "category": reading["category"],
                "answers": reading["answers"],
                "ai": {k: reading[k] for k in ("confidence", "summary", "missing_info", "source")},
                "prefilled": list(reading["answers"].keys()),
                "request_id": None,
            }
            return redirect(url_for("wizard"))
        return render_template("new_request.html")

    # ---- step 2: confirm the wizard answers --------------------------------

    @app.route("/wizard", methods=["GET", "POST"])
    @login_required
    def wizard():
        draft = session.get("draft")
        if not draft:
            return redirect(url_for("new_request"))

        if request.method == "POST":
            category = request.form.get("category", draft["category"])
            if category not in CATEGORIES:
                category = "other"
            answers = {}
            for q in CATEGORIES[category]["questions"]:
                value = coerce_answer(q, request.form.get(q["id"]))
                if value is not None:
                    answers[q["id"]] = value

            if category != draft["category"]:
                draft.update(category=category, answers=answers, prefilled=[])
                session["draft"] = draft
                return redirect(url_for("wizard"))

            result, _similar = _run_check(category, answers, draft["description"])
            fields = dict(
                category=category, answers=json.dumps(answers), colour=result.colour,
                headline=result.headline, reasons=json.dumps(result.reasons + result.missing),
                rule_id=result.rule["id"] if result.rule else None,
                status=_status_for(result.colour),
            )
            if draft.get("request_id"):
                request_id = draft["request_id"]
                db.update_request(request_id, **fields)
            else:
                request_id = db.insert_request(db.get_db(), {
                    **fields,
                    "answers": answers, "reasons": result.reasons + result.missing,
                    "created_by": g.user["name"], "created_role": g.user["role"],
                    "description": draft["description"],
                    "ai_used": draft["ai"]["source"] == "ai",
                    "ai_notes": draft["ai"].get("summary", ""),
                })
                db.get_db().commit()
            session.pop("draft", None)
            return redirect(url_for("view_request", request_id=request_id))

        category = draft["category"]
        return render_template("wizard.html", draft=draft, category=category,
                               questions=CATEGORIES[category]["questions"])

    # ---- result and actions ------------------------------------------------

    @app.route("/requests/<int:request_id>")
    @login_required
    def view_request(request_id):
        req = db.get_request(request_id)
        if req is None:
            abort(404)
        rule = db.get_rule(req["rule_id"]) if req["rule_id"] else None
        similar = [s for s in similar_cases(req["category"], req["answers"], req["description"],
                                            _past_decisions()) if s["id"] != req["id"]]
        missing = [q["text"] for q in CATEGORIES.get(req["category"], {}).get("questions", [])
                   if req["answers"].get(q["id"]) is None]
        return render_template("request.html", req=req, rule=rule, similar=similar, missing=missing)

    @app.route("/requests/<int:request_id>/edit", methods=["POST"])
    @login_required
    def edit_request(request_id):
        req = db.get_request(request_id)
        if req is None or req["status"] in db.CLOSED_STATUSES:
            abort(400)
        session["draft"] = {
            "description": req["description"], "category": req["category"], "answers": req["answers"],
            "ai": {"confidence": None, "summary": req["ai_notes"], "missing_info": [], "source": "manual"},
            "prefilled": [], "request_id": request_id,
        }
        return redirect(url_for("wizard"))

    @app.route("/requests/<int:request_id>/record", methods=["POST"])
    @login_required
    def record_action(request_id):
        req = db.get_request(request_id)
        allowed = req and (req["status"] == db.READY or
                           (req["status"] in (db.APPROVED, db.MODIFIED) and not req["action_taken"]))
        if not allowed:
            abort(400)
        action = request.form.get("action_taken", "").strip()
        if not action:
            flash("Write down what you did.", "error")
            return redirect(url_for("view_request", request_id=request_id))
        fields = {"action_taken": f"{action} (recorded by {g.user['name']})",
                  "outcome": request.form.get("outcome", "").strip()}
        if req["status"] == db.READY:
            fields.update(status=db.RESOLVED, closed_at=db.now())
        db.update_request(request_id, **fields)
        flash("Recorded. Thanks, this is now in the decision log.", "success")
        return redirect(url_for("view_request", request_id=request_id))

    @app.route("/requests/<int:request_id>/escalate", methods=["POST"])
    @login_required
    def escalate(request_id):
        req = db.get_request(request_id)
        if req is None or req["status"] in db.CLOSED_STATUSES:
            abort(400)
        staff_note = request.form.get("staff_note", "").strip()
        rule = db.get_rule(req["rule_id"]) if req["rule_id"] else None
        similar = [s for s in similar_cases(req["category"], req["answers"], req["description"],
                                            _past_decisions()) if s["id"] != req["id"]]
        brief = ai_agent.draft_escalation(req, rule, similar, staff_note)
        db.update_request(request_id, status=db.AWAITING_OWNER, staff_note=staff_note, escalation=brief)
        flash("Sent to the owner. It won't count as approved until they respond.", "success")
        return redirect(url_for("view_request", request_id=request_id))

    @app.route("/requests/<int:request_id>/decide", methods=["POST"])
    @owner_required
    def decide(request_id):
        req = db.get_request(request_id)
        if req is None or req["status"] not in (db.AWAITING_OWNER, db.TO_OWNER):
            abort(400)
        decision = request.form.get("decision")
        status = {"approve": db.APPROVED, "reject": db.REJECTED, "modify": db.MODIFIED}.get(decision)
        if status is None:
            abort(400)
        comment = request.form.get("comment", "").strip()
        if decision == "modify" and not comment:
            flash("Say what should change.", "error")
            return redirect(url_for("view_request", request_id=request_id))
        db.update_request(request_id, status=status, owner_decision=decision, owner_comment=comment,
                          decided_by=g.user["name"], closed_at=db.now())

        if request.form.get("save_rule") and req["category"] in CATEGORIES and req["category"] != "other":
            staff_can = bool(request.form.get("staff_can_handle")) and decision != "reject"
            conditions = [{"q": k, "op": "==", "value": v} for k, v in req["answers"].items()]
            new_id = db.insert_rule(db.get_db(), {
                "category": req["category"],
                "title": request.form.get("rule_title") or f"From decision on request #{request_id}",
                "priority": db.next_top_priority(req["category"]),
                "conditions": conditions,
                "outcome": "green" if staff_can else "red",
                "requires_owner": not staff_can,
                "min_role": "admin",
                "procedure": comment,
                "note": comment or f"Owner decision on request #{request_id}",
                "source": f"Owner decision, request #{request_id}",
                "last_reviewed": date.today().isoformat(),
            })
            db.get_db().commit()
            flash(f"Decision saved and added as rule #{new_id}. Staff will see it next time.", "success")
        else:
            flash("Decision saved. Staff can see it on the request.", "success")
        return redirect(url_for("owner_home"))

    # ---- owner home --------------------------------------------------------

    @app.route("/owner")
    @owner_required
    def owner_home():
        waiting = db.list_requests(status=db.AWAITING_OWNER)
        handled = db.list_requests(status=db.RESOLVED)[:8]
        needs_info = db.list_requests(status=db.NEEDS_INFO)
        stale = [r for r in db.all_rules(active_only=True)
                 if r["outcome"] == "green" and _is_stale(r)]
        return render_template("owner.html", waiting=waiting, handled=handled,
                               needs_info=needs_info, stale=stale)

    # ---- decision log ------------------------------------------------------

    @app.route("/log")
    @login_required
    def decision_log():
        q = request.args.get("q", "").strip()
        category = request.args.get("category") or None
        colour = request.args.get("colour") or None
        rows = db.list_requests(search=q or None, category=category, colour=colour)
        return render_template("log.html", rows=rows, q=q, category=category, colour=colour)

    # ---- rules -------------------------------------------------------------

    @app.route("/rules")
    @login_required
    def rules():
        q = request.args.get("q", "").strip().lower()
        all_rules = db.all_rules()
        if q:
            all_rules = [r for r in all_rules
                         if q in (r["title"] + r["note"] + r["procedure"] + category_label(r["category"])).lower()]
        return render_template("rules.html", rules=all_rules, q=q, is_stale=_is_stale)

    @app.route("/rules/<int:rule_id>", methods=["GET", "POST"])
    @login_required
    def edit_rule(rule_id):
        rule = db.get_rule(rule_id)
        if rule is None:
            abort(404)
        if request.method == "POST":
            if g.user["role"] != "owner":
                abort(403)
            try:
                conditions = json.loads(request.form.get("conditions") or "[]")
                assert isinstance(conditions, list)
                for cond in conditions:
                    assert {"q", "op", "value"} <= set(cond)
            except (ValueError, AssertionError, TypeError):
                flash('Conditions must be a list like [{"q": "amount", "op": "<=", "value": 50}].', "error")
                return redirect(url_for("edit_rule", rule_id=rule_id))
            changes = {
                "title": request.form["title"].strip(),
                "priority": int(request.form.get("priority") or rule["priority"]),
                "conditions": conditions,
                "outcome": request.form["outcome"],
                "min_role": request.form["min_role"],
                "requires_owner": bool(request.form.get("requires_owner")),
                "procedure": request.form.get("procedure", "").strip(),
                "note": request.form.get("note", "").strip(),
                "source": request.form.get("source", "").strip(),
                "active": bool(request.form.get("active")),
                "last_reviewed": date.today().isoformat(),
            }
            db.update_rule(rule_id, changes, g.user["name"])
            flash("Rule updated. The old version is kept below.", "success")
            return redirect(url_for("edit_rule", rule_id=rule_id))
        questions = CATEGORIES.get(rule["category"], {}).get("questions", [])
        return render_template("rule_edit.html", rule=rule, history=db.rule_history(rule_id),
                               questions=questions, roles=list(ROLES), stale=_is_stale(rule))

    @app.route("/rules/<int:rule_id>/reviewed", methods=["POST"])
    @owner_required
    def mark_reviewed(rule_id):
        if db.get_rule(rule_id) is None:
            abort(404)
        db.update_rule(rule_id, {"last_reviewed": date.today().isoformat()}, g.user["name"])
        flash("Marked as reviewed today.", "success")
        return redirect(request.referrer or url_for("rules"))


def _is_stale(rule):
    return is_stale(rule)
