import "server-only";
import { redirect } from "next/navigation";
import { getSessionUser, type SessionUser } from "./session";
import type { Role } from "@/lib/domain/types";

/** For server pages: send signed-out visitors to the login page. */
export async function requirePageUser(role?: Role): Promise<SessionUser> {
  const user = await getSessionUser().catch(() => null);
  if (!user) redirect("/login");
  if (role && user.role !== role) redirect("/?denied=1");
  return user;
}
