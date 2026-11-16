// Monerem admin tools: business numbers and member help for the Account > Admin tools panel.
// One POST endpoint, { action: "stats" | "lookup" | "grant" | "revoke" | "extend" | "export", ... }.
//
// Who can call it: only a logged-in user whose email is in the ADMIN_EMAILS secret (comma separated).
// The function checks the login itself, so deploy it with "Verify JWT" turned OFF (same as bill-reminders).
// That also lets the browser's permission check (CORS preflight) through, which Verify JWT would block.
//
// Secrets:
//   ADMIN_EMAILS       e.g. taylordavid0911@gmail.com   (required)
//   STRIPE_SECRET_KEY  your sk_live_... key             (optional: without it revenue and plan details show "—")
//   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
//
// How a member is counted (test accounts ending in @monerem.test, and the admin emails themselves, are left out):
//   Paying       a Stripe subscription that is active (or past due)
//   On free trial a Stripe subscription that is trialing
//   Free access  an active row in "members" with no Stripe customer (given by you with "Give free access")
//   Inactive     everything else, including accounts that signed up and never paid
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const STRIPE_KEY = (Deno.env.get("STRIPE_SECRET_KEY") || "").trim().replace(/^["']|["']$/g, "");
const ADMINS = (Deno.env.get("ADMIN_EMAILS") || "").split(",").map((s) => s.trim().toLowerCase().replace(/^["']|["']$/g, "")).filter(Boolean);
const ORIGINS = ["https://monerem.com", "https://www.monerem.com", "https://dabbst1.github.io"];
const DAY = 864e5;

/* ---------- plumbing ---------- */
function cors(req: Request) {
  const o = req.headers.get("origin") || "";
  const ok = ORIGINS.includes(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
  return {
    "Access-Control-Allow-Origin": ok ? o : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const reply = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });
class Fail extends Error { constructor(public code: string, public status: number) { super(code); } }

/* ---------- accounts, memberships, Stripe ---------- */
type U = { id: string; email: string; created_at: string; last_sign_in_at: string | null; user_metadata?: Record<string, unknown> };
type M = { user_id: string; status: string | null; current_period_end: string | null; stripe_customer_id: string | null };
type Sub = { id: string; status: string; customer: string; trialEnd: number | null; periodEnd: number | null; cancel: boolean; interval: string; monthly: number };

const isTest = (u: U) => /@monerem\.test$/i.test(u.email || "") || ADMINS.includes((u.email || "").toLowerCase());   // test accounts and your own admin logins are left out of the numbers

async function allUsers(): Promise<U[]> {
  const out: U[] = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const list = (data?.users || []) as unknown as U[];
    out.push(...list.filter((u) => u.email));
    if (list.length < 1000) break;
  }
  return out;
}
async function allMembers(): Promise<Record<string, M>> {
  const { data, error } = await db.from("members").select("user_id,status,current_period_end,stripe_customer_id");
  if (error) throw error;
  const m: Record<string, M> = {};
  (data || []).forEach((r: M) => { m[r.user_id] = r; });
  return m;
}
async function stripeGet(path: string) {
  const r = await fetch("https://api.stripe.com/v1/" + path, { headers: { Authorization: "Bearer " + STRIPE_KEY } });
  const j = await r.json();
  if (!r.ok) throw new Error((j && j.error && j.error.message) || "stripe " + r.status);
  return j;
}
async function stripePost(path: string, form: Record<string, string>) {
  const r = await fetch("https://api.stripe.com/v1/" + path, {
    method: "POST", headers: { Authorization: "Bearer " + STRIPE_KEY, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form),
  });
  const j = await r.json();
  if (!r.ok) throw new Error((j && j.error && j.error.message) || "stripe " + r.status);
  return j;
}
function toSub(s: any): Sub {
  const it = s.items?.data?.[0] || {}, price = it.price || s.plan || {}, interval = price.recurring?.interval || price.interval || "month";
  const unit = (price.unit_amount ?? price.amount ?? 0) / 100 * (it.quantity || 1);
  return {
    id: s.id, status: s.status, customer: typeof s.customer === "string" ? s.customer : s.customer?.id,
    trialEnd: s.trial_end || null, periodEnd: s.current_period_end || it.current_period_end || null,
    cancel: !!s.cancel_at_period_end || !!s.cancel_at, interval, monthly: interval === "year" ? unit / 12 : unit,
  };
}
const RANK: Record<string, number> = { active: 5, trialing: 4, past_due: 3, unpaid: 2, incomplete: 1 };
// the most relevant subscription per Stripe customer (a customer can have an old canceled one too)
async function subsByCustomer(): Promise<Record<string, Sub> | null> {
  if (!STRIPE_KEY) return null;
  const by: Record<string, Sub> = {};
  let after = "";
  for (let i = 0; i < 40; i++) {
    const j = await stripeGet("subscriptions?status=all&limit=100" + (after ? "&starting_after=" + after : ""));
    (j.data || []).forEach((s: any) => {
      const sub = toSub(s), cur = by[sub.customer];
      if (!cur || (RANK[sub.status] || 0) > (RANK[cur.status] || 0)) by[sub.customer] = sub;
    });
    if (!j.has_more) break;
    after = j.data[j.data.length - 1].id;
  }
  return by;
}

type Access = "paying" | "trial" | "free" | "inactive";
function classify(m: M | undefined, sub: Sub | undefined, stripeKnown: boolean): Access {
  const now = Date.now(), end = m?.current_period_end ? new Date(m.current_period_end).getTime() : null;
  const live = !!m && (m.status === "active" || m.status === "trialing") && (end === null || end > now);
  if (sub) {
    if (sub.status === "trialing") return "trial";
    if (sub.status === "active" || sub.status === "past_due") return "paying";
    return "inactive";
  }
  if (m?.stripe_customer_id) {                       // a Stripe customer, but we couldn't read Stripe (or no subscription found)
    if (!stripeKnown && live) return m.status === "trialing" ? "trial" : "paying";
    return "inactive";
  }
  return live ? "free" : "inactive";
}

async function snapshot() {
  const [users, members, subs] = await Promise.all([allUsers(), allMembers(), subsByCustomer().catch(() => null)]);
  const stripeKnown = subs !== null;
  const rows = users.filter((u) => !isTest(u)).map((u) => {
    const m = members[u.id], sub = m?.stripe_customer_id && subs ? subs[m.stripe_customer_id] : undefined;
    return { u, m, sub, access: classify(m, sub, stripeKnown) };
  });
  return { rows, stripeKnown };
}

async function findUser(raw: string): Promise<U> {
  let q = String(raw || "").trim().toLowerCase();
  if (!q) throw new Fail("no_such_member", 404);
  if (q.indexOf("@") < 0) q = q.replace(/[^a-z0-9._-]/g, "") + "@monerem.test";   // test logins are plain usernames
  const u = (await allUsers()).find((x) => x.email.toLowerCase() === q);
  if (!u) throw new Fail("no_such_member", 404);
  return u;
}
async function memberOf(u: U) {
  const { data } = await db.from("members").select("user_id,status,current_period_end,stripe_customer_id").eq("user_id", u.id).maybeSingle();
  const m = (data || undefined) as M | undefined;
  let sub: Sub | undefined;
  if (m?.stripe_customer_id && STRIPE_KEY) {
    const by = await subsByCustomer().catch(() => null);
    sub = by ? by[m.stripe_customer_id] : undefined;
  }
  return { m, sub, access: classify(m, sub, !!STRIPE_KEY) };
}

/* ---------- actions ---------- */
async function stats() {
  const { rows, stripeKnown } = await snapshot();
  const c = { paying: 0, trial: 0, free: 0, inactive: 0, accounts: rows.length };
  let mrr = 0, monthlyPlans = 0, annualPlans = 0;
  const soon: { email: string; ends: string }[] = [], now = Date.now();
  rows.forEach((r) => {
    c[r.access]++;
    if (r.sub && (r.access === "paying" || r.access === "trial")) {
      if (r.sub.interval === "year") annualPlans++; else monthlyPlans++;
      if (r.access === "paying") mrr += r.sub.monthly;
    }
    let ends: number | null = null;
    if (r.access === "trial" && r.sub) ends = (r.sub.trialEnd || 0) * 1000 || null;
    else if (r.access === "free" && r.m?.current_period_end) ends = new Date(r.m.current_period_end).getTime();
    if (ends && ends > now && ends < now + 7 * DAY) soon.push({ email: r.u.email, ends: new Date(ends).toISOString() });
  });
  soon.sort((a, b) => a.ends.localeCompare(b.ends));
  return {
    counts: c,
    mrr: stripeKnown ? Math.round(mrr * 100) / 100 : null,
    newThisWeek: rows.filter((r) => now - new Date(r.u.created_at).getTime() < 7 * DAY).length,
    monthlyPlans, annualPlans,
    stripeMode: !STRIPE_KEY ? "not connected" : STRIPE_KEY.startsWith("sk_live") || STRIPE_KEY.startsWith("rk_live") ? "live" : "test",
    trialsEnding: soon.map((t) => ({ email: t.email, ends: t.ends })),
  };
}

async function lookup(email: string) {
  const u = await findUser(email), { m, sub, access } = await memberOf(u);
  const out: Record<string, unknown> = {
    email: u.email, access, joined: u.created_at, lastLogin: u.last_sign_in_at || null,
    accessUntil: access === "free" ? m?.current_period_end || null : null,
  };
  if (sub) {
    out.stripe = {
      plan: sub.interval === "year" ? "Annual" : "Monthly", status: sub.status, canceling: sub.cancel,
      trialEnds: sub.trialEnd ? new Date(sub.trialEnd * 1000).toISOString() : null,
      renews: sub.periodEnd ? new Date(sub.periodEnd * 1000).toISOString() : null,
    };
  }
  return out;
}

async function grant(email: string, until: string | null) {
  const u = await findUser(email), { sub } = await memberOf(u);
  if (sub && (sub.status === "active" || sub.status === "trialing" || sub.status === "past_due")) throw new Fail("has_paid_plan", 409);
  let end: string | null = null;
  if (until) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new Fail("bad_date", 400);
    end = until + "T23:59:59Z";
  }
  const { error } = await db.from("members").upsert({ user_id: u.id, status: "active", current_period_end: end, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw error;
  return { ok: true };
}

async function revoke(email: string) {
  const u = await findUser(email), { m, sub } = await memberOf(u);
  if (sub && (sub.status === "active" || sub.status === "trialing" || sub.status === "past_due")) throw new Fail("has_paid_plan", 409);
  if (!m) return { ok: true };
  const { error } = await db.from("members").update({ status: "inactive", current_period_end: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("user_id", u.id);
  if (error) throw error;
  return { ok: true };
}

async function extend(email: string, days: number) {
  if (!(days > 0 && days <= 365)) throw new Fail("bad_days", 400);
  const u = await findUser(email), { m, sub } = await memberOf(u), now = Date.now();
  if (sub && sub.status === "trialing" && STRIPE_KEY) {                  // extend a Stripe free trial
    const base = Math.max((sub.trialEnd || 0) * 1000, now), next = Math.floor((base + days * DAY) / 1000);
    await stripePost("subscriptions/" + sub.id, { trial_end: String(next) });
    const iso = new Date(next * 1000).toISOString();
    await db.from("members").update({ current_period_end: iso, updated_at: new Date().toISOString() }).eq("user_id", u.id);
    return { newEnd: iso };
  }
  if (!sub && m && !m.stripe_customer_id && m.current_period_end) {      // extend dated free access
    const base = Math.max(new Date(m.current_period_end).getTime(), now), iso = new Date(base + days * DAY).toISOString();
    const { error } = await db.from("members").update({ status: "active", current_period_end: iso, updated_at: new Date().toISOString() }).eq("user_id", u.id);
    if (error) throw error;
    return { newEnd: iso };
  }
  throw new Fail("no_trial", 400);
}

const cell = (v: unknown) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;                               // stop spreadsheet formula injection
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
async function exportCsv(filter: string) {
  const { rows } = await snapshot();
  const keep = rows.filter((r) => filter === "all" || r.access === filter);
  const label: Record<Access, string> = { paying: "Paying", trial: "On free trial", free: "Free access", inactive: "Signed up, not active" };
  const head = ["Email", "Name", "Access", "Plan", "Joined", "Last log in"];
  const lines = keep.map((r) => [
    r.u.email, (r.u.user_metadata?.full_name as string) || (r.u.user_metadata?.name as string) || "", label[r.access],
    r.sub ? (r.sub.interval === "year" ? "Annual" : "Monthly") : "", r.u.created_at.slice(0, 10), (r.u.last_sign_in_at || "").slice(0, 10),
  ].map(cell).join(","));
  return { csv: [head.join(",")].concat(lines).join("\n"), count: keep.length };
}

/* ---------- entry ---------- */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return reply(req, { error: "post_only" }, 405);
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return reply(req, { error: "not_logged_in" }, 401);
    const { data, error } = await db.auth.getUser(token);
    const email = data?.user?.email?.toLowerCase();
    if (error || !email) return reply(req, { error: "not_logged_in" }, 401);
    if (!ADMINS.includes(email)) return reply(req, { error: "not_admin" }, 403);

    let b: Record<string, any> = {};
    try { b = await req.json(); } catch { /* empty body */ }
    switch (b.action) {
      case "stats": return reply(req, await stats());
      case "lookup": return reply(req, await lookup(b.email));
      case "grant": return reply(req, await grant(b.email, b.until || null));
      case "revoke": return reply(req, await revoke(b.email));
      case "extend": return reply(req, await extend(b.email, Number(b.days)));
      case "export": return reply(req, await exportCsv(["paying", "trial", "free", "inactive"].includes(b.filter) ? b.filter : "all"));
      default: return reply(req, { error: "unknown_action" }, 400);
    }
  } catch (e) {
    if (e instanceof Fail) return reply(req, { error: e.code }, e.status);
    console.error("admin function error:", e);
    return reply(req, { error: "server_error" }, 500);
  }
});
