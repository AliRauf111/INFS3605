// Writes supabase/retention-demo.sql from the demo plan in src/lib/retention/demo-data.ts.
// Run with: npm run retention:generate   (then npm run sql:bundle)
import { writeFileSync } from "node:fs";
import { demoSql } from "../src/lib/retention/demo-data";

writeFileSync("supabase/retention-demo.sql", demoSql());
console.log("Wrote supabase/retention-demo.sql");
