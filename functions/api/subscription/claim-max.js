// POST /api/subscription/claim-max
//
// What the subscription page's pay button becomes for a partner. No amount, no
// provider, no payments row: nothing is being bought. dz_claim_max() refuses
// anyone who is not a partner and anyone who has claimed already.
import { handle } from '../collab.js';
export const onRequestPost = (ctx) => handle('claim-max', ctx);
