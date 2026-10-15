// Creates (or updates) the two fictional demo accounts in Supabase Auth and gives them
// their roles in app_users. Run with: npm run seed:users
// Passwords come from .env.local so they are never committed to Git.
import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local first.");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const accounts = [
  { email: process.env.DEMO_ADMIN_EMAIL, password: process.env.DEMO_ADMIN_PASSWORD, name: "Sarah Mitchell", role: "admin" },
  { email: process.env.DEMO_OWNER_EMAIL, password: process.env.DEMO_OWNER_PASSWORD, name: "Alex Chen", role: "owner" },
];

for (const a of accounts) {
  if (!a.email || !a.password || a.password.length < 10 || a.password.startsWith("choose-")) {
    console.error(`Set a real password (10+ characters) for ${a.role} in .env.local.`);
    process.exit(1);
  }
  const { data: list, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;
  let user = list.users.find((u) => u.email?.toLowerCase() === a.email.toLowerCase());
  if (user) {
    const { error } = await supabase.auth.admin.updateUserById(user.id, { password: a.password, email_confirm: true });
    if (error) throw error;
  } else {
    const { data, error } = await supabase.auth.admin.createUser({ email: a.email, password: a.password, email_confirm: true });
    if (error) throw error;
    user = data.user;
  }
  const { error } = await supabase.from("app_users").upsert({ id: user.id, display_name: a.name, role: a.role });
  if (error) throw error;
  console.log(`Ready: ${a.email} (${a.role})`);
}
