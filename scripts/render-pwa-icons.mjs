/**
 * Rasterize the Waybill Wall mark into the PNG sizes Add to Home Screen needs.
 * Run: node scripts/render-pwa-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const PAPER = [0xf4, 0xef, 0xe6, 255];
const CARD = [0xff, 0xfd, 0xf8, 255];
const INK = [0x1c, 0x19, 0x15, 255];
const INK_SOFT = [0x1c, 0x19, 0x15, 115];
const STAMP = [0xb4, 0x33, 0x2a, 255];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    rgba.subarray(y * width * 4, (y + 1) * width * 4).forEach((byte, i) => {
      raw[row + 1 + i] = byte;
    });
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function canvas(size, color) {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = color[0];
    data[i * 4 + 1] = color[1];
    data[i * 4 + 2] = color[2];
    data[i * 4 + 3] = color[3];
  }
  return { size, data };
}

function blend(dst, src) {
  const sa = src[3] / 255;
  const da = dst[3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA === 0) return [0, 0, 0, 0];
  return [
    Math.round((src[0] * sa + dst[0] * da * (1 - sa)) / outA),
    Math.round((src[1] * sa + dst[1] * da * (1 - sa)) / outA),
    Math.round((src[2] * sa + dst[2] * da * (1 - sa)) / outA),
    Math.round(outA * 255),
  ];
}

function plot(image, x, y, color, cover) {
  if (cover <= 0 || x < 0 || y < 0 || x >= image.size || y >= image.size) return;
  const i = (y * image.size + x) * 4;
  const src = [color[0], color[1], color[2], Math.round(color[3] * Math.min(1, cover))];
  const mixed = blend(
    [image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]],
    src,
  );
  image.data[i] = mixed[0];
  image.data[i + 1] = mixed[1];
  image.data[i + 2] = mixed[2];
  image.data[i + 3] = mixed[3];
}

function fillCircle(image, cx, cy, radius, color) {
  const minX = Math.floor(cx - radius - 1);
  const maxX = Math.ceil(cx + radius + 1);
  const minY = Math.floor(cy - radius - 1);
  const maxY = Math.ceil(cy + radius + 1);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.hypot(dx, dy);
      plot(image, x, y, color, radius + 0.5 - dist);
    }
  }
}

function fillRing(image, cx, cy, radius, width, color) {
  const outer = radius + width / 2;
  const inner = radius - width / 2;
  const minX = Math.floor(cx - outer - 1);
  const maxX = Math.ceil(cx + outer + 1);
  const minY = Math.floor(cy - outer - 1);
  const maxY = Math.ceil(cy + outer + 1);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const cover = Math.min(outer + 0.5 - dist, dist - (inner - 0.5));
      plot(image, x, y, color, cover);
    }
  }
}

function roundRectCover(px, py, x, y, w, h, r) {
  const left = x;
  const right = x + w;
  const top = y;
  const bottom = y + h;
  if (px < left || px > right || py < top || py > bottom) return 0;
  let cx = px;
  let cy = py;
  if (px < x + r && py < y + r) {
    cx = x + r;
    cy = y + r;
  } else if (px > right - r && py < y + r) {
    cx = right - r;
    cy = y + r;
  } else if (px < x + r && py > bottom - r) {
    cx = x + r;
    cy = bottom - r;
  } else if (px > right - r && py > bottom - r) {
    cx = right - r;
    cy = bottom - r;
  } else {
    return 1;
  }
  const dist = Math.hypot(px - cx, py - cy);
  return r + 0.5 - dist;
}

function fillRoundRect(image, x, y, w, h, r, color) {
  const minX = Math.floor(x - 1);
  const maxX = Math.ceil(x + w + 1);
  const minY = Math.floor(y - 1);
  const maxY = Math.ceil(y + h + 1);
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      plot(image, px, py, color, roundRectCover(px + 0.5, py + 0.5, x, y, w, h, r));
    }
  }
}

function drawMark(size, maskable) {
  const image = canvas(size, PAPER);
  const scale = maskable ? size / 48 : size / 32;
  const ox = maskable ? 8 * scale : 0;
  const oy = maskable ? 8 * scale : 0;
  const s = (n) => n * scale;
  fillRoundRect(image, ox + s(6), oy + s(5), s(15), s(22), s(2.2), CARD);
  fillRoundRect(image, ox + s(9), oy + s(10), s(8), s(2), s(1), INK);
  fillRoundRect(image, ox + s(9), oy + s(14), s(9), s(1.4), s(0.7), INK_SOFT);
  fillCircle(image, ox + s(21.5), oy + s(21), s(6.4), STAMP);
  fillRing(image, ox + s(21.5), oy + s(21), s(3.6), s(1.4), CARD);
  return image;
}

const files = [
  ["public/__grok/icon-180.png", 180, false],
  ["public/apple-touch-icon.png", 180, false],
  ["public/icons/icon-192.png", 192, false],
  ["public/icons/icon-512.png", 512, false],
  ["public/icons/icon-maskable-192.png", 192, true],
  ["public/icons/icon-maskable-512.png", 512, true],
];

for (const [rel, size, maskable] of files) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  const image = drawMark(size, maskable);
  writeFileSync(path, encodePng(size, size, image.data));
}
