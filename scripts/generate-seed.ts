// Generates supabase/seed.sql and supabase/demo-history.sql from one source of truth.
// Run with: npm run seed:generate
//
// Seeded decisions are produced by the real decision engine, so the stored results are
// exactly what the app would have decided. Everything here is fictional.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_POLICIES } from "../src/lib/engine/default-policies";
import { evaluate } from "../src/lib/engine/evaluate";
import type { EvidenceSnapshot } from "../src/lib/engine/evidence";
import { hashDecisionInput } from "../src/lib/engine/hash";
import { policyVersionLabel, type PolicySnapshot } from "../src/lib/engine/policy";
import { mapBooking, mapPayment, type BookingRow, type PaymentRow } from "../src/lib/context/mappers";
import type { ConfirmedFacts } from "../src/lib/validation/facts";

const GENERATED_AT = new Date("2026-10-15T00:00:00.000Z");

// Fixed UUIDs keep the seed repeatable.
const POLICY_IDS: Record<string, string> = {
  refund: "00000000-0000-4000-8000-000000000101",
  lesson_change: "00000000-0000-4000-8000-000000000102",
  payment_extension: "00000000-0000-4000-8000-000000000103",
};

const families = [
  ["FAM-01", "Grace Nguyen", "Leo Nguyen"],
  ["FAM-02", "Daniel Okafor", "Amara Okafor"],
  ["FAM-03", "Mei Lin", "Jasper Lin"],
  ["FAM-04", "Hannah Patel", "Ravi Patel"],
  ["FAM-07", "Sophie Martin", "Ella and Noah Martin"],
];
const tutors = [
  ["T-01", "Priya Shah", ["Maths"]],
  ["T-02", "Tom Becker", ["English"]],
  ["T-03", "Aisha Rahman", ["Science"]],
] as const;

type B = Omit<BookingRow, "data_label" | "last_synced_at" | "families" | "tutors"> & { staleDays?: number };
const bookings: B[] = [
  { id: "BK-1042", family_id: "FAM-01", tutor_id: "T-01", subject: "Year 9 Maths", lessons_purchased: 10, lessons_used: 3, price_cents: 60000, status: "active" },
  { id: "BK-1043", family_id: "FAM-02", tutor_id: "T-02", subject: "Year 11 English", lessons_purchased: 8, lessons_used: 2, price_cents: 48000, status: "active" },
  { id: "BK-1044", family_id: "FAM-03", tutor_id: "T-03", subject: "Year 8 Science", lessons_purchased: 10, lessons_used: 4, price_cents: 55000, status: "active" },
  { id: "BK-1045", family_id: "FAM-04", tutor_id: "T-01", subject: "Year 12 Maths", lessons_purchased: 10, lessons_used: 6, price_cents: 70000, status: "active" },
  { id: "BK-1046", family_id: "FAM-07", tutor_id: "T-01", subject: "Year 5 Maths", lessons_purchased: 10, lessons_used: 1, price_cents: 40000, status: "active" },
  { id: "BK-1047", family_id: "FAM-07", tutor_id: "T-02", subject: "Year 7 English", lessons_purchased: 10, lessons_used: 2, price_cents: 40000, status: "active" },
];

type P = Omit<PaymentRow, "data_label" | "last_synced_at" | "paid_at" | "due_date"> & {
  paidDaysAgo: number | null; dueInDays: number | null; staleDays?: number; method: string; note: string;
};
const payments: P[] = [
  { id: "PAY-2001", booking_id: "BK-1042", invoice_ref: "INV-501", amount_cents: 60000, status: "paid", paidDaysAgo: 40, dueInDays: null, method: "Card", note: "Clean record: good for a green refund" },
  { id: "PAY-2002", booking_id: "BK-1043", invoice_ref: "INV-502", amount_cents: 48000, status: "paid", paidDaysAgo: 35, dueInDays: null, method: "Bank transfer", note: "Conflicts with PAY-2003" },
  { id: "PAY-2003", booking_id: "BK-1043", invoice_ref: "INV-502", amount_cents: 45000, status: "paid", paidDaysAgo: 34, dueInDays: null, method: "Card", note: "Same invoice, different amount: conflicting records" },
  { id: "PAY-2004", booking_id: "BK-1044", invoice_ref: "INV-503", amount_cents: 55000, status: "overdue", paidDaysAgo: null, dueInDays: -5, method: "Invoice", note: "Unpaid invoice: used for payment extensions" },
  { id: "PAY-2005", booking_id: "BK-1045", invoice_ref: "INV-504", amount_cents: 70000, status: "paid", paidDaysAgo: 120, dueInDays: null, staleDays: 120, method: "Card", note: "Not synced for 120 days: stale" },
  { id: "PAY-2006", booking_id: "BK-1046", invoice_ref: "INV-505", amount_cents: 40000, status: "paid", paidDaysAgo: 20, dueInDays: null, method: "Card", note: "" },
  { id: "PAY-2007", booking_id: "BK-1047", invoice_ref: "INV-506", amount_cents: 40000, status: "paid", paidDaysAgo: 20, dueInDays: null, method: "Card", note: "" },
];

// Times are relative to the day the seed runs, in Sydney time, so the demo always has
// upcoming slots.
const slots = [
  ["SLOT-3001", "T-01", 5, "16:00", "free"],
  ["SLOT-3002", "T-01", 6, "17:00", "booked"],
  ["SLOT-3003", "T-02", 7, "16:00", "free"],
  ["SLOT-3004", "T-03", 8, "15:30", "free"],
  ["SLOT-3005", "T-01", 9, "16:30", "free"],
] as const;

const articles = [
  ["KB-01", "Welfare Escalation Procedure", "welfare", true,
    "1. If a child may be in immediate danger, call 000 first.\n2. Write down only what you were told, in the words used, with the date and time.\n3. Do not investigate, question the child or contact the tutor about the concern.\n4. Send the restricted handover to the owner straight away and phone the owner.\n5. Share details only with the owner. Do not discuss it with other families or staff.\n(Fictional demonstration procedure. A real business must use its own child safe policy.)"],
  ["KB-02", "Refund Procedure", "refund", true,
    "Refunds are calculated on unused lessons. Under $50 the admin team may process the refund once the booking and payment are confirmed. From $50 to $200 the owner approves. Above $200 the owner decides personally. Never promise a refund before it is processed. (Fictional.)"],
  ["KB-03", "Rescheduling Procedure", "lesson_change", true,
    "A lesson can be moved without a fee when the same tutor is free at the new time and the family gives at least 24 hours notice. Any fee change needs the owner. (Fictional.)"],
  ["KB-04", "Complaints Handling", "complaint", true,
    "All complaints go to the owner. Acknowledge the message politely, do not admit fault or offer compensation, and tell the family the owner will be in touch. (Fictional.)"],
  ["KB-05", "Payment Extension Procedure", "payment_extension", true,
    "Admin may agree to extend an unpaid invoice by up to 7 days. Longer extensions need the owner. Extensions over 30 days are payment plans and are handled by the owner. (Fictional.)"],
] as const;

const q = (s: string | null) => (s === null ? "null" : `'${s.replace(/'/g, "''")}'`);
const j = (v: unknown) => `$json$${JSON.stringify(v)}$json$::jsonb`;

const policySnapshots: Record<string, PolicySnapshot> = Object.fromEntries(
  DEFAULT_POLICIES.map((def) => [
    def.category,
    { id: POLICY_IDS[def.category], category: def.category, version: 1, status: "active", definition: def },
  ]),
);

function bookingRecord(id: string) {
  const b = bookings.find((x) => x.id === id)!;
  const fam = families.find((f) => f[0] === b.family_id)!;
  const tutor = tutors.find((t) => t[0] === b.tutor_id)!;
  return mapBooking(
    { ...b, data_label: "fictional_demo", last_synced_at: GENERATED_AT.toISOString(), families: { student_name: fam[2] }, tutors: { name: tutor[1] } },
    GENERATED_AT,
  );
}
function paymentRecords(bookingId: string) {
  return payments
    .filter((p) => p.booking_id === bookingId)
    .map((p) =>
      mapPayment(
        {
          ...p,
          data_label: "fictional_demo",
          last_synced_at: new Date(GENERATED_AT.getTime() - (p.staleDays ?? 0) * 86400000).toISOString(),
          paid_at: p.paidDaysAgo === null ? null : new Date(GENERATED_AT.getTime() - p.paidDaysAgo * 86400000).toISOString(),
          due_date: null,
        },
        GENERATED_AT,
      ),
    );
}

type SeedRequest = {
  id: string;
  daysAgo: number;
  facts: ConfirmedFacts;
  evidence: EvidenceSnapshot;
  status: string;
  events: Array<{ type: string; role: string; to: string; from?: string; note: string; daysAgo: number }>;
};

const baseFacts: ConfirmedFacts = {
  requestType: "refund", moneyInvolved: "yes", amountCents: null, complaint: "no", welfare: "no",
  referenceId: null, bookingId: null, financialImpact: null, proposedSlotId: null, extensionDays: null, context: "",
};

function refundRequest(id: string, daysAgo: number, bookingId: string, cents: number, context: string, status: string, events: SeedRequest["events"], referenceId = bookingId): SeedRequest {
  const facts = { ...baseFacts, amountCents: cents, referenceId, bookingId, context };
  return {
    id, daysAgo, facts, status, events,
    evidence: {
      retrievedAt: GENERATED_AT.toISOString(),
      booking: { status: "found", record: bookingRecord(bookingId) },
      payments: { status: "checked", records: paymentRecords(bookingId) },
      availability: { status: "not_checked" },
    },
  };
}

const coreRequests: SeedRequest[] = [
  refundRequest("00000000-0000-4000-8000-000000000201", 3, "BK-1042", 3000,
    "Parent asked for a $30 refund for one lesson Leo missed because of a school excursion.", "ready",
    [{ type: "created", role: "system", to: "ready", note: "Seeded example request (fictional).", daysAgo: 3 }]),
  refundRequest("00000000-0000-4000-8000-000000000202", 2, "BK-1046", 7500,
    "Sophie Martin asked for $75 back after Ella's lessons moved to a time that no longer suits the family.", "awaiting_owner",
    [
      { type: "created", role: "system", to: "review_required", note: "Seeded example request (fictional).", daysAgo: 2 },
      { type: "sent_to_owner", role: "system", from: "review_required", to: "awaiting_owner", note: "Medium refund for Ella Martin (BK-1046). Family asked for $75 back after a timetable change. No complaint or welfare concern. Payment PAY-2006 of $400.00 is on record.", daysAgo: 2 },
    ], "FAM-07"),
  {
    id: "00000000-0000-4000-8000-000000000203",
    daysAgo: 1,
    facts: {
      ...baseFacts, requestType: "lesson_change", moneyInvolved: "no", welfare: "yes", complaint: "unsure",
      referenceId: "BK-1043", bookingId: "BK-1043", financialImpact: "no",
      context: "Parent asked to move Amara's lesson and mentioned Amara has seemed frightened after recent sessions.",
    },
    evidence: {
      retrievedAt: GENERATED_AT.toISOString(),
      booking: { status: "found", record: bookingRecord("BK-1043") },
      payments: { status: "not_checked" },
      availability: { status: "not_checked" },
    },
    status: "review_required",
    events: [{ type: "created", role: "system", to: "review_required", note: "Seeded example request (fictional).", daysAgo: 1 }],
  },
];

const historyRequests: SeedRequest[] = [
  refundRequest("00000000-0000-4000-8000-000000000301", 30, "BK-1042", 5500, "Refund for one long lesson cancelled by the family with notice.", "closed", [
    { type: "created", role: "system", to: "review_required", note: "Seeded history (fictional).", daysAgo: 30 },
    { type: "sent_to_owner", role: "system", from: "review_required", to: "awaiting_owner", note: "Refund of $55 for a cancelled lesson.", daysAgo: 30 },
    { type: "owner_approved", role: "owner", from: "awaiting_owner", to: "approved", note: "Approved: one lesson with notice, the family is in good standing.", daysAgo: 29 },
    { type: "closed", role: "admin", from: "approved", to: "closed", note: "Admin recorded: refund processed in the payment system.", daysAgo: 29 },
  ]),
  refundRequest("00000000-0000-4000-8000-000000000302", 21, "BK-1047", 6000, "Refund for a lesson missed during school camp.", "closed", [
    { type: "created", role: "system", to: "review_required", note: "Seeded history (fictional).", daysAgo: 21 },
    { type: "sent_to_owner", role: "system", from: "review_required", to: "awaiting_owner", note: "Refund of $60 for one missed lesson.", daysAgo: 21 },
    { type: "owner_approved", role: "owner", from: "awaiting_owner", to: "approved", note: "Approved: single missed lesson with a week's notice.", daysAgo: 20 },
    { type: "closed", role: "admin", from: "approved", to: "closed", note: "Admin recorded: refund processed in the payment system.", daysAgo: 20 },
  ]),
  refundRequest("00000000-0000-4000-8000-000000000303", 12, "BK-1046", 5800, "Refund for a lesson missed because of illness.", "approved", [
    { type: "created", role: "system", to: "review_required", note: "Seeded history (fictional).", daysAgo: 12 },
    { type: "sent_to_owner", role: "system", from: "review_required", to: "awaiting_owner", note: "Refund of $58 for an illness absence.", daysAgo: 12 },
    { type: "owner_approved", role: "owner", from: "awaiting_owner", to: "approved", note: "Approved: one lesson, illness, notice given.", daysAgo: 11 },
  ]),
  {
    id: "00000000-0000-4000-8000-000000000304",
    daysAgo: 6,
    facts: { ...baseFacts, requestType: "payment_extension", moneyInvolved: "yes", complaint: null, referenceId: "BK-1044", bookingId: "BK-1044", extensionDays: 10, context: "Parent asked for ten more days to pay the term invoice." },
    evidence: {
      retrievedAt: GENERATED_AT.toISOString(),
      booking: { status: "found", record: bookingRecord("BK-1044") },
      payments: { status: "checked", records: paymentRecords("BK-1044") },
      availability: { status: "not_checked" },
    },
    status: "",
    events: [{ type: "created", role: "system", to: "", note: "Seeded history (fictional).", daysAgo: 6 }],
  },
];

function requestSql(r: SeedRequest): string {
  const policy = r.facts.requestType === "other" ? null : policySnapshots[r.facts.requestType] ?? null;
  const result = evaluate({ facts: r.facts, evidence: r.evidence, policy });
  const status = r.status || result.suggestedStatus;
  const hash = hashDecisionInput({ facts: r.facts, evidence: r.evidence, policy, engine: result.engineVersion });
  const decisionId = r.id.replace("-8000-", "-9000-");
  const at = (d: number) => `now() - interval '${d} days'`;
  const lines = [
    `-- ${r.facts.requestType} ${result.colour}: ${result.matchedRuleId}`,
    `insert into public.requests (id, request_type, money_involved, amount_cents, complaint_status, welfare_status, reference_id, booking_id, context, confirmed_facts, decision, decision_reason, matched_rule_id, policy_version, policy_version_id, next_step, status, intake_method, created_at, updated_at) values (` +
      [q(r.id), q(r.facts.requestType), q(r.facts.moneyInvolved), r.facts.amountCents ?? "null", q(r.facts.complaint), q(r.facts.welfare),
        q(r.facts.referenceId), q(r.facts.bookingId), q(r.facts.context), j(r.facts), q(result.colour), q(result.explanation),
        q(result.matchedRuleId), q(result.policyVersion), q(result.policyVersionId), q(result.nextSteps[0] ?? ""), q(status), "'seed'",
        at(r.daysAgo), at(r.events.at(-1)!.daysAgo)].join(", ") + ");",
    `insert into public.decisions (id, request_id, sequence, colour, matched_rule_id, policy_version, policy_version_id, policy_snapshot, facts, result, input_hash, engine_version, reason, created_at) values (` +
      [q(decisionId), q(r.id), 1, q(result.colour), q(result.matchedRuleId), q(result.policyVersion), q(result.policyVersionId),
        policy ? j(policy) : "null", j(r.facts), j(result), q(hash), q(result.engineVersion), "'seed'", at(r.daysAgo)].join(", ") + ");",
    `insert into public.evidence_snapshots (decision_id, request_id, records, retrieved_at) values (${q(decisionId)}, ${q(r.id)}, ${j(r.evidence)}, ${q(r.evidence.retrievedAt)});`,
    `update public.requests set current_decision_id = ${q(decisionId)} where id = ${q(r.id)};`,
  ];
  for (const e of r.events) {
    lines.push(
      `insert into public.request_events (request_id, event_type, actor_role, from_status, to_status, note, created_at) values (${q(r.id)}, ${q(e.type)}, ${q(e.role)}, ${q(e.from ?? null)}, ${q(e.to || status)}, ${q(e.note)}, ${at(e.daysAgo)});`,
    );
  }
  return lines.join("\n");
}

const header = (title: string) =>
  `-- ${title}\n-- GENERATED by scripts/generate-seed.ts. Do not edit by hand: run \`npm run seed:generate\`.\n-- All people, bookings, payments and policies here are fictional.\n`;

const seed = [
  header("Tutor Compass seed data"),
  "begin;",
  "",
  "-- Knowledge hub: families, tutors, bookings, payments, availability and procedures",
  ...families.map(([id, parent, student]) => `insert into public.families (id, parent_name, student_name) values (${q(id)}, ${q(parent)}, ${q(student)});`),
  ...tutors.map(([id, name, subjects]) => `insert into public.tutors (id, name, subjects) values (${q(id)}, ${q(name)}, array[${subjects.map(q).join(", ")}]);`),
  ...bookings.map((b) => `insert into public.bookings (id, family_id, tutor_id, subject, lessons_purchased, lessons_used, price_cents, status, last_synced_at) values (${q(b.id)}, ${q(b.family_id)}, ${q(b.tutor_id)}, ${q(b.subject)}, ${b.lessons_purchased}, ${b.lessons_used}, ${b.price_cents}, ${q(b.status)}, now());`),
  ...payments.map((p) => `insert into public.payments (id, booking_id, invoice_ref, amount_cents, status, paid_at, due_date, method, last_synced_at) values (${q(p.id)}, ${q(p.booking_id)}, ${q(p.invoice_ref)}, ${p.amount_cents}, ${q(p.status)}, ${p.paidDaysAgo === null ? "null" : `now() - interval '${p.paidDaysAgo} days'`}, ${p.dueInDays === null ? "null" : `current_date + ${p.dueInDays}`}, ${q(p.method)}, now() - interval '${p.staleDays ?? 0} days'); -- ${p.note}`),
  ...slots.map(([id, tutor, days, time, status]) => `insert into public.tutor_availability (id, tutor_id, starts_at, ends_at, status) values (${q(id)}, ${q(tutor)}, ((current_date + ${days}) + time '${time}') at time zone 'Australia/Sydney', ((current_date + ${days}) + time '${time}' + interval '1 hour') at time zone 'Australia/Sydney', ${q(status)});`),
  ...articles.map(([id, title, category, approved, body]) => `insert into public.knowledge_articles (id, title, category, body, owner_approved) values (${q(id)}, ${q(title)}, ${q(category)}, ${q(body)}, ${approved});`),
  "",
  "-- Policies: version 1 of each, active, from the fictional demonstration rules",
  ...DEFAULT_POLICIES.map((def) =>
    [`-- policy:${def.category}`,
      `insert into public.policy_versions (id, category, version, status, definition, change_note, source, activated_at) values (${q(POLICY_IDS[def.category])}, ${q(def.category)}, 1, 'active', ${j(def)}, ${q(`Fictional demonstration rules (${policyVersionLabel({ category: def.category, version: 1 })}) until the owner validates them.`)}, 'seed', now());`].join("\n"),
  ),
  "",
  "-- Three fictional requests: one green, one amber, one red",
  ...coreRequests.map(requestSql),
  "",
  "commit;",
  "",
].join("\n");

const history = [
  header("Optional demo history for the coverage dashboard and rule suggestions"),
  "-- Run after seed.sql if you want a fuller dashboard. It adds four past requests.",
  "begin;",
  ...historyRequests.map(requestSql),
  "commit;",
  "",
].join("\n");

const root = path.join(__dirname, "..", "supabase");
writeFileSync(path.join(root, "seed.sql"), seed);
writeFileSync(path.join(root, "demo-history.sql"), history);
console.log("Wrote supabase/seed.sql and supabase/demo-history.sql");
