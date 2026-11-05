import assert from 'node:assert/strict';
import { imageSize, isContentBearing } from './memory-image-pilot.mjs';

// PNG: signature + IHDR width/height at offsets 16/20.
const png = Buffer.alloc(33);
png.writeUInt32BE(0x89504e47, 0);
png.writeUInt32BE(0x0d0a1a0a, 4);
png.writeUInt32BE(13, 8);
png.write('IHDR', 12);
png.writeUInt32BE(800, 16);
png.writeUInt32BE(600, 20);
assert.deepEqual(imageSize(png), { width: 800, height: 600 });

// JPEG: SOI + SOF0 with height/width after the marker.
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
assert.deepEqual(imageSize(jpeg), { width: 800, height: 600 });

assert.equal(imageSize(Buffer.from('not an image')), null);

// Content-bearing: real area, not a small square avatar, enough bytes.
assert.equal(isContentBearing({ width: 800, height: 600 }, Buffer.alloc(40 * 1024)), true);
assert.equal(isContentBearing({ width: 300, height: 200 }, Buffer.alloc(40 * 1024)), false, '太小');
assert.equal(isContentBearing({ width: 500, height: 500 }, Buffer.alloc(40 * 1024)), false, '小方图当头像');
assert.equal(isContentBearing({ width: 800, height: 600 }, Buffer.alloc(10 * 1024)), false, '字节太少');
assert.equal(isContentBearing(null, Buffer.alloc(40 * 1024)), false, '尺寸未知');

console.log('PASS image pilot: PNG/JPEG size parsing, content-bearing filter');
