"use client";
import type { PolicyDefinition } from "@/lib/engine/policy";
import { TestArea } from "../RulesClient";

export function ReadOnlyTest({ definition }: { definition: PolicyDefinition }) {
  return <TestArea definition={() => definition} />;
}
