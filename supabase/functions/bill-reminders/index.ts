// Monerem bill reminder emails.
//  - POST from the hourly schedule (header x-cron-key) sends reminders to members whose local time is 8 AM.
//  - GET/POST ?a=paid&t=...  marks one bill paid from the email (no login needed; the link is signed).
//  - GET/POST ?a=off&t=...   turns bill emails off (one-click unsubscribe).
// Secrets: RESEND_API_KEY, REMINDER_SECRET. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
// Deploy with "Verify JWT" turned OFF (the email links can't carry a login).
import { createClient } from "jsr:@supabase/supabase-js@2";

const SITE = "https://monerem.com";
const FROM = "Monerem <reminders@monerem.com>";
const REPLY_TO = "monerembudgeting@gmail.com";
const SEND_HOUR = 8;               // local time
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SECRET = Deno.env.get("REMINDER_SECRET") || "";
const enc = new TextEncoder();

/* ---------- signed links ---------- */
const b64u = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
async function hmac(s: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", k, enc.encode(s)));
}
async function sign(o: Record<string, string>) { const p = b64u(enc.encode(JSON.stringify(o))); return p + "." + (await hmac(p)); }
async function verify(t: string | null): Promise<Record<string, string> | null> {
  if (!t || !SECRET) return null; const [p, s] = t.split("."); if (!p || !s) return null;
  if ((await hmac(p)) !== s) return null;
  try { return JSON.parse(unb64u(p)); } catch { return null; }
}
const fnUrl = () => Deno.env.get("SUPABASE_URL") + "/functions/v1/bill-reminders";

/* ---------- dates (same rules as the app) ---------- */
type Bill = { id: string; name: string; amount: number; date: string; freq: string; remind?: number; paidThrough?: string | null };
const parseD = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dim = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
function occ(b: Bill, n: number) {
  const base = parseD(b.date);
  if (b.freq === "weekly" || b.freq === "biweekly") return new Date(base.getTime() + n * (b.freq === "weekly" ? 7 : 14) * 864e5);
  if (b.freq === "monthly") { let m = base.getUTCMonth() + n; const y = base.getUTCFullYear() + Math.floor(m / 12); m = ((m % 12) + 12) % 12; return new Date(Date.UTC(y, m, Math.min(base.getUTCDate(), dim(y, m)))); }
  if (b.freq === "yearly") { const y = base.getUTCFullYear() + n; return new Date(Date.UTC(y, base.getUTCMonth(), Math.min(base.getUTCDate(), dim(y, base.getUTCMonth())))); }
  return base;
}
function nextUnpaid(b: Bill, today: Date) {      // first due date from today on that isn't marked paid
  const paid = b.paidThrough ? parseD(b.paidThrough) : null;
  for (let n = 0; n < (b.freq === "once" ? 1 : 2000); n++) {
    const d = occ(b, n); if (d < today) continue; if (paid && d <= paid) continue; return d;
  }
  return null;
}
function localNow(tz: string) {
  let z = tz; try { new Intl.DateTimeFormat("en-US", { timeZone: z }); } catch { z = "America/New_York"; }
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: z, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { today: new Date(Date.UTC(+p.year, +p.month - 1, +p.day)), hour: +p.hour };
}
const money = (x: number) => "$" + (Math.round(x * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = (x: number) => "$" + Math.round(x).toLocaleString("en-US");
const dayTxt = (d: Date) => d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
const REPEAT: Record<string, string> = { weekly: "Every week", biweekly: "Every 2 weeks", monthly: "Every month", yearly: "Every year", once: "One time" };
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const whenTxt = (n: number) => n === 0 ? "today" : n === 1 ? "tomorrow" : "in " + n + " days";

/* ---------- data ---------- */
async function getDoc(uid: string, key: string) {
  const r = await db.from("member_inputs").select("inputs").eq("user_id", uid).eq("sheet_id", key).maybeSingle();
  return (r.data && r.data.inputs) || null;
}
const putDoc = (uid: string, key: string, inputs: unknown) => db.from("member_inputs").upsert({ user_id: uid, sheet_id: key, inputs, updated_at: new Date().toISOString() });

/* ---------- the email ---------- */
async function buildEmail(uid: string, name: string, main: { b: Bill; d: Date; n: number }[], soon: { b: Bill; d: Date }[], snap: any, today: Date) {
  const first = main[0], total = main.reduce((t, x) => t + (+x.b.amount || 0), 0);
  const subject = main.length === 1 ? `${first.b.name} (${money0(+first.b.amount || 0)}) is due ${whenTxt(first.n)}` : `${main.length} bills due soon (${money0(total)})`;
  const off = fnUrl() + "?a=off&t=" + encodeURIComponent(await sign({ u: uid, a: "off" }));
  const fresh = snap && typeof snap.safe === "number" && Date.now() - (+snap.at || 0) < 3 * 864e5;
  let box = "", boxTxt = "";
  if (fresh) {
    const until = snap.until ? dayTxt(parseD(snap.until)) : "";
    if (snap.safe >= 0) { box = `<b>You’re in good shape.</b> When you last checked Monerem, you had about <b>${money0(snap.safe)}</b> safe to spend${until ? " until " + until : ""}, with your bills already set aside.`; boxTxt = `You had about ${money0(snap.safe)} safe to spend${until ? " until " + until : ""}.`; }
    else { box = `<b>Plan for this one.</b> Money is tight right now. Stick to needs${until ? " until " + until : ""} and your next paycheck puts you back on track.`; boxTxt = "Money is tight right now. Stick to needs until your next paycheck."; }
  }
  const good = fresh && snap.safe >= 0;
  const cards = await Promise.all(main.map(async (x) => {
    const paid = fnUrl() + "?a=paid&t=" + encodeURIComponent(await sign({ u: uid, b: x.b.id, d: iso(x.d) }));
    return { x, paid };
  }));
  const html = `<!doctype html><html><body style="margin:0;background:#EEF4FF;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0B1F4D">
<div style="display:none;max-height:0;overflow:hidden">${esc(boxTxt || "A quick heads up so it doesn’t sneak up on you.")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF4FF;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #D6E3F8;border-radius:16px">
<tr><td style="padding:18px 24px;border-bottom:1px solid #E4ECFA;font-size:22px;font-weight:800;letter-spacing:-.02em">Monerem<span style="color:#1D4ED8">.</span></td></tr>
<tr><td style="padding:22px 24px">
<p style="margin:0 0 14px;font-size:15px">Hi ${esc(name || "there")},</p>
<p style="margin:0 0 18px;font-size:15px;line-height:1.6">A quick heads up so it doesn’t sneak up on you:</p>
${cards.map(({ x, paid }) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #D6E3F8;border-radius:12px;margin-bottom:12px"><tr><td style="padding:14px 16px">
<table role="presentation" width="100%"><tr><td style="font-size:16px;font-weight:700">${esc(x.b.name)}</td><td align="right" style="font-size:22px;font-weight:800">${money(+x.b.amount || 0)}</td></tr></table>
<div style="font-size:13px;color:#3F5586;margin-top:2px">Due ${whenTxt(x.n)}, ${dayTxt(x.d)} · ${REPEAT[x.b.freq] || "One time"}</div>
<a href="${paid}" style="display:inline-block;margin-top:10px;background:#1D4ED8;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:9px 16px;border-radius:99px">I paid it</a>
</td></tr></table>`).join("")}
${box ? `<div style="background:${good ? "#E7F7EC" : "#FFF7ED"};color:${good ? "#14532D" : "#7C2D12"};border-radius:10px;padding:12px 14px;font-size:14px;line-height:1.5;margin:6px 0 18px">${box}</div>` : `<p style="font-size:14px;color:#3F5586;margin:6px 0 18px">Open Monerem to see what’s safe to spend after this bill.</p>`}
<a href="${SITE}/app.html#home" style="display:inline-block;border:1px solid #9DB5E0;color:#14307F;text-decoration:none;font-weight:600;font-size:14px;padding:9px 16px;border-radius:99px">Open Monerem</a>
${soon.length ? `<div style="border-top:1px solid #E4ECFA;margin-top:20px;padding-top:12px;font-size:14px;color:#3F5586"><div style="font-weight:700;color:#0B1F4D;margin-bottom:4px">Also coming up this week</div>
${soon.map((s) => `<table role="presentation" width="100%"><tr><td style="padding:3px 0">${esc(s.b.name)} · ${dayTxt(s.d)}</td><td align="right">${money(+s.b.amount || 0)}</td></tr></table>`).join("")}</div>` : ""}
</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #E4ECFA;font-size:12px;color:#6B7FA8;line-height:1.6">You’re getting this because bill reminders are on in Monerem. Change when you’re reminded on each bill in the Bills tab. <a href="${off}" style="color:#6B7FA8">Turn off bill emails</a><br>Monerem · ${REPLY_TO}</td></tr>
</table></td></tr></table></body></html>`;
  const text = `Hi ${name || "there"},\n\n` + main.map((x) => `${x.b.name}: ${money(+x.b.amount || 0)} due ${whenTxt(x.n)} (${dayTxt(x.d)}).`).join("\n") +
    (boxTxt ? `\n\n${boxTxt}` : "") + `\n\nOpen Monerem: ${SITE}/app.html#home\n` + (soon.length ? `\nAlso coming up this week:\n` + soon.map((s) => `- ${s.b.name}, ${dayTxt(s.d)}: ${money(+s.b.amount || 0)}`).join("\n") + "\n" : "") + `\nTurn off bill emails: ${off}\n`;
  return { subject, html, text, off };
}

/* ---------- the hourly run ---------- */
async function run(force?: string) {   // force = one member's id, to send a test right away
  const mem = await db.from("members").select("user_id,status,current_period_end").in("status", ["active", "trialing"]);
  if (mem.error) throw mem.error;
  const users = (mem.data || []).filter((m) => !m.current_period_end || new Date(m.current_period_end) > new Date()).map((m) => m.user_id).filter((u) => !force || u === force);
  let sent = 0;
  for (const uid of users) {
    try {
      const prefs = (await getDoc(uid, "prefs")) || {};
      if (prefs.emailBills === false) continue;
      const { today, hour } = localNow(prefs.tz || "America/New_York");
      if (!force && hour !== SEND_HOUR) continue;
      const bd = await getDoc(uid, "bills"); const bills: Bill[] = (bd && Array.isArray(bd.__bills)) ? bd.__bills : [];
      if (!bills.length) continue;
      const log = (await getDoc(uid, "reminders-log")) || {}; const sentLog: Record<string, string> = log.__sent || {};
      const main: { b: Bill; d: Date; n: number }[] = [], soon: { b: Bill; d: Date }[] = [];
      for (const b of bills) {
        const d = nextUnpaid(b, today); if (!d) continue;
        const n = Math.round((d.getTime() - today.getTime()) / 864e5), r = +(b.remind || 3);
        // inside its reminder window and not emailed yet for this due date (so a bill added late still gets one email)
        if (n >= 0 && n <= r && !sentLog[b.id + ":" + iso(d)]) main.push({ b, d, n });
        else if (n >= 0 && n <= 7) soon.push({ b, d });
      }
      if (!main.length) continue;
      main.sort((a, b) => a.d.getTime() - b.d.getTime()); soon.sort((a, b) => a.d.getTime() - b.d.getTime());
      const u = await db.auth.admin.getUserById(uid); const email = u.data?.user?.email; if (!email) continue;
      const nm = String(u.data.user.user_metadata?.full_name || u.data.user.user_metadata?.name || "").trim().split(/\s+/)[0];
      const snap = await getDoc(uid, "safe");
      const m = await buildEmail(uid, nm, main, soon.slice(0, 5), snap, today);
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: "Bearer " + Deno.env.get("RESEND_API_KEY"), "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to: [email], reply_to: REPLY_TO, subject: m.subject, html: m.html, text: m.text,
          headers: { "List-Unsubscribe": `<${m.off}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }),
      });
      if (!res.ok) { console.error("resend", uid, res.status, await res.text()); continue; }
      main.forEach((x) => { sentLog[x.b.id + ":" + iso(x.d)] = iso(today); });
      const keys = Object.keys(sentLog); if (keys.length > 300) keys.slice(0, keys.length - 300).forEach((k) => delete sentLog[k]);
      await putDoc(uid, "reminders-log", { __sent: sentLog }); sent++;
    } catch (e) { console.error("user", uid, e); }
  }
  return { checked: users.length, sent };
}

/* ---------- the links in the email ---------- */
async function markPaid(t: Record<string, string>) {
  const bd = await getDoc(t.u, "bills"); const bills: Bill[] = (bd && Array.isArray(bd.__bills)) ? bd.__bills : [];
  const b = bills.find((x) => x.id === t.b); if (!b) return "gone";
  if (!b.paidThrough || b.paidThrough < t.d) b.paidThrough = t.d;
  await putDoc(t.u, "bills", { ...bd, __bills: bills });
  return "paid";
}
async function turnOff(t: Record<string, string>) {
  const prefs = (await getDoc(t.u, "prefs")) || {}; prefs.emailBills = false;
  await putDoc(t.u, "prefs", prefs); return "off";
}

Deno.serve(async (req) => {
  const url = new URL(req.url), a = url.searchParams.get("a");
  if (a === "paid" || a === "off") {
    const t = await verify(url.searchParams.get("t"));
    let done = "bad";
    if (t && t.u) { try { done = a === "paid" && t.b ? await markPaid(t) : a === "off" ? await turnOff(t) : "bad"; } catch (e) { console.error(e); done = "err"; } }
    if (req.method === "POST") return new Response(done === "off" ? "ok" : "error", { status: done === "off" ? 200 : 400 });   // one-click unsubscribe from mail apps
    return Response.redirect(SITE + "/reminder.html?r=" + done, 302);
  }
  if (req.method === "POST") {
    if (!SECRET || req.headers.get("x-cron-key") !== SECRET) return new Response("forbidden", { status: 403 });
    let body: any = {}; try { body = await req.json(); } catch { /* empty */ }
    try { return Response.json(await run(body.testUser)); } catch (e) { console.error(e); return new Response("error", { status: 500 }); }
  }
  return new Response("ok");
});
