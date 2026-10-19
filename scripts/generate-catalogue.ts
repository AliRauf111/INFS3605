// Writes supabase/catalogue.sql from the catalogue in src/lib/catalogue/hsc.ts.
// Run with: npm run catalogue:generate   (then npm run sql:bundle)
import { writeFileSync } from "node:fs";
import { catalogueSql } from "../src/lib/catalogue/sql";

writeFileSync("supabase/catalogue.sql", catalogueSql());
console.log("Wrote supabase/catalogue.sql.");
