#!/usr/bin/env node
/**
 * Renders the link-preview card (Open Graph / Twitter), the Apple touch icon and favicon.ico from the site's own
 * fonts and colours, so they match the page exactly. Output goes to src/app, where Next.js picks the
 * files up by name. Development tooling only: it needs the Chromium that Playwright installs
 * (`npx playwright install chromium`). Re-run after changing the title or colours.
 *
 *   node scripts/build-social-images.mjs
 */
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const font = (cut) => pathToFileURL(join(root, "public/fonts", `JetBrainsMonoNerdFontMono-${cut}.woff2`)).href;

const TITLE = "nothikemu";
const LINES = ["live discord presence", "recent listening", "github activity & projects"];

const card = `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: "JB"; font-weight: 400; src: url("${font("Regular")}") format("woff2"); }
@font-face { font-family: "JB"; font-weight: 500; src: url("${font("Medium")}") format("woff2"); }
* { box-sizing: border-box; margin: 0; border-radius: 0; }
html, body { width: 1200px; height: 630px; background: #000; color: #f4f1ec; font-family: "JB", monospace; overflow: hidden; }
body {
  position: relative;
  background:
    radial-gradient(720px 420px at 12% 8%, rgba(244,241,236,.07), transparent 70%),
    radial-gradient(560px 380px at 92% 28%, rgba(244,241,236,.05), transparent 70%),
    radial-gradient(800px 440px at 44% 108%, rgba(244,241,236,.06), transparent 70%), #000;
}
.panel { position: absolute; inset: 56px; padding: 64px 72px; border: 1px solid rgba(244,241,236,.22);
  background: rgba(244,241,236,.035); box-shadow: inset 0 1px 0 rgba(244,241,236,.12); display: flex; flex-direction: column; justify-content: space-between; }
.label { font-size: 22px; letter-spacing: .22em; text-transform: uppercase; color: #aaa7a2; }
h1 { font-weight: 500; font-size: 148px; line-height: 1; letter-spacing: -.02em; }
.lines { display: grid; gap: 14px; font-size: 30px; color: #aaa7a2; }
.lines span::before { content: ""; display: inline-block; width: 12px; height: 12px; margin-right: 18px; background: #f4f1ec; }
</style><body><div class="panel"><div class="label">personal dashboard</div><h1>${TITLE}</h1>
<div class="lines">${LINES.map((line) => `<span>${line}</span>`).join("")}</div></div></body>`;

const ICON_SVG = (size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}"><rect width="32" height="32" fill="#000"/><rect x="7" y="7" width="18" height="18" fill="none" stroke="#f4f1ec" stroke-width="2"/><rect x="13" y="13" width="6" height="6" fill="#f4f1ec"/></svg>`;

const icon = `<!doctype html><meta charset="utf-8"><style>
html, body { margin: 0; width: 180px; height: 180px; background: #000; }
svg { display: block; }
</style><body>${ICON_SVG(180)}</body>`;

const dir = mkdtempSync(join(tmpdir(), "social-"));
const browser = await chromium.launch();
async function render(html, size, out) {
  const file = join(dir, `${out.replace(/\W+/g, "-")}.html`);
  writeFileSync(file, html);
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(root, "src/app", out) });
  await page.close();
  console.log("wrote src/app/" + out);
}
await render(card, { width: 1200, height: 630 }, "opengraph-image.png");
copyFileSync(join(root, "src/app/opengraph-image.png"), join(root, "src/app/twitter-image.png"));
console.log("wrote src/app/twitter-image.png");
await render(icon, { width: 180, height: 180 }, "apple-icon.png");

// favicon.ico: browsers and crawlers still ask for /favicon.ico. An .ico may carry a PNG image, so this is a
// 48px render wrapped in the 22-byte ICO header and directory entry. Next.js decodes .ico files strictly and
// requires the PNG to be RGBA, which a canvas always produces (a screenshot of an opaque image is plain RGB).
const small = await browser.newPage({ viewport: { width: 48, height: 48 } });
const dataUrl = await small.evaluate(async (svg) => {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 48;
  canvas.getContext("2d").drawImage(image, 0, 0, 48, 48);
  return canvas.toDataURL("image/png");
}, ICON_SVG(48));
await small.close();
const png = Buffer.from(dataUrl.split(",")[1], "base64");
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // one image
header.writeUInt8(48, 6); // width
header.writeUInt8(48, 7); // height
header.writeUInt16LE(1, 10); // planes
header.writeUInt16LE(32, 12); // bits per pixel
header.writeUInt32LE(png.length, 14); // image size
header.writeUInt32LE(22, 18); // image offset
writeFileSync(join(root, "src/app/favicon.ico"), Buffer.concat([header, png]));
console.log("wrote src/app/favicon.ico");
await browser.close();
writeFileSync(join(root, "src/app/opengraph-image.alt.txt"), `${TITLE}: ${LINES.join(", ")}\n`);
writeFileSync(join(root, "src/app/twitter-image.alt.txt"), `${TITLE}: ${LINES.join(", ")}\n`);
