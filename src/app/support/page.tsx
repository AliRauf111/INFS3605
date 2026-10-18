import Link from "next/link";
import { InfoPage } from "@/components/InfoPage";

export const metadata = { title: "Support" };

// There is no help desk behind Tutor Compass. Each business runs its own copy, so help
// comes from the owner who set it up. SUPPORT_EMAIL (optional, server only) adds a
// contact address when the business has one.

export default function SupportPage() {
  const email = process.env.SUPPORT_EMAIL?.trim();
  return (
    <InfoPage title="Get help with Tutor Compass">
      <section>
        <h2>Who to contact</h2>
        {email ? (
          <p>Email <a href={`mailto:${email}`}>{email}</a> and say which page you were on and what went wrong.</p>
        ) : (
          <p>The owner of your tutoring business manages Tutor Compass and everyone&apos;s accounts. Contact them directly for help.</p>
        )}
      </section>
      <section>
        <h2>Can&apos;t sign in?</h2>
        <ul>
          <li>Check the email address for typing mistakes. Passwords are case sensitive.</li>
          <li>Forgotten your password? Use <Link href="/login?mode=forgot">Forgot password</Link> to get a reset link by email.</li>
          <li>Just created an account? Confirm your email first. Then the owner needs to give you access in Approval Alley before you can sign in.</li>
          <li>Used Apple, Google or Microsoft? The owner still needs to give that account access the first time.</li>
        </ul>
      </section>
      <section>
        <h2>Something looks wrong with a request?</h2>
        <p>Open the request and use the full record at the bottom of the page. It shows the rule that was applied, the facts used and every change. Send the request number (for example BK-1042) to the owner.</p>
      </section>
    </InfoPage>
  );
}
