import type { PolicyDefinition } from "./policy";

// Fictional demonstration rules from the project brief. They are seeded as version 1 of
// each policy (see supabase/seed.sql) and stay in use until the real owner validates
// or replaces them in the rule builder.

export const DEFAULT_REFUND_POLICY: PolicyDefinition = {
  category: "refund",
  title: "Refund policy (fictional demo)",
  requiredFacts: ["amount", "complaint", "welfare", "reference", "payment_record"],
  rules: [
    {
      id: "refund.under_50",
      label: "Small refund",
      range: { min: null, max: 5000, maxInclusive: false },
      financialImpact: null,
      colour: "green",
      permittedActions: ["prepare_parent_response", "prepare_admin_checklist"],
      nextSteps: [
        "Check the amount matches the unused lessons on the booking.",
        "Process the refund in the payment system, outside Tutor Compass.",
        "Send the parent response once the refund has actually been processed.",
        "Record what you did on this request.",
      ],
      escalation: "",
    },
    {
      id: "refund.50_to_200",
      label: "Medium refund",
      range: { min: 5000, max: 20000, maxInclusive: true },
      financialImpact: null,
      colour: "amber",
      permittedActions: ["prepare_parent_response", "prepare_escalation_summary", "send_to_owner"],
      nextSteps: [
        "Tell the family you are checking the request. Do not promise a refund.",
        "Send the escalation summary to the owner for approval.",
      ],
      escalation: "The owner approves refunds from $50 to $200.",
    },
    {
      id: "refund.over_200",
      label: "Large refund",
      range: { min: 20001, max: null, maxInclusive: true },
      financialImpact: null,
      colour: "red",
      permittedActions: ["prepare_escalation_summary", "send_to_owner"],
      nextSteps: [
        "Stop routine processing and do not promise a refund.",
        "Send the request to the owner with the booking and payment history.",
      ],
      escalation: "Refunds above $200 are decided by the owner only.",
    },
  ],
};

export const DEFAULT_LESSON_CHANGE_POLICY: PolicyDefinition = {
  category: "lesson_change",
  title: "Lesson change policy (fictional demo)",
  requiredFacts: ["complaint", "welfare", "reference", "financial_impact", "availability"],
  rules: [
    {
      id: "lesson_change.no_fee",
      label: "Reschedule with no fee change",
      range: null,
      financialImpact: "no",
      colour: "green",
      permittedActions: ["prepare_parent_response", "prepare_tutor_message", "prepare_reschedule_proposal"],
      nextSteps: [
        "Offer the family the confirmed free time slot.",
        "Once the family agrees, update the booking system outside Tutor Compass.",
        "Send the tutor message and record what you did here.",
      ],
      escalation: "",
    },
    {
      id: "lesson_change.fee_impact",
      label: "Change that affects fees",
      range: null,
      financialImpact: "yes",
      colour: "amber",
      permittedActions: ["prepare_parent_response", "prepare_escalation_summary", "send_to_owner"],
      nextSteps: ["Check with the owner before agreeing to any fee change."],
      escalation: "The owner approves any change to fees.",
    },
  ],
};

export const DEFAULT_PAYMENT_EXTENSION_POLICY: PolicyDefinition = {
  category: "payment_extension",
  title: "Payment extension policy (fictional demo)",
  requiredFacts: ["complaint", "welfare", "reference", "extension_days", "outstanding_invoice"],
  rules: [
    {
      id: "payment_extension.up_to_7",
      label: "Short extension",
      range: { min: null, max: 7, maxInclusive: true },
      financialImpact: null,
      colour: "green",
      permittedActions: ["prepare_parent_response", "prepare_admin_checklist"],
      nextSteps: [
        "Confirm the new due date with the family in writing.",
        "Update the due date in the invoicing system, outside Tutor Compass.",
        "Record what you did here.",
      ],
      escalation: "",
    },
    {
      id: "payment_extension.8_to_30",
      label: "Longer extension",
      range: { min: 8, max: 30, maxInclusive: true },
      financialImpact: null,
      colour: "amber",
      permittedActions: ["prepare_parent_response", "prepare_escalation_summary", "send_to_owner"],
      nextSteps: ["Tell the family you are checking.", "Send the request to the owner."],
      escalation: "The owner approves extensions from 8 to 30 days.",
    },
    {
      id: "payment_extension.over_30",
      label: "Payment plan territory",
      range: { min: 31, max: null, maxInclusive: true },
      financialImpact: null,
      colour: "red",
      permittedActions: ["prepare_escalation_summary", "send_to_owner"],
      nextSteps: ["Do not agree to anything.", "Send the request to the owner, who handles payment plans personally."],
      escalation: "Extensions over 30 days are treated as payment plans and handled by the owner.",
    },
  ],
};

export const DEFAULT_POLICIES = [DEFAULT_REFUND_POLICY, DEFAULT_LESSON_CHANGE_POLICY, DEFAULT_PAYMENT_EXTENSION_POLICY];
