// Emails the site owner when a new artwork report is filed.
// Wired to public.artwork_reports INSERT via a Supabase Database Webhook.
//
// Required secrets (Dashboard -> Edge Functions -> Secrets):
//   RESEND_API_KEY   Resend API key
//   DEV_ALERT_EMAIL  destination inbox
//   ALERT_FROM       optional; defaults to Resend's shared sender
//
// ── Round 4 security review ──────────────────────────────────────────────
// This function was live but had never been in the repository, so it had
// never been audited. What it did: take `body.record` from the request and
// email its contents. The payload is supposed to come from a database
// webhook, but nothing checked that it had — the gateway asks only for a
// valid JWT, which every signed-in member holds. So any member could POST a
// JSON body of their choosing and have this send mail, with content they
// chose, to the owner's personal inbox, as often as they liked: an inbox
// flood, a Resend quota burn, and a phishing lure wearing the site's own
// return address, all from one endpoint nobody was watching.
//
// It also returned Resend's error body to the caller verbatim, which is a
// third party's diagnostics — account state included — handed to whoever
// asked.
//
// THE REQUEST NOW SUPPLIES ONE THING: an id. Every word of the email is read
// back out of public.artwork_reports on the service role, so the worst a
// forged call can do is re-send an alert about a report that genuinely
// exists. Two further limits make even that uninteresting:
//
//   * only a report filed in the last ten minutes is mailed, so replaying an
//     old id does nothing at all; and
//   * dz_rate_take caps how many of these go out in an hour, so the Resend
//     bill has a ceiling that does not depend on anyone behaving.
//
// It fails CLOSED. If the row cannot be read the mail is not sent, because
// an alert nobody can vouch for is worse than no alert — and the report is
// still sitting in the admin panel's REPORTS tab either way.
// ─────────────────────────────────────────────────────────────────────────
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const REASONS: Record<string, string> = {
  copyright: "Copyright infringement",
  ai_undisclosed: "AI-generated without disclosure",
  nudity: "Nudity / Sexual content",
  violence: "Violence / Gore",
  hate: "Hate speech / Harassment",
  spam: "Spam / Advertising",
  misinformation: "Misinformation",
  impersonation: "Impersonation",
  illegal: "Illegal content",
  offtopic: "Off-topic / Wrong category",
  lowquality: "Low-quality / Broken upload",
  other: "Other",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A report filed longer ago than this is not news, and mailing it again on
// request is the whole replay a forged call would be reaching for.
const FRESH_MS = 10 * 60 * 1000;

// Ceiling on outbound mail per hour, whoever asks and however they ask.
const MAIL_PER_HOUR = 30;

const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] as string,
  );

// A subject line is a header. Even though Resend takes JSON rather than raw
// SMTP, control characters in a header field are somebody else's parser's
// problem and there is no reason to hand them one.
const subjectSafe = (s: unknown) =>
  String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 120);

const SB_URL = () => Deno.env.get("SUPABASE_URL") ?? "";
const SB_SVC = () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

async function underLimit(): Promise<boolean> {
  // Fail OPEN on a limiter error: a hiccup in the counter must not silence a
  // genuine moderation alert. The DB read below is the control that matters;
  // this is a cost ceiling, not an authorisation check.
  try {
    const res = await fetch(`${SB_URL()}/rest/v1/rpc/dz_rate_take`, {
      method: "POST",
      headers: {
        apikey: SB_SVC(),
        authorization: `Bearer ${SB_SVC()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        p_bucket: "fn:report-notify",
        p_limit: MAIL_PER_HOUR,
        p_seconds: 3600,
      }),
    });
    if (!res.ok) return true;
    return (await res.json()) !== false;
  } catch {
    return true;
  }
}

async function loadReport(id: string) {
  const res = await fetch(
    `${SB_URL()}/rest/v1/artwork_reports` +
      `?id=eq.${id}&select=id,artwork_id,reason,details,created_at&limit=1`,
    {
      headers: {
        apikey: SB_SVC(),
        authorization: `Bearer ${SB_SVC()}`,
      },
    },
  );
  if (!res.ok) return null;
  const rows = await res.json().catch(() => null);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

Deno.serve(async (req: Request) => {
  try {
    const KEY = Deno.env.get("RESEND_API_KEY");
    const TO = Deno.env.get("DEV_ALERT_EMAIL");
    const FROM = Deno.env.get("ALERT_FROM") ?? "DigiArtz <onboarding@resend.dev>";
    if (!KEY || !TO || !SB_URL() || !SB_SVC()) {
      // Configuration state is not the caller's business.
      return new Response("unavailable", { status: 503 });
    }

    // Supabase DB webhooks post { type, table, record, old_record }. The ONLY
    // field taken from it is the id.
    const body = await req.json().catch(() => ({}));
    const r = (body && body.record) ?? body ?? {};
    const id = String((r && r.id) ?? "");
    if (!UUID_RE.test(id)) return new Response("bad request", { status: 400 });

    if (!(await underLimit())) return new Response("rate limited", { status: 429 });

    const row = await loadReport(id);
    if (!row) return new Response("no such report", { status: 404 });

    const filedAt = new Date(row.created_at ?? 0).getTime();
    if (!filedAt || Date.now() - filedAt > FRESH_MS) {
      return new Response(JSON.stringify({ ok: true, skipped: "not fresh" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const reason = REASONS[row.reason] ?? row.reason;
    const details = row.details ? esc(row.details) : "<em>No additional details</em>";
    const when = new Date(filedAt).toUTCString();

    const html = `
      <div style="font-family:system-ui,sans-serif;line-height:1.6">
        <h2 style="margin:0 0 12px">\u{1F6A9} New artwork report</h2>
        <p style="margin:0 0 6px"><strong>Reason:</strong> ${esc(reason)}</p>
        <p style="margin:0 0 6px"><strong>Artwork ID:</strong> ${esc(row.artwork_id)}</p>
        <p style="margin:0 0 6px"><strong>Reported at:</strong> ${esc(when)}</p>
        <p style="margin:12px 0 4px"><strong>Details</strong></p>
        <blockquote style="margin:0;padding:10px 14px;background:#f4f4f5;border-left:3px solid #dc2626">${details}</blockquote>
        <p style="margin:18px 0 0">Open the DigiArtz admin panel &rarr; <strong>REPORT</strong> tab to review it.</p>
      </div>`;

    const send = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [TO],
        subject: `\u{1F6A9} DigiArtz report: ${subjectSafe(reason)}`,
        html,
      }),
    });

    if (!send.ok) {
      // Logged for the operator, not returned to the caller: this is a third
      // party's diagnostics and can carry account detail.
      console.error("Resend failed:", send.status, await send.text().catch(() => ""));
      return new Response("send failed", { status: 502 });
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response("error", { status: 500 });
  }
});
