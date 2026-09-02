import { json } from '../../lib/http.js';
import { sbUser, sbSvc, sbService, underLimit } from '../../lib/sb.js';
import {
  MODERATION_PROMPT, CATEGORIES, MESSAGES, decide, moderateWithGemini, toBase64
} from '../moderate-upload.js';

// One artwork per call, oldest first. When the moderator is unreachable an
// upload is kept as pending instead of being turned away, and this drains the
// queue that leaves behind — in the order the artworks were uploaded, one at a
// time, so the moderator is never handed a batch it has to judge at once.

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// A global single-flight. Every caller shares this bucket, so a queue tick can
// only start once every few seconds however many people have the site open.
const TICK_SECONDS = 6;

const SELECT = 'id,user_id,name,image_url,created_at';

export async function onRequestPost(context) {
  const { request, env } = context;

  const user = await sbUser(env, request);
  if (!user) return json({ error: 'Not signed in.' }, 401);
  if (!sbSvc(env)) return json({ waiting: 0, down: true, more: false }, 200);

  if (!(await underLimit(env, 'modq:drain', 1, TICK_SECONDS))) {
    return json({ processed: null, busy: true, more: true }, 200);
  }

  let queue;
  try {
    queue = await sbService(env,
      `/artworks?status=eq.pending&select=${SELECT}&order=created_at.asc&limit=2`,
      { method: 'GET' });
  } catch {
    return json({ error: 'Queue unavailable.' }, 503);
  }
  if (!Array.isArray(queue) || queue.length === 0) {
    return json({ processed: 0, more: false, down: false }, 200);
  }

  const row = queue[0];
  const more = queue.length > 1;

  const image = await loadImage(row.image_url);
  if (!image.ok) {
    // The file is gone or unreadable, so no moderator will ever clear it. Leave
    // it pending rather than rejecting art over a storage fault, and move on.
    return json({ processed: 0, skipped: true, more }, 200);
  }

  const cfg = { resource: false, prompt: MODERATION_PROMPT, categories: CATEGORIES };
  const verdict = await moderateWithGemini(env, image.b64, image.type, cfg);
  const call = decide(verdict, false);

  // Still down. Nothing changes, and the artwork keeps its place in the queue.
  if (call.deferred) return json({ processed: 0, down: true, more: true }, 200);

  const audit = {
    model: env.GEMINI_MODEL || 'gemini-flash-latest',
    checked_at: new Date().toISOString(),
    queued: true,
    images: [{
      i: 0,
      allow: !!verdict.allow,
      artwork: !!verdict.artwork,
      ai_generated: !!verdict.ai_generated,
      rating: verdict.rating || null,
      quality: verdict.quality || null,
      category: verdict.category || null,
      reason: verdict.reason || null,
      confidence: verdict.confidence ?? null,
      decision: call.pass ? 'pass' : call.code
    }]
  };
  const rating = (verdict.rating === 'MATURE') ? 'MATURE' : 'SAFE';

  const patch = call.pass
    ? { status: 'approved', content_rating: rating, is_mature: rating === 'MATURE',
        ai_moderation: audit }
    : { status: 'rejected', ai_moderation: { ...audit, code: call.code,
        reason: MESSAGES[call.code] || MESSAGES.UNCLEAR } };

  try {
    // Filtered on the status it still has, so two ticks racing the same artwork
    // cannot both apply a verdict.
    await sbService(env, `/artworks?id=eq.${encodeURIComponent(row.id)}&status=eq.pending`,
      { method: 'PATCH', body: JSON.stringify(patch) });
  } catch {
    return json({ error: 'Could not record the verdict.' }, 503);
  }

  context.waitUntil(logVerdict(env, row, call, rating, verdict).catch(() => {}));

  // Deliberately opaque: the caller is whoever had the site open, not the artist,
  // so the response says a tick happened and nothing about whose work it was.
  return json({ processed: 1, more, down: false }, 200);
}

async function loadImage(url) {
  if (!url) return { ok: false, reason: 'no image' };
  let res;
  try { res = await fetch(url); } catch { return { ok: false, reason: 'unreachable' }; }
  if (!res.ok) return { ok: false, reason: 'http ' + res.status };

  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.includes(type)) return { ok: false, reason: 'type ' + (type || 'unknown') };

  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0) return { ok: false, reason: 'empty' };
  if (buf.byteLength > MAX_BYTES) return { ok: false, reason: 'too large' };

  return { ok: true, b64: toBase64(buf), type };
}

function logVerdict(env, row, call, rating, verdict) {
  return sbService(env, '/moderation_logs', {
    method: 'POST',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({
      user_id: row.user_id,
      allowed: call.pass,
      code: call.pass ? 'ARTWORK_OK' : call.code,
      rating,
      confidence: verdict.confidence ?? null,
      audit: { queued: true, artwork_id: row.id, images: [{ i: 0, ...verdict }] }
    })
  });
}
