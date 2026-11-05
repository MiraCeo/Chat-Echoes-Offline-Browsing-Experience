/**
 * Text extraction for the asset library's content index.
 *
 * Text-like attachments are read as UTF-8 (HTML/SVG stripped of tags); .docx
 * is a zip whose `word/document.xml` holds the body text, so it is unpacked
 * with a minimal zip reader. Files over the size cap are skipped.
 */
import { inflateRawSync } from 'node:zlib';

export const TEXT_FILE = /\.(md|markdown|txt|json|jsonl|csv|tsv|html?|css|js|mjs|ts|py|yml|yaml|xml|svg)$/i;
export const DOCX_FILE = /\.docx$/i;
export const MAX_BYTES = 200 * 1024;

/** Central-directory entries: name → { method, compressedSize, localOffset }. */
function readZipEntries(bytes) {
  let eocd = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index -= 1) {
    if (bytes.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
  }
  if (eocd < 0) return new Map();
  const count = bytes.readUInt16LE(eocd + 10);
  let offset = bytes.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) break;
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    entries.set(name, { method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntry(bytes, entry) {
  const local = entry.localOffset;
  if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) return null;
  const nameLength = bytes.readUInt16LE(local + 26);
  const extraLength = bytes.readUInt16LE(local + 28);
  const start = local + 30 + nameLength + extraLength;
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRawSync(data);
  return null;
}

const decodeEntities = text => text
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/** Body text of a .docx, or null when it cannot be unpacked. */
export function extractDocxText(bytes) {
  try {
    const entries = readZipEntries(bytes);
    const document = entries.get('word/document.xml');
    if (!document) return null;
    const xml = readZipEntry(bytes, document);
    if (!xml) return null;
    return decodeEntities(xml.toString('utf8')
      .replace(/<w:p[ >]/g, '\n<w:p ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim());
  } catch {
    return null;
  }
}

/** Returns the indexable text, or null when the file is not indexable. */
export function extractText(name, bytes) {
  const value = String(name || '');
  if (!bytes || bytes.length > MAX_BYTES) return null;
  if (DOCX_FILE.test(value)) return extractDocxText(Buffer.from(bytes));
  if (!TEXT_FILE.test(value)) return null;
  let text = Buffer.from(bytes).toString('utf8');
  if (/\.(html?|svg)$/i.test(value)) text = text.replace(/<[^>]*>/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}
