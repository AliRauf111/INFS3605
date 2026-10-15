"""Request types and wizard questions.

Each request type has a short list of questions. The answers are what the
rules engine checks against the owner's rules. Question ids are used as keys
in rule conditions, so keep them stable once rules exist.

Question types:
    yesno  - stored as True / False
    number - stored as a float
    choice - stored as one of the listed options
"""

ROLES = {"tutor": 1, "admin": 2, "owner": 3}
ROLE_LABELS = {"tutor": "Tutor", "admin": "Admin team", "owner": "Owner"}

CATEGORIES = {
    "refund": {
        "label": "Refund request",
        "keywords": ["refund", "money back", "reimburse", "pay back"],
        "questions": [
            {"id": "amount", "text": "How much is the parent asking to get back ($)?", "type": "number"},
            {"id": "lessons_used", "text": "How many lessons from the package has the student already attended?", "type": "number"},
            {"id": "reason", "text": "What is the main reason?", "type": "choice",
             "options": ["Illness or injury", "Moving away", "Schedule clash", "Unhappy with tutor", "Other"]},
            {"id": "within_term", "text": "Is the request for the current term?", "type": "yesno"},
        ],
    },
    "discount": {
        "label": "Discount request",
        "keywords": ["discount", "cheaper", "price match", "sibling", "deal"],
        "questions": [
            {"id": "percent", "text": "What discount is being asked for (%)?", "type": "number"},
            {"id": "sibling", "text": "Does the family have another child enrolled with us?", "type": "yesno"},
            {"id": "first_request", "text": "Is this the family's first discount request?", "type": "yesno"},
        ],
    },
    "tutor_change": {
        "label": "Change of tutor",
        "keywords": ["change tutor", "swap tutor", "new tutor", "different tutor", "switch tutor"],
        "questions": [
            {"id": "reason", "text": "Why is the change needed?", "type": "choice",
             "options": ["Personality fit", "Schedule", "Tutor leaving", "Complaint about tutor"]},
            {"id": "replacement_available", "text": "Is a suitable replacement tutor free at the same time?", "type": "yesno"},
            {"id": "same_level", "text": "Does the replacement teach the same subject and year level?", "type": "yesno"},
        ],
    },
    "cancellation": {
        "label": "Lesson cancellation or reschedule",
        "keywords": ["cancel", "reschedule", "can't make", "cannot make", "sick", "move the lesson", "skip"],
        "questions": [
            {"id": "who_cancelled", "text": "Who is cancelling?", "type": "choice", "options": ["Student", "Tutor"]},
            {"id": "notice_hours", "text": "How many hours' notice was given?", "type": "number"},
            {"id": "makeup_available", "text": "Is there a make-up slot available this week or next?", "type": "yesno"},
        ],
    },
    "exam_booklet": {
        "label": "End of term exam booklet",
        "keywords": ["exam booklet", "bubble sheet", "booklet", "exam paper", "test paper"],
        "questions": [
            {"id": "has_both", "text": "Has the parent returned both the exam booklet and the bubble sheet?", "type": "yesno"},
            {"id": "fees_paid", "text": "Are this term's fees fully paid?", "type": "yesno"},
        ],
    },
    "enrolment": {
        "label": "New student enrolment",
        "keywords": ["enrol", "enroll", "new student", "sign up", "join", "trial"],
        "questions": [
            {"id": "subject_offered", "text": "Do we already teach this subject and year level?", "type": "yesno"},
            {"id": "class_has_space", "text": "Is there space in a suitable class or tutor's timetable?", "type": "yesno"},
            {"id": "extra_needs", "text": "Has the parent mentioned additional learning, health or welfare needs?", "type": "yesno"},
        ],
    },
    "payment": {
        "label": "Overdue payment",
        "keywords": ["invoice", "overdue", "unpaid", "late payment", "payment plan", "hasn't paid"],
        "questions": [
            {"id": "days_overdue", "text": "How many days overdue is the invoice?", "type": "number"},
            {"id": "amount", "text": "How much is owed ($)?", "type": "number"},
            {"id": "plan_requested", "text": "Has the family asked for a payment plan or extension?", "type": "yesno"},
        ],
    },
    "complaint": {
        "label": "Parent complaint",
        "keywords": ["complain", "complaint", "unhappy", "angry", "upset", "not happy", "disappointed"],
        # Complaints always go to the owner. Our research found parents expect
        # a senior person to handle these, so no rule can make them green.
        "owner_only": True,
        "questions": [
            {"id": "about", "text": "What is the complaint mainly about?", "type": "choice",
             "options": ["A tutor", "Teaching quality", "Billing", "Safety or welfare", "Other"]},
        ],
    },
    "other": {
        "label": "Something else",
        "keywords": [],
        "questions": [],
    },
}


def category_label(category_id):
    cat = CATEGORIES.get(category_id)
    return cat["label"] if cat else "Unknown"


def get_question(category_id, question_id):
    for q in CATEGORIES.get(category_id, {}).get("questions", []):
        if q["id"] == question_id:
            return q
    return None


def coerce_answer(question, raw):
    """Turn a form or AI value into the right Python type. Returns None if blank or invalid."""
    if raw is None:
        return None
    if isinstance(raw, str):
        raw = raw.strip()
        if raw == "":
            return None
    qtype = question["type"]
    if qtype == "yesno":
        if isinstance(raw, bool):
            return raw
        text = str(raw).lower()
        if text in ("yes", "true", "y", "1"):
            return True
        if text in ("no", "false", "n", "0"):
            return False
        return None
    if qtype == "number":
        try:
            return float(str(raw).replace("$", "").replace(",", "").replace("%", ""))
        except ValueError:
            return None
    if qtype == "choice":
        for option in question["options"]:
            if str(raw).lower() == option.lower():
                return option
        return None
    return None


def format_answer(value):
    if value is True:
        return "Yes"
    if value is False:
        return "No"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return "" if value is None else str(value)
