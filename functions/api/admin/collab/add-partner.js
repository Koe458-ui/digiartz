// POST /api/admin/collab/add-partner   { email }
//
// The + button on the admin panel. Admin and dev only, and that is decided by
// dz_grant_partner() in Postgres rather than here — see functions/api/collab.js
// for why every route in this feature is a name for an action and nothing more.
import { handle } from '../../collab.js';
export const onRequestPost = (ctx) => handle('add-partner', ctx);
