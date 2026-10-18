import { InfoPage } from "@/components/InfoPage";

export const metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <InfoPage title="Terms of use" updated="18 October 2026">
      <p>Tutor Compass is a student project built for a university course. It is provided as it is, and it may change.</p>
      <section>
        <h2>Who can use it</h2>
        <p>Only people the owner of the business has given access. Keep your password to yourself and sign out on shared computers.</p>
      </section>
      <section>
        <h2>What it does and doesn&apos;t do</h2>
        <ul>
          <li>It checks each request against the rules the owner has set and shows the reason for the outcome.</li>
          <li>It doesn&apos;t move money, issue refunds or change bookings. You still do those in your own systems, then record what you did.</li>
          <li>Compass AI can prepare drafts and suggestions. Check them before using them. The owner&apos;s rules decide the outcome, not the AI.</li>
        </ul>
      </section>
      <section>
        <h2>Safety and welfare</h2>
        <p>Safety and welfare concerns always go to the owner. If someone is in danger, contact emergency services first.</p>
      </section>
      <section>
        <h2>Not professional advice</h2>
        <p>Nothing in Tutor Compass is legal or financial advice. The owner stays responsible for the business&apos;s decisions.</p>
      </section>
    </InfoPage>
  );
}
