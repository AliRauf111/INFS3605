import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card">
      <h1>Not found</h1>
      <p>That page or record does not exist. <Link href="/">Go to the dashboard</Link>.</p>
    </div>
  );
}
