import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

// The only place the app talks to the AI provider. It runs on the server, reads the key
// from an environment variable and never sends the key or the response to the browser
// unchecked. If there is no key, or a call fails, callers fall back to simulated mode.

export const DEFAULT_MODEL = "claude-opus-5-5";

export type AiMode = "live_ai" | "simulated";

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function aiModel(): string {
  return process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: 45_000, // milliseconds
    maxRetries: 1,
  });
  return client;
}

export type AiCheck = { configured: boolean; available: boolean; model: string; detail: string };

let lastCheck: { at: number; result: AiCheck } | null = null;

/**
 * Check that the key works and the configured model exists, without sending any of our
 * data. The answer is kept for ten minutes so the health page doesn't call out each time.
 */
export async function checkAi(): Promise<AiCheck> {
  const model = aiModel();
  if (!aiConfigured()) return { configured: false, available: false, model, detail: "No ANTHROPIC_API_KEY is set, so Compass runs in demo mode." };
  if (lastCheck && Date.now() - lastCheck.at < 600_000 && lastCheck.result.model === model) return lastCheck.result;
  let result: AiCheck;
  try {
    const info = await getClient().models.retrieve(model);
    result = { configured: true, available: true, model: info.id, detail: "The key works and the model is available." };
  } catch (error) {
    const detail = error instanceof Anthropic.AuthenticationError
      ? "The AI key was rejected."
      : error instanceof Anthropic.NotFoundError
        ? `The model ${model} isn't available to this key. Check ANTHROPIC_MODEL.`
        : error instanceof Anthropic.APIConnectionError
          ? "Could not reach the AI service."
          : error instanceof Anthropic.APIError
            ? `The AI service returned an error (${error.status}).`
            : "The AI check failed unexpectedly.";
    result = { configured: true, available: false, model, detail };
  }
  lastCheck = { at: Date.now(), result };
  return result;
}

export type AiCallResult<T> =
  | { ok: true; data: T; model: string }
  | { ok: false; reason: string };

/**
 * Ask the model for JSON that matches a schema. The SDK checks the response against
 * the schema; we check it again with zod before anything else uses it.
 */
export async function callStructured<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<AiCallResult<z.infer<S>>> {
  if (!aiConfigured()) return { ok: false, reason: "No AI key is configured." };
  try {
    const response = await getClient().beta.messages.parse({
      model: aiModel(),
      max_tokens: opts.maxTokens ?? 4000,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
      output_config: { effort: "low", format: betaZodOutputFormat(opts.schema) },
      // If the main model declines for policy reasons, the API retries on a fallback.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason === "refusal") return { ok: false, reason: "The AI declined this request." };
    if (response.stop_reason === "max_tokens") return { ok: false, reason: "The AI response was cut off." };
    const checked = opts.schema.safeParse(response.parsed_output);
    if (!checked.success) return { ok: false, reason: "The AI response did not match the expected format." };
    return { ok: true, data: checked.data, model: response.model };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return { ok: false, reason: "The AI key was rejected." };
    if (error instanceof Anthropic.RateLimitError) return { ok: false, reason: "The AI service is busy. Try again shortly." };
    if (error instanceof Anthropic.APIConnectionError) return { ok: false, reason: "Could not reach the AI service." };
    if (error instanceof Anthropic.APIError) return { ok: false, reason: `The AI service returned an error (${error.status}).` };
    return { ok: false, reason: "The AI call failed unexpectedly." };
  }
}

/** Remove contact details before text leaves our server. */
export function redactForAi(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email removed]")
    .replace(/(?:\+?61|0)[\s-]?\d(?:[\s-]?\d){7,9}/g, "[phone removed]");
}
