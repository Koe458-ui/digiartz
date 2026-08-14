#!/usr/bin/env node
/* Builds the whole icon set from one geometry.
 *
 * The logo is a pair of slanted bars — red and black — each drawn three times:
 * a dark "side" bar offset down-right to give the mark its thickness, the
 * gradient face over it, and a white gloss over that. Nothing here is a
 * traced bitmap, so every output is generated rather than resampled: the SVGs
 * are the artwork itself and the PNGs are rendered at their exact size, which
 * is why none of them soften when a browser scales them.
 *
 * Three framings come out of the same drawing, and the difference between
 * them is one number:
 *
 *   ICON (0.7779)   what the artwork was drawn at. The app icons and the
 *                   apple touch icon, where the platform draws its own
 *                   rounded corner and the margin has to be there for it.
 *   TAB  (0.84)     the tab favicon. A 16px icon has no rounding to clear
 *                   and needs every pixel it can get, so it sits larger.
 *   SAFE (0.72)     Android maskable and the Zeo avatar. Both are cropped to
 *                   a circle by something that is not us — an adaptive icon
 *                   mask, a border-radius — and the mark has to survive the
 *                   worst crop, which is a circle of radius 40% of the
 *                   canvas. The mark's own circumradius is 540 units about
 *                   its centre, so 540 × 0.72 = 389 fits inside 409.6 with
 *                   room to spare.
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
const ICON = 0.7779;
const TAB  = 0.84;
const SAFE = 0.72;

/* The artwork's own coordinate system. The bars are drawn around (448, 586)
   and the group transform below moves that point to the middle of whatever
   canvas we are drawing on, so a framing change is a scale and nothing else. */
const CX = 448;
const CY = 586;

/* Every id is prefixed. These files get inlined into pages that hold other
   SVGs, and an id collision in a document is silent — the first `redBase`
   wins and the second logo renders in someone else's colours. */
const defs = `
    <linearGradient id="dzRedFace" gradientUnits="userSpaceOnUse" x1="100" y1="215" x2="510" y2="945">
      <stop offset="0" stop-color="#ff8377"/><stop offset="0.26" stop-color="#ff3030"/>
      <stop offset="0.55" stop-color="#ef0000"/><stop offset="0.8" stop-color="#c40000"/>
      <stop offset="1" stop-color="#720000"/>
    </linearGradient>
    <linearGradient id="dzRedSide" gradientUnits="userSpaceOnUse" x1="100" y1="215" x2="510" y2="945">
      <stop offset="0" stop-color="#8a0000"/><stop offset="1" stop-color="#2a0000"/>
    </linearGradient>
    <linearGradient id="dzBlkFace" gradientUnits="userSpaceOnUse" x1="370" y1="215" x2="780" y2="945">
      <stop offset="0" stop-color="#5f5f5f"/><stop offset="0.32" stop-color="#2c2c2c"/>
      <stop offset="0.7" stop-color="#111111"/><stop offset="1" stop-color="#000000"/>
    </linearGradient>
    <linearGradient id="dzBlkSide" gradientUnits="userSpaceOnUse" x1="370" y1="215" x2="780" y2="945">
      <stop offset="0" stop-color="#191919"/><stop offset="1" stop-color="#000000"/>
    </linearGradient>
    <linearGradient id="dzGlossR" gradientUnits="userSpaceOnUse" x1="0" y1="110" x2="0" y2="580">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.6"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="dzGlossB" gradientUnits="userSpaceOnUse" x1="0" y1="110" x2="0" y2="580">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.32"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>`;

/* The shadow, spelled out as the five primitives instead of feDropShadow.
   feDropShadow is one line and does the same thing, but it is SVG 2 and
   Safari did not ship it until 15.4 — on anything older the shadow is not
   weaker, the whole filter fails and the mark disappears. This construction
   is SVG 1.1 and there is no renderer in circulation that does not have it.
   Two details are load-bearing:
     filterUnits="userSpaceOnUse" — the default is a fraction of the object
       bounding box, and the bounding box of a <line> is the line, with no
       stroke in it. That box is 486×742 where the inked mark is 680×940, so
       every engine would be sizing the blur region off a box that does not
       contain the thing being blurred. Stated in user units, there is
       nothing left to disagree about.
     color-interpolation-filters="sRGB" — the spec default is linearRGB,
       which is the correct answer to a question nobody asked and renders a
       visibly different grey between engines. Pinned. */
const shadow = `
    <filter id="dzShadow" filterUnits="userSpaceOnUse" x="60" y="60" width="800" height="1080" color-interpolation-filters="sRGB">
      <feOffset in="SourceAlpha" dx="7" dy="12" result="dzOff"/>
      <feGaussianBlur in="dzOff" stdDeviation="13" result="dzBlur"/>
      <feFlood flood-color="#000000" flood-opacity="0.2" result="dzInk"/>
      <feComposite in="dzInk" in2="dzBlur" operator="in" result="dzCast"/>
      <feMerge><feMergeNode in="dzCast"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>`;

/* The six strokes, in paint order: side, face, gloss, per bar. */
const bars = `
    <line x1="221" y1="957" x2="421" y2="227" stroke="url(#dzRedSide)" stroke-width="210"/>
    <line x1="205" y1="945" x2="405" y2="215" stroke="url(#dzRedFace)" stroke-width="210"/>
    <line x1="205" y1="945" x2="405" y2="215" stroke="url(#dzGlossR)" stroke-width="210"/>
    <line x1="491" y1="957" x2="691" y2="227" stroke="url(#dzBlkSide)" stroke-width="210"/>
    <line x1="475" y1="945" x2="675" y2="215" stroke="url(#dzBlkFace)" stroke-width="210"/>
    <line x1="475" y1="945" x2="675" y2="215" stroke="url(#dzGlossB)" stroke-width="210"/>`;

/* One drawing, four ways of framing it.
   `size` is the viewBox edge, `scale` the framing, `ground` the shape the
   mark sits on — a full-bleed square everywhere except the avatar, which is
   a disc so it reads as a circle in a container that is not clipping it. */
function svg({ size = 1024, scale = ICON, ground = 'square', shadowed = true, title }) {
  const half = size / 2;
  const bg = ground === 'disc'
    ? `<circle cx="${half}" cy="${half}" r="${half}" fill="#ffffff"/>`
    : `<rect x="0" y="0" width="${size}" height="${size}" fill="#ffffff"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${title}" shape-rendering="geometricPrecision">
  <title>${title}</title>
  <defs>${defs}${shadowed ? shadow : ''}
  </defs>
  ${bg}
  <g transform="translate(${half},${half}) scale(${scale}) translate(${-CX},${-CY})"${shadowed ? ' filter="url(#dzShadow)"' : ''} stroke-linecap="round">${bars}
  </g>
</svg>
`;
}

/* The two SVGs that ship.
   logo.svg is the brand file and the source every raster below is rendered
   from. favicon.svg is the same mark framed for a tab and with the shadow
   dropped: at 16px a 13px blur is a grey smear over a third of the icon, and
   the offset side bars already carry the depth on their own. */
const logoSvg = svg({ scale: ICON, title: 'DigiArtz' });
const tabSvg = svg({ scale: TAB, shadowed: false, title: 'DigiArtz' });
const maskSvg = svg({ scale: SAFE, title: 'DigiArtz' });
const avatarSvg = svg({ scale: SAFE, ground: 'disc', title: 'Zeo' });

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

await flat(logoSvg, 192).toFile(out('icon-192.png'));
await flat(logoSvg, 512).toFile(out('icon-512.png'));
await flat(logoSvg, 180).toFile(out('apple-touch-icon.png'));
await flat(maskSvg, 512).toFile(out('icon-maskable-512.png'));
await render(avatarSvg, 512).toFile(out('zeo-avatar.png'));

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

console.log('logo.svg, favicon.svg, favicon.ico (%s), icon-192, icon-512, icon-maskable-512, apple-touch-icon, zeo-avatar',
  ICO_SIZES.join('/'));
