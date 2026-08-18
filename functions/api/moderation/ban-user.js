// POST /api/moderation/ban-user   { userId, reason, note?, days?, unban? }
//
// Staff and partners both reach this, and they do not have the same powers:
// dz_may_moderate() lets staff act on any non-staff member and lets a partner
// act only on an ordinary member — never on an admin, a dev, or a fellow
// partner. Every call that gets through writes a row to audit_log with the
// actor's role frozen onto it.
import { handle } from '../collab.js';

export const onRequestPost = async (ctx) => {
  let unban = false;
  try {
    const body = await ctx.request.clone().json();
    unban = !!(body && body.unban);
  } catch { /* falls through to ban, which then refuses for want of a reason */ }
  return handle(unban ? 'unban' : 'ban', ctx);
};
