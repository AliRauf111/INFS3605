import { redirect } from "next/navigation";

// Rules now live in the Knowledge Hub
export default function RulesPage() {
  redirect("/knowledge#rules");
}
