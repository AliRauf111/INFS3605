import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiRoute } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { startScan } from "@/lib/payments/server";

// Runs the whole five-step accounting scan from one click. The reply is a stream of
// JSON lines, one per step change and log line, then the final result, so the page can
// show each check as pending, running, completed or failed while it happens.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = apiRoute(async (_req: NextRequest) => {
  const user = await requireUser();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(enc.encode(`${JSON.stringify(obj)}\n`));
      try {
        const { runId, result } = await startScan(user, (e) => send(e));
        send({ type: "done", runId, status: result.status, summary: result.summary });
      } catch (e) {
        console.error("[payments] scan failed", e instanceof Error ? e.message : e);
        send({ type: "error", message: e instanceof Error && !(e instanceof ApiError) ? "The scan couldn't finish. Check the Payments tables are set up, then try again." : String(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new NextResponse(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
});
