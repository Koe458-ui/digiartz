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
//   GEMINI_MODEL          default "gemini-2.5-flash"
// ============================================================

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 6;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MIN_CONFIDENCE = 0.7;

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

const MODERATION_PROMPT = `You are an artwork upload moderation AI for DigiArtz, a digital art community.

Your task is to inspect a user-uploaded image and decide whether it should be allowed or rejected.

Step 1: Artwork Check

Accept only if the image is primarily original artwork or artistic creation, including digital art, illustrations, paintings, sketches, anime art, manga art, comic art, concept art, pixel art, vector art, stylized 3D renders, sculptures, handcrafted artwork, fantasy art, sci-fi art, abstract art, chibi art, game character artwork, fantasy creature artwork, vehicle concept art, weapon concept art, or architectural artwork.

Reject if the image is primarily any of the following:
selfies, mirror selfies, family photos, group photos, couple photos, baby photos, pet photos, casual camera photos, travel photos, food photos, drink photos, product photos, vehicle photographs, house photographs, room/interior photographs, landscape photographs, city photographs, street photographs, building photographs, object photographs, chat screenshots, game screenshots, app screenshots, social media screenshots, screen recordings, ID cards, passports, driving licences, bank documents, medical documents, school documents, office documents, legal documents, receipts, bills, invoices, salary slips, tax documents, loan documents, insurance papers, QR codes, barcodes, advertisements, flyers, spam images, blank images, random text-only images, memes, logos, icons, UI screenshots, copyrighted media uploads, unrelated AI-generated content, or any other image whose primary purpose is not artwork.

Important:
- Judge the PRIMARY CONTENT of the image.
- If the image is clearly artwork, accept it even if it depicts realistic people, animals, food, buildings, or landscapes.
- A painting or digital rendering OF a landscape is artwork; a PHOTOGRAPH of a landscape is not.
- If the image is uncertain or borderline, prefer reject.

Step 2: Content Rating

If the image is artwork, classify it as SAFE, MATURE, or ADULT.

SAFE: no nudity, no sexual content, suitable for all users.
MATURE: artistic nudity, suggestive poses, bikini or swimsuit art, cleavage, mild sensual content, ecchi-style artwork.
ADULT: explicit sexual acts, visible genitals, hardcore pornography, fetish-only content, extreme sexual content.

Always reject regardless of anything else:
child sexual content, bestiality, extreme gore, terrorist or extremist content, malware/phishing images, illegal content.

Step 3: Quality Check

Set quality to BAD if the image is blank, corrupted, extremely blurry, very low resolution, too heavily compressed, mostly text instead of art, has a watermark covering most of the image, or is unusable or broken. Otherwise GOOD.

Decision Rules

- allow = false if the image is not artwork
- allow = false if the rating is ADULT
- allow = false if quality is BAD
- allow = false if the image is uncertain or borderline
- allow = true only if the image is artwork, the rating is SAFE or MATURE, and quality is GOOD

Step 4: Category Code

Choose exactly ONE category code that best describes the image:
- ARTWORK_OK when the image is approved artwork
- The specific rejection code matching what you see (SELFIE, PET_PHOTO, GAME_SCREENSHOT, ID_CARD, RECEIPT, QR_CODE, and so on)
- BLANK_IMAGE, LOW_QUALITY, or TEXT_ONLY for quality failures
- ADULT_CONTENT when rejected for explicit sexual content
- PROHIBITED_CONTENT for the always-reject cases
- NOT_ARTWORK when it is clearly not artwork but no specific code fits
- UNCLEAR when you cannot confidently classify the image

Return your verdict as JSON with fields: allow, artwork, rating, quality, category (one code from the list), reason (short internal note), confidence (0 to 1).`;

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    // ---- Auth: verify the Supabase JWT ----
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Not signed in.' }, 401);

    const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
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

    // ---- Moderate every image (parallel Gemini calls) ----
    const verdicts = await Promise.all(files.map(async f => {
      const b64 = toBase64(await f.arrayBuffer());
      return moderateWithGemini(env, b64, f.type);
    }));

    // ---- Combine: ALL must pass; worst rating wins ----
    let allowed = true;
    let code = 'ARTWORK_OK';
    let reason = 'Approved.';
    let rating = 'SAFE';
    let failIndex = -1;
    const audit = [];

    for (let i = 0; i < verdicts.length; i++) {
      const v = verdicts[i];
      const pass =
        v.ok && v.allow === true && v.artwork === true &&
        v.quality === 'GOOD' &&
        (v.rating === 'SAFE' || v.rating === 'MATURE') &&
        v.confidence >= MIN_CONFIDENCE;

      if (!pass && allowed) {
        allowed = false;
        failIndex = i;
        // Canonical, professional message — never the model's own wording.
        code = (v.ok && v.category && v.category !== 'ARTWORK_OK') ? v.category : 'UNCLEAR';
        if (v.ok && v.rating === 'ADULT' && code === 'ARTWORK_OK') code = 'ADULT_CONTENT';
        reason = (files.length > 1 ? `Image ${i + 1}: ` : '') +
                 (MESSAGES[code] || MESSAGES.UNCLEAR);
      }
      if (v.rating === 'MATURE' && rating === 'SAFE') rating = 'MATURE';

      audit.push({
        i,
        allow: !!v.allow,
        artwork: !!v.artwork,
        rating: v.rating || null,
        quality: v.quality || null,
        category: v.category || null,
        reason: v.reason || null,          // model's internal note — admin/audit only
        confidence: v.confidence ?? null
      });
    }

    return json({
      allowed,
      rating,
      code,            // admin-facing reason code, e.g. 'SELFIE'
      failIndex,       // which image failed (-1 when approved)
      reason,          // canonical user-facing message
      audit: {
        model: env.GEMINI_MODEL || 'gemini-2.5-flash',
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
async function moderateWithGemini(env, b64, mimeType) {
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

  const body = {
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType, data: b64 } },
        { text: MODERATION_PROMPT }
      ]
    }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          allow: { type: 'BOOLEAN' },
          artwork: { type: 'BOOLEAN' },
          rating: { type: 'STRING', enum: ['SAFE', 'MATURE', 'ADULT'] },
          quality: { type: 'STRING', enum: ['GOOD', 'BAD'] },
          category: { type: 'STRING', enum: CATEGORIES },
          reason: { type: 'STRING' },
          confidence: { type: 'NUMBER' }
        },
        required: ['allow', 'artwork', 'rating', 'quality', 'category', 'reason', 'confidence']
      }
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
    if (!res.ok) return { ok: false, reason: 'Moderation service unavailable — try again.' };

    const data = await res.json();

    if (data.promptFeedback?.blockReason) {
      return { ok: true, allow: false, artwork: false, rating: 'ADULT', quality: 'BAD',
               category: 'PROHIBITED_CONTENT',
               reason: 'Blocked by provider safety system.', confidence: 1 };
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return { ok: false, reason: 'Moderation returned no verdict — try again.' };

    const v = JSON.parse(text.replace(/```json|```/g, '').trim());
    return {
      ok: true,
      allow: !!v.allow,
      artwork: !!v.artwork,
      rating: v.rating,
      quality: v.quality,
      category: CATEGORIES.includes(v.category) ? v.category : 'UNCLEAR',
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
