import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runSchedule } from "@/lib/briefing/server";

// The scheduled weekly briefing email. Vercel Cron calls this (see vercel.json) with
// "Authorization: Bearer <CRON_SECRET>". It runs on the server, so it doesn't need anyone's
// browser to be open. It is safe to call again: it sends only when a slot is due, and each
// slot goes to each recipient at most once.

export const dynamic = "force-dynamic";

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET?.trim()) return NextResponse.json({ error: "CRON_SECRET is not set, so scheduled briefings are off." }, { status: 503 });
  if (!authorised(req)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  try {
    const r = await runSchedule();
    return NextResponse.json({ due: r.due, slot: r.slot, status: r.outcome?.status ?? null });
  } catch (e) {
    console.error("[briefing cron] failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "The scheduled briefing failed. It will be tried again on the next run." }, { status: 500 });
  }
}
