#!/usr/bin/env node
/**
 * Rasterise the Nexus brand masters in `assets/brand` into the icons the web app
 * (and the GitHub repository page) serve.
 *
 *   pnpm brand:assets
 *
 * The SVG masters are the source of truth: this script never draws anything
 * itself, it only renders them at the sizes a browser or a store expects. It
 * uses the Chromium that the frontend's Playwright dependency already installs,
 * so no extra toolchain is required (`pnpm --filter @nexus/frontend exec
 * playwright install chromium` if the cache is empty).
 *
 * Outputs
 *   apps/frontend/public/icons/favicon.svg            copy of the favicon tile
 *   apps/frontend/public/icons/favicon-32.png         PNG tab icon fallback
 *   apps/frontend/public/favicon.ico                  /favicon.ico requests
 *   apps/frontend/public/icons/icon-192.png           PWA icon, purpose "any"
 *   apps/frontend/public/icons/icon-512.png           PWA icon, purpose "any"
 *   apps/frontend/public/icons/icon-maskable-512.png  PWA icon, purpose "maskable"
 *   apps/frontend/public/icons/apple-touch-icon.png   iOS home screen
 *   assets/brand/nexus-social-card.png                GitHub social preview
 */
import { createRequire } from 'node:module';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(
  new URL('../apps/frontend/package.json', import.meta.url),
);
const { chromium } = require('@playwright/test');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const brand = resolve(root, 'assets/brand');
const icons = resolve(root, 'apps/frontend/public/icons');

const jobs = [
  {
    master: 'nexus-tile.svg',
    out: 'apps/frontend/public/icons/icon-192.png',
    width: 192,
    height: 192,
    transparent: true,
  },
  {
    master: 'nexus-tile.svg',
    out: 'apps/frontend/public/icons/icon-512.png',
    width: 512,
    height: 512,
    transparent: true,
  },
  {
    master: 'nexus-tile-maskable.svg',
    out: 'apps/frontend/public/icons/icon-maskable-512.png',
    width: 512,
    height: 512,
  },
  {
    master: 'nexus-tile-maskable.svg',
    out: 'apps/frontend/public/icons/apple-touch-icon.png',
    width: 180,
    height: 180,
  },
  {
    master: 'nexus-tile-favicon.svg',
    out: 'apps/frontend/public/icons/favicon-32.png',
    width: 32,
    height: 32,
    transparent: true,
  },
  {
    master: 'nexus-social-card.svg',
    out: 'assets/brand/nexus-social-card.png',
    width: 1280,
    height: 640,
  },
];

/** Read a PNG header without a decoder: width, height and colour type. */
function pngInfo(file) {
  const data = readFileSync(file);
  const signature = data.subarray(0, 8).toString('binary');
  if (signature !== '\x89PNG\r\n\x1a\n')
    throw new Error(`${file} is not a PNG`);
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    colorType: data[25], // 6 = RGBA, 2 = RGB, 0 = greyscale, 4 = grey+alpha
    bytes: statSync(file).size,
  };
}

const browser = await chromium.launch();
try {
  for (const job of jobs) {
    const svg = readFileSync(resolve(brand, job.master), 'utf8');
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    const page = await browser.newPage({
      viewport: { width: job.width, height: job.height },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">` +
        `<img src="${dataUrl}" width="${job.width}" height="${job.height}" style="display:block" alt="">` +
        `</body></html>`,
    );
    await page.waitForFunction(() => {
      const img = document.querySelector('img');
      return (
        img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0
      );
    });
    mkdirSync(dirname(resolve(root, job.out)), { recursive: true });
    await page.screenshot({
      path: resolve(root, job.out),
      omitBackground: Boolean(job.transparent),
      clip: { x: 0, y: 0, width: job.width, height: job.height },
    });
    await page.close();

    const info = pngInfo(resolve(root, job.out));
    if (info.width !== job.width || info.height !== job.height) {
      throw new Error(
        `${job.out}: expected ${job.width}x${job.height}, got ${info.width}x${info.height}`,
      );
    }
    const alpha = job.transparent ? 6 : 2;
    if (info.colorType !== alpha) {
      throw new Error(
        `${job.out}: expected colour type ${alpha} (${job.transparent ? 'RGBA' : 'RGB'}), got ${info.colorType}`,
      );
    }
    console.log(
      `✓ ${job.out}  ${info.width}×${info.height}  ${(info.bytes / 1024).toFixed(1)} kB`,
    );
  }
} finally {
  await browser.close();
}

// The favicon is served as an SVG so it stays crisp on every tab bar; the
// masters in assets/brand stay the single source of truth.
mkdirSync(icons, { recursive: true });
copyFileSync(
  resolve(brand, 'nexus-tile-favicon.svg'),
  resolve(icons, 'favicon.svg'),
);
console.log(
  '✓ apps/frontend/public/icons/favicon.svg  (copied from assets/brand/nexus-tile-favicon.svg)',
);

// Browsers (and link unfurlers) still ask for /favicon.ico, and a cached icon
// survives a redeploy, so ship a real ICO built from the 32 px PNG. A PNG
// entry inside an ICO container is supported by every current browser.
const png32 = readFileSync(resolve(icons, 'favicon-32.png'));
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0); // reserved
icoHeader.writeUInt16LE(1, 2); // type: icon
icoHeader.writeUInt16LE(1, 4); // one image
const icoEntry = Buffer.alloc(16);
icoEntry.writeUInt8(32, 0); // width
icoEntry.writeUInt8(32, 1); // height
icoEntry.writeUInt8(0, 2); // no palette
icoEntry.writeUInt8(0, 3); // reserved
icoEntry.writeUInt16LE(1, 4); // colour planes
icoEntry.writeUInt16LE(32, 6); // bits per pixel
icoEntry.writeUInt32LE(png32.length, 8); // image size
icoEntry.writeUInt32LE(22, 12); // image offset (6 + 16)
writeFileSync(
  resolve(root, 'apps/frontend/public/favicon.ico'),
  Buffer.concat([icoHeader, icoEntry, png32]),
);
console.log('✓ apps/frontend/public/favicon.ico  (32×32 PNG entry)');

// Guard against a stale manifest referencing an icon that no longer exists.
const manifest = readFileSync(
  resolve(root, 'apps/frontend/public/manifest.webmanifest'),
  'utf8',
);
const referenced = [...manifest.matchAll(/"src":\s*"([^"]+)"/g)].map(
  (match) => match[1],
);
const missing = referenced.filter((src) => {
  try {
    statSync(
      resolve(
        root,
        'apps/frontend/public',
        src.replace(/^\//, '').split('?')[0],
      ),
    );
    return false;
  } catch {
    return true;
  }
});
if (missing.length > 0) {
  throw new Error(
    `manifest.webmanifest references missing files: ${missing.join(', ')}`,
  );
}
console.log(
  `✓ manifest.webmanifest references ${referenced.length} existing icons`,
);
