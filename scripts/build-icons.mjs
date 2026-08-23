#!/usr/bin/env node
/* Builds the whole icon set from one geometry.
 *
 * The logo is FOUR slanted bars — black, red, black, red — each drawn three
 * times: a dark "side" bar offset down-right to give the mark its thickness,
 * the gradient face over it, and a white gloss over that. The outer pair are
 * shorter than the inner pair, so the tops and bottoms fall on an arc and the
 * mark reads as a rhythm rather than a fence. Nothing here is a traced bitmap,
 * so every output is generated rather than resampled: the SVGs are the artwork
 * itself and the PNGs are rendered at their exact size, which is why none of
 * them soften when a browser scales them.
 *
 * The bars are parallel and share one slope, 3:11. Every coordinate below is
 * derived from that, the pitch between bar centres, and each bar's half-height
 * — nothing is a hand-placed number, so the mark cannot drift out of true.
 *
 * Three framings come out of the same drawing, and the difference between
 * them is one number:
 *
 *   ICON (0.72)     the app icons and the apple touch icon, where the
 *                   platform draws its own rounded corner and the margin has
 *                   to be there for it.
 *   TAB  (0.82)     the tab favicon. A 16px icon has no rounding to clear
 *                   and needs every pixel it can get, so it sits larger.
 *   SAFE (0.58)     Android maskable. It is cropped to a circle by something
 *                   that is not us — an adaptive icon mask — and the mark has
 *                   to survive the worst crop, which is a circle of radius 40%
 *                   of the canvas, so 409.6 units on this one.
 *
 * SAFE is not a taste decision and it moved when the mark did. Four bars are
 * far wider than two: the inked circumradius about the mark's own centre is
 * 676.5 units where the old pair measured 540. 676.5 × 0.58 = 392, inside
 * 409.6. At the old 0.72 it would have been 487 and an installed Android icon
 * would have had the outer bars sliced off — silently, because nothing in a
 * build renders an adaptive mask.
 *
 * The repo has no package.json and nothing here is needed to deploy — the
 * outputs are committed. This is the recipe for regenerating them, and it is
 * the only thing that should ever write those files by hand.
 *
 * Run: npm i sharp && node scripts/build-icons.mjs
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = (name) => join(root, name);

/* framing */
const ICON = 0.72;
const TAB  = 0.82;
const SAFE = 0.58;

/* ---- the drawing, from four numbers ---------------------------------------
   SLOPE is the lean, as run over rise. PITCH is the distance between bar
   centres. WIDTH is the stroke. LIFT is how far the side bar sits down and to
   the right of the face, which is the whole of the 3D.

   WIDTH is 176 rather than the 182 the mark was drawn at, and that is for the
   favicon: four bars across the mark means the gap between them is what has to
   survive being 16 pixels wide, and at 182 the gap was 60 units against a 242
   pitch — a quarter of a pixel at that size, which rounds away and renders the
   mark as one solid slab. 176 buys the gap back without the bars reading thin
   anywhere else. */
const SLOPE = 3 / 11;
const PITCH = 242.5;
const WIDTH = 176;
const LIFT  = { x: 10, y: 8 };

/* Bar centres sit on y = 512. Each bar is named by its centre x and its half
   height; the horizontal half follows from the slope, so every bar is parallel
   by construction rather than by four pairs of numbers agreeing. The outer
   pair are shorter, which is what puts the ends on an arc. */
const MID_Y = 512;
const BARS = [
  { cx: 0 * PITCH, half: 264, tone: 'Blk' },
  { cx: 1 * PITCH, half: 330, tone: 'Red' },
  { cx: 2 * PITCH, half: 330, tone: 'Blk' },
  { cx: 3 * PITCH, half: 264, tone: 'Red' },
];

/* Top and bottom of a bar's centre line. Top first: the face gradients run
   from it, so "offset 0" means the lit end on every bar. */
const ends = (b) => ({
  x1: b.cx + SLOPE * b.half, y1: MID_Y - b.half,
  x2: b.cx - SLOPE * b.half, y2: MID_Y + b.half,
});

/* The centre of the INKED mark, which is what the framing transform pivots on.
   Computed rather than measured: the stroke reaches WIDTH/2 past the centre
   line in every direction (the caps are round, so the extreme point of a bar
   is a half-width circle about its end), and the side bars push the far edges
   out by LIFT. Getting this by eye is how a mark ends up a few units off centre
   in every icon at once. */
const inked = (() => {
  const r = WIDTH / 2;
  const xs = BARS.flatMap((b) => { const e = ends(b); return [e.x1, e.x2]; });
  const ys = BARS.flatMap((b) => { const e = ends(b); return [e.y1, e.y2]; });
  const minX = Math.min(...xs) - r,  maxX = Math.max(...xs) + r + LIFT.x;
  const minY = Math.min(...ys) - r,  maxY = Math.max(...ys) + r + LIFT.y;
  return {
    minX, maxX, minY, maxY,
    cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
    radius: Math.hypot((maxX - minX) / 2, (maxY - minY) / 2),
  };
})();
const CX = inked.cx;
const CY = inked.cy;

/* The mark must survive the maskable crop. Checked here rather than trusted,
   because the failure is invisible until somebody installs the app. */
if (SAFE * inked.radius > 409.6) {
  throw new Error(`SAFE ${SAFE} puts the mark ${(SAFE * inked.radius).toFixed(1)} units ` +
    `from centre; the maskable safe circle is 409.6. Lower SAFE to ` +
    `${(409.6 / inked.radius).toFixed(3)} or less.`);
}

/* Every id is prefixed. These files get inlined into pages that hold other
   SVGs, and an id collision in a document is silent — the first `redBase`
   wins and the second logo renders in someone else's colours.

   ONE GRADIENT PER BAR, not one per colour. A single span shared by both red
   bars is a span measured across the whole mark, so the left bar takes the
   light end of it and the right bar the dark end, and four bars lit from four
   different directions read as flat printed stripes. Each bar's face runs from
   its own top to its own bottom, so the light falls the same way down every
   one of them and the mark reads as four solid objects under one lamp. */
const TONES = {
  /* Red stays RED down the whole bar. The face gradient is for form, not for
     drama: enough range to read as a lit cylinder, not so much that the top is
     pink and the bottom is brown. The first pass here ran #ff8377 to #720000 —
     a five-stop span carried over from the two-bar mark — and four bars of it
     side by side read as candy rather than as a logo. */
  Red: { face: [[0, '#ff4d3f'], [0.35, '#ee1111'], [0.72, '#cc0000'],
                [1, '#8e0000']],
         side: [[0, '#7a0000'], [1, '#340000']],
         gloss: 0.18 },
  /* Black needs less range still: below about #101010 the bar stops having a
     surface and becomes a hole, and the side bar underneath is already darker
     than anything the face reaches. */
  Blk: { face: [[0, '#4a4a4a'], [0.35, '#242424'], [0.72, '#111111'],
                [1, '#050505']],
         side: [[0, '#171717'], [1, '#000000']],
         gloss: 0.1 },
};

const stops = (list) =>
  list.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');

/* Two decimals is finer than a thousandth of the canvas. Emitting the raw
   float puts 538.4000000000001 in the file, which is noise in a diff and noise
   in the bytes. */
const n = (v) => String(Math.round(v * 100) / 100);

/* The gloss is a SHORT wash at the very top of a bar, and it runs straight
   down rather than along the bar: it stands in for a sky reflection on a
   rounded edge, and a sky does not lean.

   Short and faint on purpose. At 0.6 over the top half — which is where this
   started — the reflection stops being a highlight and becomes the colour of
   the bar, and the mark reads as glossy plastic. A third of the bar at a fifth
   of the strength is the difference between "this has a surface" and "this is
   shiny". */
const GLOSS_RUN = 0.3;
const defs = BARS.map((b, i) => {
  const e = ends(b);
  const t = TONES[b.tone];
  return `
    <linearGradient id="dzFace${i}" gradientUnits="userSpaceOnUse" x1="${n(e.x1)}" y1="${n(e.y1)}" x2="${n(e.x2)}" y2="${n(e.y2)}">
      ${stops(t.face)}
    </linearGradient>
    <linearGradient id="dzSide${i}" gradientUnits="userSpaceOnUse" x1="${n(e.x1)}" y1="${n(e.y1)}" x2="${n(e.x2)}" y2="${n(e.y2)}">
      ${stops(t.side)}
    </linearGradient>
    <linearGradient id="dzGloss${i}" gradientUnits="userSpaceOnUse" x1="0" y1="${n(e.y1)}" x2="0" y2="${n(e.y1 + (e.y2 - e.y1) * GLOSS_RUN)}">
      <stop offset="0" stop-color="#ffffff" stop-opacity="${t.gloss}"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>`;
}).join('');

/* The shadow, spelled out as the five primitives instead of feDropShadow.
   feDropShadow is one line and does the same thing, but it is SVG 2 and
   Safari did not ship it until 15.4 — on anything older the shadow is not
   weaker, the whole filter fails and the mark disappears. This construction
   is SVG 1.1 and there is no renderer in circulation that does not have it.
   Two details are load-bearing:
     filterUnits="userSpaceOnUse" — the default is a fraction of the object
       bounding box, and the bounding box of a <line> is the line, with no
       stroke in it, so every engine would size the blur region off a box that
       does not contain the thing being blurred. Stated in user units there is
       nothing left to disagree about — and the units come from the geometry
       above rather than a typed rectangle, because the mark got half as wide
       again and a hand-set region would have clipped the shadow off the outer
       bars without anything failing.
     color-interpolation-filters="sRGB" — the spec default is linearRGB,
       which is the correct answer to a question nobody asked and renders a
       visibly different grey between engines. Pinned. */
const BLUR = 13;
const CAST = { x: 7, y: 12 };
/* The inked BOX, plus the cast offset, plus three sigmas of blur each way —
   three sigmas is where a Gaussian is done to within a thousandth, so nothing
   visible is clipped and nothing invisible is rasterised. Off the box and not
   off the circumradius: the mark is 1057 wide and 844 tall, and a square of
   the diagonal would have the renderer blurring a region two-thirds larger
   than the one the shadow can reach. */
const region = (() => {
  const pad = BLUR * 3;
  const x = Math.floor(inked.minX - pad);
  const y = Math.floor(inked.minY - pad);
  return {
    x, y,
    w: Math.ceil(inked.maxX + CAST.x + pad - x),
    h: Math.ceil(inked.maxY + CAST.y + pad - y),
  };
})();
const shadow = `
    <filter id="dzShadow" filterUnits="userSpaceOnUse" x="${region.x}" y="${region.y}" width="${region.w}" height="${region.h}" color-interpolation-filters="sRGB">
      <feOffset in="SourceAlpha" dx="${CAST.x}" dy="${CAST.y}" result="dzOff"/>
      <feGaussianBlur in="dzOff" stdDeviation="${BLUR}" result="dzBlur"/>
      <feFlood flood-color="#000000" flood-opacity="0.2" result="dzInk"/>
      <feComposite in="dzInk" in2="dzBlur" operator="in" result="dzCast"/>
      <feMerge><feMergeNode in="dzCast"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>`;

/* Every stroke, in paint order: side, face, gloss, one bar at a time.
   Bar by bar rather than all the sides then all the faces, so a bar's own
   shadow is never drawn over the bar in front of it. */
const bars = BARS.map((b, i) => {
  const e = ends(b);
  return `
    <line x1="${n(e.x1 + LIFT.x)}" y1="${n(e.y1 + LIFT.y)}" x2="${n(e.x2 + LIFT.x)}" y2="${n(e.y2 + LIFT.y)}" stroke="url(#dzSide${i})" stroke-width="${WIDTH}"/>
    <line x1="${n(e.x1)}" y1="${n(e.y1)}" x2="${n(e.x2)}" y2="${n(e.y2)}" stroke="url(#dzFace${i})" stroke-width="${WIDTH}"/>
    <line x1="${n(e.x1)}" y1="${n(e.y1)}" x2="${n(e.x2)}" y2="${n(e.y2)}" stroke="url(#dzGloss${i})" stroke-width="${WIDTH}"/>`;
}).join('');

/* One drawing, three ways of framing it.
   `size` is the viewBox edge, `scale` the framing, `ground` what the mark sits
   on — a full-bleed white square for the icons, and NOTHING for the brand
   file. There was a fourth: a navy disc for the assistant's avatar, which went
   when the assistant did.

   logo.svg carries no ground on purpose. It is the file a person opens when
   they want the logo, and a baked white rectangle is how a logo ends up as a
   white box on somebody's dark slide. The icons that need an opaque ground get
   one from flatten() below, which was already supplying white, so dropping the
   rectangle changes nothing about what ships as a PNG. favicon.svg keeps its
   ground: it is served to a browser as-is and nothing composites it, so a
   transparent one would put black bars on a dark tab strip. */
function svg({ size = 1024, scale = ICON, ground = 'square', shadowed = true, title }) {
  const half = size / 2;
  const bg =
    ground === 'none' ? ''
    : `<rect x="0" y="0" width="${size}" height="${size}" fill="#ffffff"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${title}" shape-rendering="geometricPrecision">
  <title>${title}</title>
  <defs>${defs}${shadowed ? shadow : ''}
  </defs>
  ${bg}
  <g transform="translate(${half},${half}) scale(${scale}) translate(${n(-CX)},${n(-CY)})"${shadowed ? ' filter="url(#dzShadow)"' : ''} stroke-linecap="round">${bars}
  </g>
</svg>
`;
}

/* The two SVGs that ship.
   logo.svg is the brand file: the same mark and framing the icons use, with no
   ground behind it. favicon.svg is the same mark framed for a tab and with the
   shadow dropped: at 16px a 13px blur is a grey smear over a third of the icon, and
   the offset side bars already carry the depth on their own. */
const logoSvg = svg({ scale: ICON, ground: 'none', title: 'DigiArtz' });
const iconSvg = svg({ scale: ICON, title: 'DigiArtz' });
const tabSvg = svg({ scale: TAB, shadowed: false, title: 'DigiArtz' });
const maskSvg = svg({ scale: SAFE, title: 'DigiArtz' });

writeFileSync(out('logo.svg'), logoSvg);
writeFileSync(out('favicon.svg'), tabSvg);

/* Rendering. density is what librsvg rasterises the document at, and the
   document declares itself 1024px wide, so density = 96 × target / 1024
   renders the vectors natively at the target instead of drawing 1024px and
   throwing pixels away. A 16px icon comes out of the geometry, not out of a
   downscale, which is the whole point of keeping this a build step. */
const render = (source, px) =>
  sharp(Buffer.from(source), { density: Math.max(1, Math.round((96 * px) / 1024)) })
    .resize(px, px, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    // palette:false is not the default it looks like. Every knob sharp offers
    // for PNG size — effort, colours, quality — turns the encoder into an
    // 8-bit quantiser, and this mark is six overlapping gradients: 256 colours
    // puts visible bands across every bar. Truecolour, and lean on zlib.
    .png({ compressionLevel: 9, palette: false });

/* Opaque, for everything the platform will not composite for us. iOS in
   particular fills an alpha channel it did not expect with black. */
const flat = (source, px) => render(source, px).flatten({ background: '#ffffff' });

await flat(iconSvg, 192).toFile(out('icon-192.png'));
await flat(iconSvg, 512).toFile(out('icon-512.png'));
await flat(iconSvg, 180).toFile(out('apple-touch-icon.png'));
await flat(maskSvg, 512).toFile(out('icon-maskable-512.png'));

/* favicon.ico, five sizes deep.
 *
 * The .ico is the one icon a browser may fetch without being told to — a bare
 * GET /favicon.ico, no <link> involved — so it is the floor for every client
 * that ignores or never sees the rest of the set, and it has to answer at
 * whatever size is asked for. 128 is there because Google wants a square
 * larger than 48 and reads link tags rather than the manifest.
 *
 * Payloads are PNG, not BMP. An .ico may carry either; PNG is what every
 * browser and every Windows since Vista reads, and it skips the AND mask that
 * BMP-in-ICO needs for transparency.
 */
const ICO_SIZES = [16, 32, 48, 64, 128];
const frames = await Promise.all(
  ICO_SIZES.map((px) => flat(tabSvg, px).toBuffer())
);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);                 // reserved
header.writeUInt16LE(1, 2);                 // 1 = icon
header.writeUInt16LE(frames.length, 4);

const dir = Buffer.alloc(16 * frames.length);
let offset = header.length + dir.length;
frames.forEach((png, i) => {
  const at = i * 16;
  // 0 means 256 in this field. Nothing here is 256, but the encoding is the
  // encoding and a future size should not need this line rewritten.
  dir.writeUInt8(ICO_SIZES[i] >= 256 ? 0 : ICO_SIZES[i], at);
  dir.writeUInt8(ICO_SIZES[i] >= 256 ? 0 : ICO_SIZES[i], at + 1);
  dir.writeUInt8(0, at + 2);                // palette size, 0 for truecolour
  dir.writeUInt8(0, at + 3);                // reserved
  dir.writeUInt16LE(1, at + 4);             // colour planes
  dir.writeUInt16LE(32, at + 6);            // bits per pixel
  dir.writeUInt32LE(png.length, at + 8);
  dir.writeUInt32LE(offset, at + 12);
  offset += png.length;
});

writeFileSync(out('favicon.ico'), Buffer.concat([header, dir, ...frames]));

console.log('logo.svg, favicon.svg, favicon.ico (%s), icon-192, icon-512, icon-maskable-512, apple-touch-icon',
  ICO_SIZES.join('/'));
