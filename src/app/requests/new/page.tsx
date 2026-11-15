import { redirect } from "next/navigation";

// New requests start from the Requests page, which also holds the saved list
export default function NewRequest() {
  redirect("/requests");
}
