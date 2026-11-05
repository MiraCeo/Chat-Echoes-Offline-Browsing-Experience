/**
 * Text extraction for the asset library's content index.
 *
 * Only text-like attachments are indexed; HTML/SVG are stripped of tags first.
 * Files over the size cap are skipped so one huge log cannot bloat the index.
 */
export const TEXT_FILE = /\.(md|markdown|txt|json|jsonl|csv|tsv|html?|css|js|mjs|ts|py|yml|yaml|xml|svg)$/i;
export const MAX_BYTES = 200 * 1024;

/** Returns the indexable text, or null when the file is not indexable. */
export function extractText(name, bytes) {
  if (!TEXT_FILE.test(String(name || ''))) return null;
  if (!bytes || bytes.length > MAX_BYTES) return null;
  let text = Buffer.from(bytes).toString('utf8');
  if (/\.(html?|svg)$/i.test(name)) text = text.replace(/<[^>]*>/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}
