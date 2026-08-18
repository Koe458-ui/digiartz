// POST /api/collab/promo-code   { op: 'create' | 'stats', code? }
//
// A partner's own code and their own numbers. There is no partner id to pass:
// dz_promo_create() and dz_promo_mine() both work off auth.uid() and take no
// argument that could name somebody else, which is the whole of the isolation
// rule. Partner 2's figures are not hidden from this endpoint — they are not
// reachable from it.
import { handle } from '../collab.js';

export const onRequestPost = async (ctx) => {
  let op = 'stats';
  try {
    const body = await ctx.request.clone().json();
    if (body && body.op) op = String(body.op);
  } catch { /* an empty body reads the stats, which is the harmless half */ }
  return handle(op === 'create' ? 'promo-create' : 'promo-mine', ctx);
};
