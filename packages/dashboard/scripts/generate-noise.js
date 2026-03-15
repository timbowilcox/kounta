/**
 * Generate a 256x256 tileable noise texture for the dashboard background.
 * Uses raw PNG encoding — no native dependencies needed.
 * Run once: node scripts/generate-noise.js
 * Output: public/noise.png
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SIZE = 256;

// Generate grayscale noise pixel data (RGBA)
const rawData = Buffer.alloc(SIZE * (1 + SIZE * 4)); // filter byte + RGBA per pixel per row
let offset = 0;
for (let y = 0; y < SIZE; y++) {
  rawData[offset++] = 0; // PNG filter: None
  for (let x = 0; x < SIZE; x++) {
    const v = Math.floor(Math.random() * 256);
    rawData[offset++] = v;   // R
    rawData[offset++] = v;   // G
    rawData[offset++] = v;   // B
    rawData[offset++] = 255; // A
  }
}

// Compress with deflate
const compressed = zlib.deflateSync(rawData, { level: 6 });

// Build PNG file
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const typeData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeData), 0);
  return Buffer.concat([len, typeData, crc]);
}

// IHDR
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);  // width
ihdr.writeUInt32BE(SIZE, 4);  // height
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // color type: RGBA
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
  chunk("IHDR", ihdr),
  chunk("IDAT", compressed),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = path.join(__dirname, "..", "public", "noise.png");
fs.writeFileSync(out, png);
console.log(`Done: noise.png (${png.length} bytes)`);
