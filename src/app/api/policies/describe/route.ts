import { apiRoute, readJson } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { describeRule } from "@/lib/actions/policies";

export const POST = apiRoute(async (req) => describeRule(await requireUser("owner"), await readJson(req)));
