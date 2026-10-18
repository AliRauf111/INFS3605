import Link from "next/link";
import { cookies } from "next/headers";
import { RECOVERY_COOKIE } from "@/lib/auth/cookies";
import { InfoPage } from "@/components/InfoPage";
import { ResetForm } from "./ResetForm";

export const metadata = { title: "Choose a new password" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  const ready = Boolean((await cookies()).get(RECOVERY_COOKIE)?.value);
  return (
    <InfoPage title="Choose a new password">
      {ready ? (
        <ResetForm />
      ) : (
        <p>
          This reset link has expired or was already used. <Link href="/login?mode=forgot">Ask for a new link</Link> and open it in this browser.
        </p>
      )}
    </InfoPage>
  );
}
