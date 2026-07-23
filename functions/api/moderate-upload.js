// ============================================================
// DigiArtz — AI Moderation Gate (moderation ONLY)
// Path in repo:  functions/api/moderate-upload.js
//
// Checks images with Gemini Vision BEFORE the existing upload flow
// runs. Does NOT touch S3 or Supabase — the existing s3Upload()
// presigned flow and client-side insert in doPfUp() stay as-is.
//
// Request:  POST multipart/form-data
//   Authorization: Bearer <supabase access token>
//   files: 1–6 images (cover first, then extra pages)
//
// Response: { allowed, rating, reason, audit }
//   allowed  true only if EVERY image is approved artwork
//   rating   worst rating across images: 'SAFE' | 'MATURE'
//   audit    compact per-image verdicts for the ai_moderation column
//
// Env vars (Pages -> Settings -> Environment variables):
//   GEMINI_API_KEY
//   SUPABASE_URL          https://tmqzqlrpjpydiftlrzmj.supabase.co
//   SUPABASE_ANON_KEY
// Optional:
//   GEMINI_MODEL          default "gemini-flash-latest" (pin e.g. "gemini-3.5-flash" if desired)
// ============================================================

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 6;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MIN_CONFIDENCE = 0.6;

// Category codes Gemini may return. User-facing text NEVER comes from the
// model — it is looked up in MESSAGES below, so wording stays professional
// and internal checks are never leaked.
const CATEGORIES = [
  'ARTWORK_OK','SELFIE','MIRROR_SELFIE','FAMILY_PHOTO','GROUP_PHOTO','COUPLE_PHOTO',
  'BABY_PHOTO','PET_PHOTO','CASUAL_PHOTO','TRAVEL_PHOTO','FOOD_PHOTO','DRINK_PHOTO',
  'PRODUCT_PHOTO','VEHICLE_PHOTO','HOUSE_PHOTO','INTERIOR_PHOTO','LANDSCAPE_PHOTO',
  'CITY_PHOTO','STREET_PHOTO','BUILDING_PHOTO','OBJECT_PHOTO','CHAT_SCREENSHOT',
  'GAME_SCREENSHOT','APP_SCREENSHOT','SOCIAL_SCREENSHOT','SCREEN_RECORDING','ID_CARD',
  'PASSPORT','DRIVING_LICENCE','BANK_DOCUMENT','MEDICAL_DOCUMENT','SCHOOL_DOCUMENT',
  'OFFICE_DOCUMENT','LEGAL_DOCUMENT','RECEIPT','BILL','INVOICE','SALARY_SLIP',
  'TAX_DOCUMENT','LOAN_DOCUMENT','INSURANCE_PAPER','QR_CODE','BARCODE','ADVERTISEMENT',
  'FLYER','SPAM_IMAGE','BLANK_IMAGE','LOW_QUALITY','TEXT_ONLY','NOT_ARTWORK',
  'ADULT_CONTENT','PROHIBITED_CONTENT','UNCLEAR'
];

const MESSAGES = {
  SELFIE:            'A selfie or personal photograph was detected. DigiArtz accepts original artwork only.',
  MIRROR_SELFIE:     'A mirror selfie was detected. Please upload an original artwork instead.',
  FAMILY_PHOTO:      'A family photograph was detected. DigiArtz accepts artwork only.',
  GROUP_PHOTO:       'A group photograph was detected. Please upload original artwork.',
  COUPLE_PHOTO:      'A couple photograph was detected. DigiArtz accepts artwork only.',
  BABY_PHOTO:        'A baby photograph was detected. Please upload an artwork instead.',
  PET_PHOTO:         'A pet photograph was detected. DigiArtz accepts original artwork only.',
  CASUAL_PHOTO:      'A real-world camera photo was detected. Please upload artwork only.',
  TRAVEL_PHOTO:      'A travel photograph was detected. DigiArtz accepts artwork only.',
  FOOD_PHOTO:        'A food photograph was detected. Please upload an artwork instead.',
  DRINK_PHOTO:       'A drink or beverage photograph was detected. DigiArtz accepts artwork only.',
  PRODUCT_PHOTO:     'A product photograph was detected. Please upload original artwork.',
  VEHICLE_PHOTO:     'A vehicle photograph was detected. DigiArtz accepts artwork only.',
  HOUSE_PHOTO:       'A house photograph was detected. Please upload artwork instead.',
  INTERIOR_PHOTO:    'An interior photograph was detected. DigiArtz accepts original artwork only.',
  LANDSCAPE_PHOTO:   'A landscape photograph was detected. Please upload an artwork instead.',
  CITY_PHOTO:        'A city photograph was detected. DigiArtz accepts artwork only.',
  STREET_PHOTO:      'A street photograph was detected. Please upload original artwork.',
  BUILDING_PHOTO:    'A building photograph was detected. DigiArtz accepts artwork only.',
  OBJECT_PHOTO:      'An object photograph was detected. Please upload artwork instead.',
  CHAT_SCREENSHOT:   'A chat screenshot was detected. DigiArtz accepts original artwork only.',
  GAME_SCREENSHOT:   'A game screenshot was detected. Please upload an artwork instead.',
  APP_SCREENSHOT:    'An app screenshot was detected. DigiArtz accepts artwork only.',
  SOCIAL_SCREENSHOT: 'A social media screenshot was detected. Please upload original artwork.',
  SCREEN_RECORDING:  'Screen-recording content was detected. DigiArtz accepts artwork only.',
  ID_CARD:           'An ID card or identity document was detected. DigiArtz accepts artwork only.',
  PASSPORT:          'A passport or travel document was detected. Please upload artwork instead.',
  DRIVING_LICENCE:   'A driving licence was detected. DigiArtz accepts original artwork only.',
  BANK_DOCUMENT:     'A bank document was detected. Please upload artwork instead.',
  MEDICAL_DOCUMENT:  'A medical document was detected. DigiArtz accepts artwork only.',
  SCHOOL_DOCUMENT:   'A school document was detected. Please upload original artwork.',
  OFFICE_DOCUMENT:   'An office document was detected. DigiArtz accepts artwork only.',
  LEGAL_DOCUMENT:    'A legal document was detected. Please upload an artwork instead.',
  RECEIPT:           'A receipt was detected. DigiArtz accepts original artwork only.',
  BILL:              'A bill or payment statement was detected. Please upload artwork instead.',
  INVOICE:           'An invoice was detected. DigiArtz accepts artwork only.',
  SALARY_SLIP:       'A salary slip or payslip was detected. Please upload original artwork.',
  TAX_DOCUMENT:      'A tax document was detected. DigiArtz accepts artwork only.',
  LOAN_DOCUMENT:     'A loan document was detected. Please upload an artwork instead.',
  INSURANCE_PAPER:   'An insurance document was detected. DigiArtz accepts original artwork only.',
  QR_CODE:           'A QR code was detected. Please upload artwork instead.',
  BARCODE:           'A barcode was detected. DigiArtz accepts original artwork only.',
  ADVERTISEMENT:     'An advertisement or promotional image was detected. Please upload artwork instead.',
  FLYER:             'A flyer or poster was detected. DigiArtz accepts artwork only.',
  SPAM_IMAGE:        'The image was flagged as spam or irrelevant content. Please upload original artwork.',
  BLANK_IMAGE:       'The uploaded image appears to be blank.',
  LOW_QUALITY:       'The image is too low quality or could not be processed.',
  TEXT_ONLY:         'Images containing primarily text are not accepted as artwork.',
  NOT_ARTWORK:       'The uploaded image does not appear to be artwork. DigiArtz accepts original artistic creations only.',
  ADULT_CONTENT:     'The image contains adult content, which is not permitted on DigiArtz.',
  PROHIBITED_CONTENT:'The image contains prohibited content and cannot be uploaded.',
  UNCLEAR:           'We could not confirm this image as original artwork. Please upload a clearer artwork image.'
};

// ============================================================
// RESOURCE / MARKETPLACE MODE (mode=resource | mode=marketplace)
// The downloadable file itself (a .abr brush, .zip template, .blend
// model, font, etc.) is NOT an image, so Gemini can't read it. What
// gets judged is the PREVIEW image the uploader attaches — the same
// picture that ends up on the card. A separate prompt + code set is
// used because a resource preview legitimately shows things the
// artwork moderator rejects: website/UI mockups, code screenshots,
// 3D renders, product mockups.
// ============================================================
const RESOURCE_CATEGORIES = [
  'RESOURCE_OK','AI_GENERATED','PERSON_PHOTO','NSFW_CONTENT','GORE_CONTENT',
  'TEXT_ONLY','SCREENSHOT','DOCUMENT','SPAM_IMAGE','BLANK_IMAGE','LOW_QUALITY',
  'NOT_RESOURCE','PROHIBITED_CONTENT','UNCLEAR'
];

const RESOURCE_MESSAGES = {
  AI_GENERATED:      'The preview looks AI-generated. DigiArtz resources need a real preview of the asset (a 3D render is fine — AI-generated art is not).',
  PERSON_PHOTO:      'A real photograph of a person was detected. Please use a preview that shows the resource itself.',
  NSFW_CONTENT:      'The preview contains adult or NSFW content, which is not permitted on DigiArtz.',
  GORE_CONTENT:      'The preview contains graphic or violent content and cannot be uploaded.',
  TEXT_ONLY:         'The preview is mostly plain text. Please show what the resource actually looks like (code snippets are fine).',
  SCREENSHOT:        'A chat, forum, social, or game screenshot was detected. Please use a preview of the resource itself.',
  DOCUMENT:          'A document or form was detected. Please use a preview image of your resource.',
  SPAM_IMAGE:        'The preview was flagged as spam or promotional content. Please upload a genuine preview.',
  BLANK_IMAGE:       'The preview image appears to be blank.',
  LOW_QUALITY:       'The preview is too low quality or could not be processed.',
  NOT_RESOURCE:      'This does not look like a usable resource preview. Show the brush, texture, template, font, model, or asset.',
  PROHIBITED_CONTENT:'The preview contains prohibited content and cannot be uploaded.',
  UNCLEAR:           'We could not confirm this as a valid resource preview. Please upload a clearer preview image.'
};

const RESOURCE_PROMPT = `You are the resource preview moderator for DigiArtz, a digital creator community.

The user is uploading a downloadable creative RESOURCE (a brush, texture, font, template, code pack, 3D model, etc.). You are shown its PREVIEW IMAGE only — judge whether that preview is acceptable.

Step 1: Resource Preview Check

ACCEPT the preview when it shows a usable digital asset a creator would download and use, for example:
- brushes, brush packs, stamp/brush stroke sheets, textures, patterns, seamless tiles, materials
- fonts, typefaces, lettering or type specimens
- website templates, landing-page or UI mockups, app UI kits, dashboard designs, design systems
- code, code snippets, or syntax-highlighted code screenshots offered as a developer resource
- 3D models and renders from 3D software (Blender, Maya, Cinema4D, ZBrush, etc.), sculpts, wireframes, turntables
- icon sets, vector asset sheets, logo/template kits, mockup scenes, device/product mockups
- wallpapers, backgrounds, presets, LUTs, grading previews, plugin or tool UI previews

The bias: if it plausibly shows a downloadable creative asset, ACCEPT it (resource=true).

Step 2: Always-reject rules (set resource=false and the matching category)
- AI_GENERATED — the preview is an AI-generated / generative-diffusion image (Midjourney, Stable Diffusion, DALL·E, etc.). IMPORTANT: a 3D RENDER from Blender/Maya/C4D/ZBrush is NOT AI-generated and must be ACCEPTED — do not confuse rendered CGI with AI art. Only flag AI_GENERATED when it genuinely looks like generative AI art.
- PERSON_PHOTO — a real photograph of a person (selfie, portrait, casual camera photo of people).
- NSFW_CONTENT — sexual, adult, or explicit content.
- GORE_CONTENT — graphic gore or extreme violence.
- TEXT_ONLY — the preview is just plain paragraph text or a wall of writing with no design or code purpose. (Syntax-highlighted CODE is NOT text-only — accept it.)
- SCREENSHOT — a chat, forum, social-media, or game screenshot that is not itself the resource.
- DOCUMENT — an ID, receipt, invoice, form, or official document.
- SPAM_IMAGE — an advertisement, promo, or spam image.
- BLANK_IMAGE / LOW_QUALITY — blank, corrupted, or unusably low-resolution.
- NOT_RESOURCE — clearly not any kind of usable resource preview, with no better code.

Always reject regardless of anything else (PROHIBITED_CONTENT): child sexual content, bestiality, extreme gore, terrorist or extremist content, malware/phishing images, illegal content.

Step 3: Rating — SAFE, MATURE, or ADULT (same meaning as art). SAFE and MATURE are both accepted; only ADULT (explicit) is rejected downstream.

Step 4: Quality — GOOD unless blank, corrupted, extremely blurry, or unusably low resolution. Deliberate style (pixel art, low-poly, minimal) is NOT a quality failure.

Return JSON: allow (true only if it is an acceptable SAFE resource preview that is not AI-generated), resource (bool), rating, ai_generated (bool), quality, category (one code from the allowed list), reason (short internal note), confidence (0 to 1).`;

const MODERATION_PROMPT = `You are the artwork upload moderator for DigiArtz, a digital art community.

Decide whether a user-uploaded image should be allowed or rejected.

Step 1: Artwork Check

DigiArtz accepts artwork in these categories, so ACCEPT images of this kind:
characters, anime, manga, comic pages, fan art, chibi, sketches, illustrations, concept art, AI-generated art, digital art, traditional art (pencil, ink, watercolor, oil, acrylic), abstract art, typography and lettering art, poster art designs, logo designs, icon designs, wallpaper art, cars, bikes, trucks, buses, aircraft, ships, robots, mecha, weapon designs, fantasy, dragons, monsters, mythology, sci-fi, space art, nature art, animal art, bird art, marine life art, landscape paintings, scenery art, cityscape art, architecture art, building art, interior design art, food art, flower art, tree art, patterns, 3D art and stylized renders, pixel art, aesthetic art, sculptures and handcrafted artwork.

CRITICAL clarifications — do NOT reject these:
- FAN ART IS ALLOWED. Hand-drawn, painted, or digitally created artwork depicting existing anime, manga, movie, game, or cartoon characters is accepted. Only reject direct reposts of OFFICIAL media: unmodified screencaps from anime or games, official posters, movie stills, scanned published manga pages, or official promotional images.
- AI-GENERATED ART IS ALLOWED. DigiArtz has an AI Art category. Accept AI-generated or AI-assisted images when they are artistic in nature.
- TYPOGRAPHY AND LETTERING ART IS ALLOWED. Reject only plain documents, screenshots of text, or images that are just unstylized writing.
- LOGO AND ICON DESIGNS ARE ALLOWED as original design work. Reject only reposted logos of real existing brands or companies.
- POSTER ART IS ALLOWED as designed or illustrated work. Reject only real-world commercial advertisements and promotional flyers for actual products, events, or services.
- Artwork depicting realistic people, animals, food, vehicles, buildings, or landscapes is still artwork. A painting or rendering OF a landscape is accepted; a PHOTOGRAPH of a landscape is not.

The bias is: if the image shows artistic rendering of any kind — linework, brushwork, shading, cel shading, painterly texture, pixel art, vector shapes, 3D stylization, sculpting, or crafting — ACCEPT it.

REJECT only when the image is clearly one of these non-art types:
real photographs (selfies, mirror selfies, family or group or couple or baby photos, pet photos, casual camera photos, travel photos, food or drink photos, product photos, photographs of vehicles, houses, rooms, landscapes, cities, streets, buildings, or objects), screenshots (chat, game, app, social media, screen recordings), identity or financial or official documents (ID cards, passports, licences, bank or medical or school or office or legal documents, receipts, bills, invoices, salary slips, tax or loan or insurance papers), QR codes or barcodes as the main content, real-world advertisements or spam, blank images, or plain unstylized text.

Reject as UNCLEAR only when you genuinely cannot tell whether the image is a photograph, screenshot, or document rather than artwork.

Step 2: Content Rating

If the image is artwork, classify it as SAFE, MATURE, or ADULT.

SAFE: no nudity, no sexual content, suitable for all users.
MATURE: artistic nudity, suggestive poses, bikini or swimsuit art, cleavage, mild sensual content, ecchi-style artwork.
ADULT: explicit sexual acts, visible genitals, hardcore pornography, fetish-only content, extreme sexual content.

Always reject regardless of anything else:
child sexual content, bestiality, extreme gore, terrorist or extremist content, malware/phishing images, illegal content.

Step 3: Quality Check

Set quality to BAD only if the image is blank, corrupted, extremely blurry, unusably low resolution, or broken. Artistic style choices (minimalism, rough sketching, low-poly, pixel art) are NOT quality failures.

Step 4: Category Code

Choose exactly ONE category code:
- ARTWORK_OK when the image is approved artwork
- The specific rejection code matching what you see (SELFIE, PET_PHOTO, GAME_SCREENSHOT, ID_CARD, RECEIPT, QR_CODE, and so on)
- BLANK_IMAGE, LOW_QUALITY, or TEXT_ONLY for quality failures
- ADULT_CONTENT when rejected for explicit sexual content
- PROHIBITED_CONTENT for the always-reject cases
- NOT_ARTWORK when it is clearly not artwork but no specific code fits
- UNCLEAR when you cannot confidently classify the image

Decision Rules

- allow = true when the image is artwork per the rules above, the rating is SAFE or MATURE, and quality is acceptable
- allow = false when the image is a photograph, screenshot, or document, when the rating is ADULT, or when an always-reject rule applies

Return your verdict as JSON with fields: allow, artwork, rating, quality, category (one code from the list), reason (short internal note), confidence (0 to 1).`;

// These two are PUBLIC values (they already ship in config.js on the site),
// so hardcoding them here is safe. Env vars still override if ever needed.
const SB_URL_FALLBACK = 'https://tmqzqlrpjpydiftlrzmj.supabase.co';
const SB_ANON_FALLBACK = 'sb_publishable_x7xlsCx-ZsvpNLCXRxyvMw_PsJQT2xy';

export async function onRequestPost(context) {
  const { request, env } = context;
  const SB_URL = env.SUPABASE_URL || SB_URL_FALLBACK;
  const SB_ANON = env.SUPABASE_ANON_KEY || SB_ANON_FALLBACK;
  try {
    // The ONE truly secret variable — fail loudly if it never got set,
    // instead of masking the problem as an image rejection.
    if (!env.GEMINI_API_KEY) {
      return json({ error: 'Server not configured: GEMINI_API_KEY missing in Cloudflare environment variables.' }, 500);
    }

    // ---- Auth: verify the Supabase JWT ----
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Not signed in.' }, 401);

    const userRes = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` }
    });
    if (!userRes.ok) return json({ error: 'Session expired — sign in again.' }, 401);
    const user = await userRes.json();
    if (!user.id) return json({ error: 'Invalid session.' }, 401);

    // ---- Collect files ----
    const form = await request.formData();
    const files = form.getAll('files').filter(f => f instanceof File);
    if (files.length === 0) return json({ error: 'No images received.' }, 400);
    if (files.length > MAX_FILES) return json({ error: `Maximum ${MAX_FILES} images per upload.` }, 400);

    for (const f of files) {
      if (!ALLOWED_TYPES.includes(f.type)) return json({ error: 'Unsupported image format.' }, 400);
      if (f.size === 0) return json({ error: 'Empty or corrupted file.' }, 400);
      if (f.size > MAX_BYTES) return json({ error: 'Each image must be under 10 MB.' }, 400);
    }

    // ---- Pick the moderator: artwork (default) or resource preview ----
    // `mode` is an optional form field. Absent  -> artwork, so the
    // existing artwork upload flow is completely unchanged. resource
    // and marketplace share the resource preview moderator.
    const modeRaw = String(form.get('mode') || 'artwork').toLowerCase();
    const isResource = (modeRaw === 'resource' || modeRaw === 'marketplace');
    const cfg = isResource
      ? { resource: true,  prompt: RESOURCE_PROMPT,   categories: RESOURCE_CATEGORIES }
      : { resource: false, prompt: MODERATION_PROMPT,  categories: CATEGORIES };
    const MSG = isResource ? RESOURCE_MESSAGES : MESSAGES;

    // ---- Moderate every image (parallel Gemini calls) ----
    const verdicts = await Promise.all(files.map(async f => {
      const b64 = toBase64(await f.arrayBuffer());
      return moderateWithGemini(env, b64, f.type, cfg);
    }));

    // ---- Combine: ALL must pass; worst rating wins ----
    let allowed = true;
    let code = 'ARTWORK_OK';
    let reason = 'Approved.';
    let rating = 'SAFE';
    let failIndex = -1;
    const audit = [];

    // Default worst-case code differs per mode.
    code = isResource ? 'RESOURCE_OK' : 'ARTWORK_OK';
    for (let i = 0; i < verdicts.length; i++) {
      const v = verdicts[i];
      // Resources: must be a SAFE, non-AI, good-quality resource preview.
      // Artwork: SAFE or MATURE artwork, good quality (unchanged).
      const pass = isResource
        ? ( v.ok && v.allow === true && v.resource === true &&
            v.ai_generated !== true && v.quality === 'GOOD' &&
            (v.rating === 'SAFE' || v.rating === 'MATURE') &&
            v.confidence >= MIN_CONFIDENCE )
        : ( v.ok && v.allow === true && v.artwork === true &&
            v.quality === 'GOOD' &&
            (v.rating === 'SAFE' || v.rating === 'MATURE') &&
            v.confidence >= MIN_CONFIDENCE );

      if (!pass && allowed) {
        allowed = false;
        failIndex = i;
        // Canonical, professional message — never the model's own wording.
        const okCode = isResource ? 'RESOURCE_OK' : 'ARTWORK_OK';
        code = (v.ok && v.category && v.category !== okCode) ? v.category : 'UNCLEAR';
        if (isResource) {
          if (v.ok && v.ai_generated === true && code === 'RESOURCE_OK') code = 'AI_GENERATED';
          if (v.ok && v.rating === 'ADULT' && code === 'RESOURCE_OK') code = 'NSFW_CONTENT';
        } else if (v.ok && v.rating === 'ADULT' && code === 'ARTWORK_OK') {
          code = 'ADULT_CONTENT';
        }
        reason = (files.length > 1 ? `Image ${i + 1}: ` : '') +
                 (MSG[code] || MSG.UNCLEAR);
      }
      if (v.rating === 'MATURE' && rating === 'SAFE') rating = 'MATURE';

      audit.push({
        i,
        allow: !!v.allow,
        artwork: !!v.artwork,
        resource: !!v.resource,
        ai_generated: !!v.ai_generated,
        rating: v.rating || null,
        quality: v.quality || null,
        category: v.category || null,
        reason: v.reason || null,          // model's internal note — admin/audit only
        confidence: v.confidence ?? null
      });
    }

    // Fire-and-forget decision log — approvals AND rejections — so no
    // verdict is ever invisible. Uses the user's own token (RLS insert-own).
    context.waitUntil(fetch(`${SB_URL}/rest/v1/moderation_logs`, {
      method: 'POST',
      headers: {
        apikey: SB_ANON,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        user_id: user.id,
        allowed,
        code,
        rating,
        confidence: audit[failIndex >= 0 ? failIndex : 0]?.confidence ?? null,
        audit: { images: audit }
      })
    }).catch(() => {}));

    return json({
      allowed,
      rating,
      code,            // admin-facing reason code, e.g. 'SELFIE'
      failIndex,       // which image failed (-1 when approved)
      reason,          // canonical user-facing message
      audit: {
        model: env.GEMINI_MODEL || 'gemini-flash-latest',
        checked_at: new Date().toISOString(),
        images: audit
      }
    }, 200);

  } catch (err) {
    return json({ error: 'Moderation check failed — try again.', detail: String(err).slice(0, 200) }, 500);
  }
}

// ------------------------------------------------------------
// Gemini Vision — structured JSON verdict, fail closed
// ------------------------------------------------------------
async function moderateWithGemini(env, b64, mimeType, cfg) {
  cfg = cfg || { resource: false, prompt: MODERATION_PROMPT, categories: CATEGORIES };
  const model = env.GEMINI_MODEL || 'gemini-flash-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

  // Schema shape depends on the mode. Artwork keeps its exact original
  // fields; resource swaps `artwork` for `resource` and adds the
  // `ai_generated` flag the resource rules key off.
  const props = cfg.resource
    ? {
        allow: { type: 'BOOLEAN' },
        resource: { type: 'BOOLEAN' },
        rating: { type: 'STRING', enum: ['SAFE', 'MATURE', 'ADULT'] },
        ai_generated: { type: 'BOOLEAN' },
        quality: { type: 'STRING', enum: ['GOOD', 'BAD'] },
        category: { type: 'STRING', enum: cfg.categories },
        reason: { type: 'STRING' },
        confidence: { type: 'NUMBER' }
      }
    : {
        allow: { type: 'BOOLEAN' },
        artwork: { type: 'BOOLEAN' },
        rating: { type: 'STRING', enum: ['SAFE', 'MATURE', 'ADULT'] },
        quality: { type: 'STRING', enum: ['GOOD', 'BAD'] },
        category: { type: 'STRING', enum: cfg.categories },
        reason: { type: 'STRING' },
        confidence: { type: 'NUMBER' }
      };
  const required = cfg.resource
    ? ['allow', 'resource', 'rating', 'ai_generated', 'quality', 'category', 'reason', 'confidence']
    : ['allow', 'artwork', 'rating', 'quality', 'category', 'reason', 'confidence'];

  const body = {
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType, data: b64 } },
        { text: cfg.prompt }
      ]
    }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: props, required: required }
    },
    // The moderator must SEE and CLASSIFY mature art rather than have
    // Gemini's default filter silently refuse. Illegal content is still
    // hard-blocked at the API level regardless — surfaces as a blocked
    // response below, which is treated as reject (fail closed).
    safetySettings: [
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
    ]
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      return { ok: false, reason: 'Moderation service unavailable (HTTP ' + res.status + '): ' + errBody.slice(0, 180) };
    }

    const data = await res.json();

    if (data.promptFeedback?.blockReason) {
      return { ok: true, allow: false, artwork: false, resource: false, ai_generated: false,
               rating: 'ADULT', quality: 'BAD', category: 'PROHIBITED_CONTENT',
               reason: 'Blocked by provider safety system.', confidence: 1 };
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return { ok: false, reason: 'Moderation returned no verdict — try again.' };

    const v = JSON.parse(text.replace(/```json|```/g, '').trim());
    return {
      ok: true,
      allow: !!v.allow,
      artwork: !!v.artwork,
      resource: !!v.resource,
      ai_generated: !!v.ai_generated,
      rating: v.rating,
      quality: v.quality,
      category: cfg.categories.includes(v.category) ? v.category : 'UNCLEAR',
      reason: (v.reason || '').slice(0, 300),
      confidence: Number(v.confidence) || 0
    };
  } catch {
    return { ok: false, reason: 'Moderation check failed — try again.' };
  }
}

// ------------------------------------------------------------
function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
