// Looks for secrets in files tracked by Git and in the browser bundle (.next/static).
// Run with: npm run check:secrets   (run npm run build first to include the bundle)
// It checks for common key formats and for the actual values in .env.local, if present.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const PATTERNS = [
  [/sb_secret_[A-Za-z0-9_-]{20,}/, "Supabase secret key"],
  [/sk-ant-[A-Za-z0-9_-]{20,}/, "Anthropic API key"],
  [/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "JWT (possibly a service key)"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
];

// Real values from .env.local, so a pasted key is caught even if it has no known prefix.
const localValues = [];
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*(SUPABASE_SECRET_KEY|ANTHROPIC_API_KEY|DEMO_ADMIN_PASSWORD|DEMO_OWNER_PASSWORD)\s*=\s*(.+?)\s*$/);
    if (m && m[2].length >= 8) localValues.push([m[2].replace(/^["']|["']$/g, ""), `value of ${m[1]} from .env.local`]);
  }
}

function scan(file, text, problems) {
  for (const [re, label] of PATTERNS) if (re.test(text)) problems.push(`${file}: looks like a ${label}`);
  for (const [value, label] of localValues) if (text.includes(value)) problems.push(`${file}: contains the ${label}`);
}

const problems = [];
const tracked = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\0").filter(Boolean);
for (const f of tracked) {
  if (!existsSync(f) || statSync(f).size > 2_000_000) continue;
  scan(f, readFileSync(f, "utf8"), problems);
}
for (const ignored of [".env.local", ".env"]) {
  if (tracked.includes(ignored)) problems.push(`${ignored} would be committed. It must stay in .gitignore.`);
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const bundle = walk(".next/static");
for (const f of bundle) scan(f, readFileSync(f, "utf8"), problems);

console.log(`Checked ${tracked.length} Git files and ${bundle.length} browser bundle files${bundle.length ? "" : " (run npm run build to include the bundle)"}.`);
if (problems.length) {
  console.log("Possible secrets found:\n" + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log("No secrets found.");
