import { redirect } from "next/navigation";

// Rules now live in the Knowledge hub
export default function RulesPage() {
  redirect("/knowledge#rules");
}
