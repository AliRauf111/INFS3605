"""Sample users, rules and past decisions for a small tutoring company.

These are made up but based on what came out of our owner interview and
research (exam booklets, refunds, tutor swaps, payments, complaints). Replace
them with the real business's rules before using the app for real.
"""

from datetime import date, timedelta

from .db import (APPROVED, REJECTED, RESOLVED, insert_request, insert_rule)

RECENT = (date.today() - timedelta(days=30)).isoformat()
OLD = (date.today() - timedelta(days=400)).isoformat()


def c(q, op, value):
    return {"q": q, "op": op, "value": value}


USERS = [
    ("Sarah", "admin"),
    ("Tom", "tutor"),
    ("Alex", "owner"),
]

RULES = [
    # Refunds
    dict(category="refund", priority=10, title="Refund linked to a tutor complaint",
         conditions=[c("reason", "==", "Unhappy with tutor")], outcome="red", requires_owner=True,
         note="Refunds tied to unhappiness with a tutor are really complaints. The owner handles these personally.",
         source="Owner interview, week 3", last_reviewed=RECENT),
    dict(category="refund", priority=20, title="Small refund early in the term",
         conditions=[c("amount", "<=", 50), c("lessons_used", "<=", 2), c("within_term", "==", True)],
         outcome="green", min_role="admin",
         procedure="Confirm the amount against the invoice in the billing system.\n"
                   "Process the refund to the original payment method.\n"
                   "Email the parent using the 'Refund confirmed' template.\n"
                   "Record the refund below.",
         note="Refunds of $50 or less in the first two lessons of the current term can be approved by the admin team.",
         source="Refund policy v2", last_reviewed=RECENT),
    dict(category="refund", priority=30, title="Larger refund",
         conditions=[c("amount", ">", 50)], outcome="red", requires_owner=True,
         note="Refunds over $50 need the owner's approval.", source="Refund policy v2", last_reviewed=RECENT),
    dict(category="refund", priority=40, title="Most of the package already used",
         conditions=[c("lessons_used", ">", 2)], outcome="red", requires_owner=True,
         note="Once more than two lessons are used, the owner decides whether any refund is fair.",
         source="Refund policy v2", last_reviewed=RECENT),

    # Discounts
    dict(category="discount", priority=10, title="Discount above 10%",
         conditions=[c("percent", ">", 10)], outcome="red", requires_owner=True,
         note="Anything above 10% affects pricing, which is the owner's call.", source="Pricing sheet",
         last_reviewed=RECENT),
    dict(category="discount", priority=20, title="Sibling discount up to 10%",
         conditions=[c("sibling", "==", True), c("percent", "<=", 10)], outcome="green", min_role="admin",
         procedure="Check the sibling is currently enrolled.\nApply the sibling discount code in billing.\n"
                   "Let the parent know it starts from the next invoice.",
         note="Standard sibling discount.", source="Pricing sheet",
         # Deliberately old so the demo shows the 'out of date' check.
         last_reviewed=OLD),
    dict(category="discount", priority=30, title="One-off goodwill discount",
         conditions=[c("sibling", "==", False), c("percent", "<=", 10), c("first_request", "==", True)],
         outcome="amber", min_role="admin",
         note="Check the owner's current promotions list before offering this. If it isn't listed, send it to the owner.",
         source="Pricing sheet", last_reviewed=RECENT),

    # Tutor changes
    dict(category="tutor_change", priority=10, title="Change because of a complaint",
         conditions=[c("reason", "==", "Complaint about tutor")], outcome="red", requires_owner=True,
         note="A complaint about a tutor needs the owner to speak to the tutor and the family.",
         source="Owner interview, week 3", last_reviewed=RECENT),
    dict(category="tutor_change", priority=20, title="Routine tutor swap with a replacement ready",
         conditions=[c("replacement_available", "==", True), c("same_level", "==", True),
                     c("reason", "in", ["Personality fit", "Schedule", "Tutor leaving"])],
         outcome="green", min_role="admin",
         procedure="Confirm the new time and tutor with the parent.\nUpdate the timetable.\n"
                   "Let both tutors know and pass on the student's notes.\nRecord the change below.",
         note="Admin can swap tutors when a suitable replacement is free.", source="Scheduling procedure",
         last_reviewed=RECENT),
    dict(category="tutor_change", priority=30, title="No suitable replacement",
         conditions=[c("replacement_available", "==", False)], outcome="amber", min_role="admin",
         note="Check the casual roster and waitlist first. If no one fits within a week, send it to the owner.",
         source="Scheduling procedure", last_reviewed=RECENT),

    # Cancellations
    dict(category="cancellation", priority=10, title="Tutor cancels, make-up slot free",
         conditions=[c("who_cancelled", "==", "Tutor"), c("makeup_available", "==", True)],
         outcome="green", min_role="admin",
         procedure="Book the make-up lesson.\nTell the parent the new time.\nRecord it below.",
         source="Cancellation policy", last_reviewed=RECENT),
    dict(category="cancellation", priority=20, title="Tutor cancels, no make-up slot",
         conditions=[c("who_cancelled", "==", "Tutor"), c("makeup_available", "==", False)],
         outcome="amber", min_role="admin",
         note="Look for a cover tutor at the same time. If none, offer a credit and tell the owner.",
         source="Cancellation policy", last_reviewed=RECENT),
    dict(category="cancellation", priority=30, title="Student cancels with 24 hours' notice",
         conditions=[c("who_cancelled", "==", "Student"), c("notice_hours", ">=", 24)],
         outcome="green", min_role="tutor",
         procedure="Offer a make-up slot if one is free.\nUpdate attendance.\nRecord it below.",
         source="Cancellation policy", last_reviewed=RECENT),
    dict(category="cancellation", priority=40, title="Student cancels late",
         conditions=[c("who_cancelled", "==", "Student"), c("notice_hours", "<", 24)],
         outcome="green", min_role="admin",
         procedure="The lesson is charged as normal under the cancellation policy.\n"
                   "Let the parent know politely and send the policy link.\n"
                   "If they ask for the fee to be waived, send that to the owner.",
         source="Cancellation policy", last_reviewed=RECENT),

    # Exam booklets
    dict(category="exam_booklet", priority=10, title="Booklet and bubble sheet returned, fees paid",
         conditions=[c("has_both", "==", True), c("fees_paid", "==", True)], outcome="green", min_role="tutor",
         procedure="Hand back the marked booklet with the results sheet.\nTick it off on the term exam list.",
         source="Owner interview, week 2", last_reviewed=RECENT),
    dict(category="exam_booklet", priority=20, title="Missing booklet or bubble sheet",
         conditions=[c("has_both", "==", False)], outcome="amber", min_role="tutor",
         note="Parents need to return both the booklet and the bubble sheet before results are released.",
         source="Owner interview, week 2", last_reviewed=RECENT),
    dict(category="exam_booklet", priority=30, title="Fees outstanding",
         conditions=[c("has_both", "==", True), c("fees_paid", "==", False)], outcome="amber", min_role="admin",
         note="Check payment status with the admin team before releasing results.",
         source="Owner interview, week 2", last_reviewed=RECENT),

    # Enrolments
    dict(category="enrolment", priority=10, title="Student with additional needs",
         conditions=[c("extra_needs", "==", True)], outcome="red", requires_owner=True,
         note="The owner meets families where a child has extra learning, health or welfare needs.",
         source="Child safety policy", last_reviewed=RECENT),
    dict(category="enrolment", priority=20, title="New subject or year level",
         conditions=[c("subject_offered", "==", False)], outcome="red", requires_owner=True,
         note="Expanding into a new subject is the owner's decision.", source="Owner interview, week 3",
         last_reviewed=RECENT),
    dict(category="enrolment", priority=30, title="Standard enrolment with space",
         conditions=[c("subject_offered", "==", True), c("class_has_space", "==", True)],
         outcome="green", min_role="admin",
         procedure="Send the enrolment form and price list.\nBook a trial lesson.\nAdd the student to the CRM.",
         source="Enrolment procedure", last_reviewed=RECENT),
    dict(category="enrolment", priority=40, title="Class full",
         conditions=[c("subject_offered", "==", True), c("class_has_space", "==", False)],
         outcome="amber", min_role="admin",
         note="Offer the waitlist or another time. Tell the owner if the waitlist is over five students.",
         source="Enrolment procedure", last_reviewed=RECENT),

    # Payments
    dict(category="payment", priority=10, title="Payment plan or extension requested",
         conditions=[c("plan_requested", "==", True)], outcome="red", requires_owner=True,
         note="Payment arrangements are sensitive. Parents expect a senior person to handle them.",
         source="Owner interview, week 3", last_reviewed=RECENT),
    dict(category="payment", priority=20, title="Recently overdue",
         conditions=[c("plan_requested", "==", False), c("days_overdue", "<=", 14)],
         outcome="green", min_role="admin",
         procedure="Send the standard friendly reminder email.\nSet a follow-up for 7 days.",
         source="Billing procedure", last_reviewed=RECENT),
    dict(category="payment", priority=30, title="Overdue more than two weeks",
         conditions=[c("plan_requested", "==", False), c("days_overdue", ">", 14)],
         outcome="red", requires_owner=True,
         note="The owner decides whether to pause lessons or call the family.", source="Billing procedure",
         last_reviewed=RECENT),
]


def days_ago(n):
    return (date.today() - timedelta(days=n)).isoformat() + " 10:00"


PAST_REQUESTS = [
    dict(created_by="Sarah", created_role="admin", category="refund",
         description="Parent asked for a refund after one lesson because the family is moving to Brisbane",
         answers={"amount": 45.0, "lessons_used": 1.0, "reason": "Moving away", "within_term": True},
         colour="green", headline="Go ahead", status=RESOLVED,
         action_taken="Refunded $45 to card and sent the confirmation template", outcome="Parent thanked us, closed",
         created_at=days_ago(40), closed_at=days_ago(40)),
    dict(created_by="Sarah", created_role="admin", category="refund",
         description="Refund request for remaining 6 lessons, student broke their arm",
         answers={"amount": 240.0, "lessons_used": 4.0, "reason": "Illness or injury", "within_term": True},
         colour="red", headline="Owner approval needed", status=APPROVED,
         owner_decision="approved", owner_comment="Full refund for unused lessons. Injuries are fair enough.",
         decided_by="Alex", outcome="Refund processed", created_at=days_ago(35), closed_at=days_ago(34)),
    dict(created_by="Sarah", created_role="admin", category="refund",
         description="Parent wants refund for the term because of a schedule clash with sport",
         answers={"amount": 300.0, "lessons_used": 5.0, "reason": "Schedule clash", "within_term": True},
         colour="red", headline="Owner approval needed", status=REJECTED,
         owner_decision="rejected", owner_comment="Offer a different time slot or a credit instead. No cash refund for clashes.",
         decided_by="Alex", outcome="Parent took a Saturday slot", created_at=days_ago(60), closed_at=days_ago(59)),
    dict(created_by="Sarah", created_role="admin", category="tutor_change",
         description="Parent asked to swap tutor for Year 10 maths because of a schedule change",
         answers={"reason": "Schedule", "replacement_available": True, "same_level": True},
         colour="green", headline="Go ahead", status=RESOLVED,
         action_taken="Moved student to Priya's Thursday class and updated the timetable",
         outcome="Parent confirmed", created_at=days_ago(20), closed_at=days_ago(20)),
    dict(created_by="Tom", created_role="tutor", category="exam_booklet",
         description="Parent asking for the end of term exam booklet back but forgot the bubble sheet",
         answers={"has_both": False, "fees_paid": True},
         colour="amber", headline="Check first", status=RESOLVED,
         action_taken="Asked the parent to bring the bubble sheet next week", outcome="Returned and released the following week",
         created_at=days_ago(15), closed_at=days_ago(8)),
    dict(created_by="Sarah", created_role="admin", category="discount",
         description="Family with two kids enrolled asked for the sibling discount",
         answers={"percent": 10.0, "sibling": True, "first_request": True},
         colour="green", headline="Go ahead", status=RESOLVED,
         action_taken="Applied SIB10 code in billing", outcome="Applied from next invoice",
         created_at=days_ago(90), closed_at=days_ago(90)),
    dict(created_by="Sarah", created_role="admin", category="discount",
         description="Parent asked for 20% off because a competitor is cheaper",
         answers={"percent": 20.0, "sibling": False, "first_request": True},
         colour="red", headline="Owner approval needed", status=REJECTED,
         owner_decision="rejected", owner_comment="We don't price match. Offer a free trial lesson instead.",
         decided_by="Alex", outcome="Parent accepted the trial", created_at=days_ago(50), closed_at=days_ago(49)),
    dict(created_by="Sarah", created_role="admin", category="payment",
         description="Invoice 10 days overdue, no reply to first email",
         answers={"days_overdue": 10.0, "amount": 380.0, "plan_requested": False},
         colour="green", headline="Go ahead", status=RESOLVED,
         action_taken="Sent the friendly reminder", outcome="Paid two days later",
         created_at=days_ago(25), closed_at=days_ago(23)),
    dict(created_by="Sarah", created_role="admin", category="payment",
         description="Parent lost their job and asked to pay the term fees over two months",
         answers={"days_overdue": 5.0, "amount": 760.0, "plan_requested": True},
         colour="red", headline="Owner approval needed", status=APPROVED,
         owner_decision="approved", owner_comment="Yes, split into four fortnightly payments. Keep it private.",
         decided_by="Alex", outcome="Plan set up in billing", created_at=days_ago(18), closed_at=days_ago(17)),
    dict(created_by="Sarah", created_role="admin", category="enrolment",
         description="New Year 8 English student, class has space, trial requested",
         answers={"subject_offered": True, "class_has_space": True, "extra_needs": False},
         colour="green", headline="Go ahead", status=RESOLVED,
         action_taken="Booked trial for Tuesday and sent enrolment form", outcome="Enrolled after trial",
         created_at=days_ago(12), closed_at=days_ago(10)),
    dict(created_by="Sarah", created_role="admin", category="cancellation",
         description="Tutor sick on Wednesday, make-up slot available on Friday",
         answers={"who_cancelled": "Tutor", "notice_hours": 12.0, "makeup_available": True},
         colour="green", headline="Go ahead", status=RESOLVED,
         action_taken="Booked Friday make-up and texted parents", outcome="All three students attended",
         created_at=days_ago(5), closed_at=days_ago(5)),
]


def seed(db):
    db.executemany("INSERT INTO users (name, role) VALUES (?, ?)", USERS)
    for rule in RULES:
        insert_rule(db, rule)
    for req in PAST_REQUESTS:
        insert_request(db, req)
