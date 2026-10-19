import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";

export default function NotFound() {
  return (
    <div className="stack">
      <PageHeader><h1>Not found</h1></PageHeader>
      <div className="card">
        <p>That page or record does not exist. <Link href="/">Go to the dashboard</Link>.</p>
      </div>
    </div>
  );
}
