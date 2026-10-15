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
