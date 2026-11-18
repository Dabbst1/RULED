// Supabase Edge Function: bank
// Lets members link bank and credit card accounts with Stripe Financial Connections (read-only:
// balances + transactions), then review transactions before adding them to their budget.
//
// Deploy as a new function named exactly "bank". Leave "Verify JWT" ON.
// Secret: STRIPE_BANK_SECRET_KEY (or falls back to STRIPE_SECRET_KEY). Test key = test banks, live key = real banks.
// Needs the tables from bank-tables.sql.

import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

// Uses STRIPE_BANK_SECRET_KEY if you set one (so bank linking can use a different key than checkout), otherwise STRIPE_SECRET_KEY.
// It MUST come from the same Stripe account/sandbox and mode as the publishable key in app.html (pk_test_51UVYB6...).
const stripe = new Stripe(Deno.env.get("STRIPE_BANK_SECRET_KEY") || Deno.env.get("STRIPE_SECRET_KEY")!, { httpClient: Stripe.createFetchHttpClient() });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MAX_ACCOUNTS = 12;            // per member, keeps costs predictable
const BALANCE_REFRESH_HOURS = 1;    // automatic: ask the bank for a fresh balance at most once an hour (when you open the Bank tab)
const MANUAL_REFRESH_MINUTES = 5;   // opening the Bank tab / pressing Refresh: ask the bank again if the last check is older than this
const TX_REFRESH_HOURS = 1;         // automatic: ask for new transactions at least hourly (on top of Stripe's daily update)

// deno-lint-ignore no-explicit-any
type Any = any;

function cleanAccount(a: Any) {
  const b = a.balance || {};
  const cur = b.current?.usd ?? null;
  const avail = b.cash?.available?.usd ?? null;
  const used = b.credit?.used?.usd ?? null;
  const isCredit = a.category === "credit" || b.type === "credit";
  return {
    institution: a.institution_name || "Bank",
    name: a.display_name || a.subcategory || "Account",
    last4: a.last4 || "",
    category: a.category || "other",
    subcategory: a.subcategory || "",
    status: a.status || "active",
    // why it stopped and whether signing in again fixes it (e.g. "relink_required")
    status_action: a.status === "inactive" ? (a.status_details?.inactive?.action || "relink_required") : "",
    balance: {
      kind: isCredit ? "credit" : a.category === "cash" ? "cash" : "other",
      current: cur === null ? null : cur / 100,
      available: avail === null ? null : avail / 100,
      owed: isCredit ? (used !== null ? used / 100 : cur !== null ? Math.abs(cur) / 100 : null) : null,
    },
    balance_at: b.as_of ? new Date(b.as_of * 1000).toISOString() : null,
  };
}

async function customerFor(user: Any) {
  const { data } = await admin.from("bank_customers").select("customer").eq("user_id", user.id).maybeSingle();
  if (data?.customer) {
    // the saved customer may belong to another Stripe account or mode (e.g. after switching keys); if so, make a new one
    try { const c: Any = await stripe.customers.retrieve(data.customer); if (!c.deleted) return data.customer as string; }
    catch (e: Any) { if (e?.code !== "resource_missing" && e?.statusCode !== 404) throw e; }
  }
  const c = await stripe.customers.create({ email: user.email || undefined, metadata: { user_id: user.id, purpose: "bank_linking" } });
  await admin.from("bank_customers").upsert({ user_id: user.id, customer: c.id });
  return c.id;
}

// Pull new transactions + balances for every linked account, then return what the member should see.
async function sync(userId: string, force = false) {
  const { data: rows } = await admin.from("bank_accounts").select("id,tx_cursor,balance_at,status").eq("user_id", userId);
  let loading = false, refreshing = false;
  const cutoff = new Date(); cutoff.setDate(1); cutoff.setMonth(cutoff.getMonth() - 1); cutoff.setHours(0, 0, 0, 0);   // start of last month
  for (const row of rows || []) {
    if (row.status === "disconnected") continue;
    let acct: Any;
    try { acct = await stripe.financialConnections.accounts.retrieve(row.id); } catch { continue; }
    const upd: Any = { ...cleanAccount(acct), updated_at: new Date().toISOString() };
    const tr0 = acct.transaction_refresh;
    if (tr0?.last_attempted_at) upd.balance = { ...upd.balance, tx_at: new Date(tr0.last_attempted_at * 1000).toISOString() };   // when we last checked with the bank
    // make sure the daily automatic transaction updates are switched on
    if (acct.status === "active" && !(acct.subscriptions || []).includes("transactions")) {
      try { await stripe.financialConnections.accounts.subscribe(row.id, { features: ["transactions"] }); } catch { /* try again next time */ }
    }
    // new transactions: ask the bank right away (opening the tab / Refresh), at most every few minutes
    const txAge = tr0?.last_attempted_at ? (Date.now() / 1000 - tr0.last_attempted_at) / 60 : 9999;   // minutes
    if (acct.status === "active" && tr0?.status !== "pending" && (txAge > TX_REFRESH_HOURS * 60 || (force && txAge > MANUAL_REFRESH_MINUTES))) {
      try { await stripe.financialConnections.accounts.refresh(row.id, { features: ["transactions"] }); refreshing = true; } catch { /* not available right now */ }
    }
    // balances: ask for a fresh one now and then (it arrives asynchronously)
    const age = row.balance_at ? (Date.now() - new Date(row.balance_at).getTime()) / 36e5 : 999;
    if (acct.balance_refresh?.status === "pending") refreshing = true;
    else if (acct.status === "active" && (age > BALANCE_REFRESH_HOURS || (force && age * 60 > MANUAL_REFRESH_MINUTES))) {
      try { await stripe.financialConnections.accounts.refresh(row.id, { features: ["balance"] }); refreshing = true; } catch { /* not available yet */ }
    }
    // transactions
    const tr = acct.transaction_refresh;
    if (!tr || tr.status === "pending") { loading = true; if (tr) refreshing = true; }
    if (tr && tr.status === "succeeded" && tr.id !== row.tx_cursor) {
      const params: Any = { account: row.id, limit: 100 };
      if (row.tx_cursor) params.transaction_refresh = { after: row.tx_cursor };
      const batch: Any[] = [];
      for await (const t of stripe.financialConnections.transactions.list(params)) {
        batch.push({
          id: t.id, user_id: userId, account_id: row.id, amount_cents: t.amount, description: t.description || "",
          transacted_at: new Date(t.transacted_at * 1000).toISOString(), status: t.status,
        });
        if (batch.length >= 2000) break;
      }
      await carryOver(userId, row.id, batch);
      // rows that match one we already had are saved on their own (with the earlier state), so the rest keep theirs
      const dups = batch.filter((b) => b.dup_of), plain = batch.filter((b) => !b.dup_of);
      for (let i = 0; i < plain.length; i += 500) await admin.from("bank_transactions").upsert(plain.slice(i, i + 500), { onConflict: "id", defaultToNull: false });
      for (let i = 0; i < dups.length; i += 500) await admin.from("bank_transactions").upsert(dups.slice(i, i + 500), { onConflict: "id", defaultToNull: false });
      upd.tx_cursor = tr.id;
    }
    await admin.from("bank_accounts").update(upd).eq("id", row.id).eq("user_id", userId);
  }
  // keep the review list short: old history and voided charges aren't asked about
  await admin.from("bank_transactions").update({ state: "old" }).eq("user_id", userId).eq("state", "new").lt("transacted_at", cutoff.toISOString());
  await admin.from("bank_transactions").update({ state: "void" }).eq("user_id", userId).eq("state", "new").eq("status", "void");
  return { ...(await view(userId, loading)), refreshing };
}

// After Chase (or any bank) is reconnected as a brand-new account, the same transactions arrive again with new IDs.
// Anything that matches one we already had on the old account (same day, amount and description) keeps the old one's
// state, so it isn't reviewed or added a second time. New transactions on the same account are never touched.
async function carryOver(userId: string, accountId: string, batch: Any[]) {
  const { data: me } = await admin.from("bank_accounts").select("institution,last4,subcategory,created_at").eq("id", accountId).maybeSingle();
  if (!me || !me.last4) return;
  const { data: twins } = await admin.from("bank_accounts").select("id").eq("user_id", userId).neq("id", accountId)
    .eq("institution", me.institution).eq("last4", me.last4).eq("subcategory", me.subcategory || "");
  const ids = (twins || []).map((t: Any) => t.id); if (!ids.length) return;
  const { data: old } = await admin.from("bank_transactions").select("id,amount_cents,description,transacted_at,state").eq("user_id", userId).in("account_id", ids);
  if (!old || !old.length) return;
  const key = (t: Any) => t.amount_cents + "|" + String(t.transacted_at).slice(0, 10) + "|" + String(t.description || "").trim().toLowerCase();
  const pool: Record<string, Any[]> = {};
  for (const o of old) (pool[key(o)] = pool[key(o)] || []).push(o);
  const { data: mine } = await admin.from("bank_transactions").select("id").in("id", batch.map((b) => b.id));
  const have = new Set((mine || []).map((m: Any) => m.id));
  for (const b of batch) {
    if (have.has(b.id)) continue;                       // already stored: leave its state alone
    const list = pool[key(b)]; if (!list || !list.length) continue;
    const o = list.shift();                             // one-for-one, so two real same-day charges still both count
    b.state = o.state === "new" ? "new" : o.state; b.dup_of = o.id;
  }
}

async function view(userId: string, loading = false) {
  const [{ data: accts }, { data: tx }] = await Promise.all([
    admin.from("bank_accounts").select("id,institution,name,last4,category,subcategory,status,status_action,balance,balance_at,updated_at").eq("user_id", userId).order("created_at"),
    admin.from("bank_transactions").select("id,account_id,amount_cents,description,transacted_at,status,dup_of").eq("user_id", userId).eq("state", "new").order("transacted_at", { ascending: false }).limit(300),
  ]);
  return {
    accounts: accts || [],
    review: (tx || []).map((t: Any) => ({ id: t.id, account: t.account_id, amount: t.amount_cents / 100, description: t.description, date: t.transacted_at, status: t.status, dup_of: t.dup_of || null })),
    loading,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "not_signed_in" }, 401);
    const { data: m } = await admin.from("members").select("status,current_period_end").eq("user_id", user.id).maybeSingle();
    const on = m && (m.status === "active" || m.status === "trialing") && (!m.current_period_end || new Date(m.current_period_end) > new Date());
    if (!on) return json({ error: "membership_inactive" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    // 1. start linking: a short-lived session the Stripe pop-up uses
    if (action === "session") {
      const { count } = await admin.from("bank_accounts").select("id", { count: "exact", head: true }).eq("user_id", user.id).neq("status", "disconnected");
      if ((count || 0) >= MAX_ACCOUNTS) return json({ error: "too_many_accounts" }, 409);
      const customer = await customerFor(user);
      const s = await stripe.financialConnections.sessions.create({
        account_holder: { type: "customer", customer },
        permissions: ["balances", "transactions"],
        prefetch: ["balances", "transactions"],
        filters: { countries: ["US"] },
      });
      return json({ clientSecret: s.client_secret });
    }

    // 1b. reconnect an account the bank stopped sharing (inactive): sign in again for the same connection
    if (action === "relink") {
      const id = String(body.account || "");
      const { data: row } = await admin.from("bank_accounts").select("id").eq("id", id).eq("user_id", user.id).maybeSingle();
      if (!row) return json({ error: "not_found" }, 404);
      const customer = await customerFor(user);
      const acct: Any = await stripe.financialConnections.accounts.retrieve(id);
      const auth = typeof acct.authorization === "string" ? acct.authorization : acct.authorization?.id;
      if (!auth) return json({ error: "relink_not_available" }, 409);
      const s: Any = await stripe.financialConnections.sessions.create({
        account_holder: { type: "customer", customer },
        permissions: ["balances", "transactions"],
        prefetch: ["balances", "transactions"],
        filters: { countries: ["US"] },
        relink_options: { authorization: auth },
      } as Any, { apiVersion: "2026-01-28.clover" } as Any);
      return json({ clientSecret: s.client_secret, authorization: auth });
    }

    // 2. after the pop-up: save the accounts the member chose
    if (action === "save") {
      const customer = await customerFor(user);
      const s: Any = await stripe.financialConnections.sessions.retrieve(String(body.session || ""));
      if (s.account_holder?.customer !== customer) return json({ error: "not_your_session" }, 403);
      const accounts: Any[] = s.accounts?.data || [];
      for (const a of accounts) {
        await admin.from("bank_accounts").upsert({ id: a.id, user_id: user.id, ...cleanAccount(a), updated_at: new Date().toISOString() }, { onConflict: "id" });
        try { await stripe.financialConnections.accounts.subscribe(a.id, { features: ["transactions"] }); } catch { /* prefetch already started */ }
      }
      return json({ linked: accounts.length, ...(await sync(user.id, true)) });
    }

    if (action === "list") return json(await view(user.id));
    if (action === "sync") return json(await sync(user.id, body.force === true));

    // 3. the member reviewed transactions: mark them added or skipped
    if (action === "mark") {
      const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).slice(0, 500);
      const state = body.state === "imported" ? "imported" : "skipped";
      if (ids.length) await admin.from("bank_transactions").update({ state }).eq("user_id", user.id).in("id", ids);
      return json({ ok: true });
    }

    // 4. unlink: stop Stripe's access and delete everything we stored for that account
    if (action === "unlink") {
      const id = String(body.account || "");
      const { data: row } = await admin.from("bank_accounts").select("id").eq("id", id).eq("user_id", user.id).maybeSingle();
      if (!row) return json({ error: "not_found" }, 404);
      try { await stripe.financialConnections.accounts.disconnect(id); } catch { /* already disconnected */ }
      await admin.from("bank_accounts").delete().eq("id", id).eq("user_id", user.id);   // transactions are deleted with it
      return json({ ok: true, ...(await view(user.id)) });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : "bank_failed" }, 500);
  }
});