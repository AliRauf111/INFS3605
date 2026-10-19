"use client";
import { PageHeader } from "@/components/PageHeader";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="stack">
      <PageHeader><h1>Something went wrong</h1></PageHeader>
      <div className="notice error" role="alert">
        <p>The page could not be shown. Nothing has been changed by this error.</p>
        <button className="btn" type="button" onClick={reset}>Try again</button>
      </div>
    </div>
  );
}
