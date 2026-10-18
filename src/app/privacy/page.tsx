import { InfoPage } from "@/components/InfoPage";

export const metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <InfoPage title="Privacy" updated="18 October 2026">
      <p>
        Tutor Compass is a student project built for a university course. Each tutoring business that uses it runs its own copy, and that
        business decides what is stored and who can see it. This page explains what the app itself collects and why.
      </p>
      <section>
        <h2>What we store</h2>
        <ul>
          <li>Your account: your name, email address and whether you are an admin or the owner.</li>
          <li>Requests you enter, such as refunds, lesson changes and payment extensions, with the facts, the rule that was applied and the outcome.</li>
          <li>A history of who did what on each request, so decisions can be checked later.</li>
        </ul>
        <p>This is kept in the business&apos;s own Supabase database. The demonstration families, bookings and payments are fictional.</p>
      </section>
      <section>
        <h2>Cookies and your browser</h2>
        <p>
          Two cookies keep you signed in, and short-lived ones are used while you confirm an email or reset a password. Your browser&apos;s
          scripts can&apos;t read them. There are no advertising or tracking cookies. Your browser also keeps your Compass AI conversation for that tab
          only, and forgets it when the tab is closed.
        </p>
      </section>
      <section>
        <h2>Services that receive data</h2>
        <ul>
          <li>Supabase stores the database and handles sign-in.</li>
          <li>If the business turns on live AI, the text you give Compass AI or paste into a request is sent to Anthropic to read it. Without that setting, nothing is sent and the assistant runs in a labelled demo mode.</li>
          <li>If you sign in with Apple, Google or Microsoft, that company shares your name and email with the app.</li>
          <li>Voice input uses your browser&apos;s own speech recognition, which may send audio to the browser maker.</li>
        </ul>
      </section>
      <section>
        <h2>Your choices</h2>
        <p>Ask the owner of your business to correct your details or remove your account. Keep the information you enter to what a request needs, especially about students.</p>
      </section>
    </InfoPage>
  );
}
