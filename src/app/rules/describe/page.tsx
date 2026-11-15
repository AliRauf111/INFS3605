import { requirePageUser } from "@/lib/auth/page";
import { DescribeRule } from "../RulesClient";
import { PageHeader } from "@/components/PageHeader";

export const metadata = { title: "Describe a rule" };

export default async function DescribePage() {
  await requirePageUser("owner");
  return (
    <div className="stack">
      <PageHeader><h1>Describe a rule</h1></PageHeader>
      <ol>
        <li>Write the rule in plain English.</li>
        <li>Tutor Compass proposes a structured draft and lists unclear wording and boundary cases.</li>
        <li>You edit and test the draft.</li>
        <li>You activate it. Nothing becomes active without your explicit action.</li>
      </ol>
      <DescribeRule />
    </div>
  );
}
