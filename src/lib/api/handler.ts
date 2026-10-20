import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { AuthError } from "@/lib/auth/session";
import { ConfigError, DbError } from "@/lib/db/supabase";

// Shared wrapper for API routes: checks the request came from our own pages, reads
// JSON safely and turns known errors into clear responses. It never sends stack traces
// or secrets back to the browser.

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

const DB_STATUS: Record<DbError["code"], number> = {
  forbidden: 403,
  not_found: 404,
  invalid_transition: 409,
  stale_update: 409,
  reason_required: 400,
  invalid_input: 400,
  policy_frozen: 409,
  missing_details: 409,
  unknown: 500,
};

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError(400, "The request body must be valid JSON.");
  }
}

type Ctx<P> = { params: Promise<P> };

export function apiRoute<P = Record<string, never>>(handler: (req: NextRequest, ctx: Ctx<P>) => Promise<unknown>) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      if (req.method !== "GET" && !sameOrigin(req)) {
        throw new ApiError(403, "Requests must come from the Tutor Compass app.");
      }
      const body = await handler(req, ctx);
      if (body instanceof NextResponse) return body; // routes that also set cookies
      return NextResponse.json(body ?? { ok: true });
    } catch (error) {
      if (error instanceof ApiError) return NextResponse.json({ error: error.message, details: error.details }, { status: error.status });
      if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
      if (error instanceof DbError) return NextResponse.json({ error: error.message }, { status: DB_STATUS[error.code] });
      if (error instanceof ConfigError) return NextResponse.json({ error: "The server is not configured yet. See README.md." }, { status: 503 });
      console.error("[api] unexpected error", error instanceof Error ? error.message : error);
      return NextResponse.json({ error: "Something went wrong on the server. Check the request log before trying again." }, { status: 500 });
    }
  };
}
