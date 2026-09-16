// linkedom serializes empty SVG title/desc as self-closing tags. Its HTML
// parser treats title as raw text on the next pass, swallowing the plot.
// Use explicit end tags at every serialization boundary (including output).
export const htmlSafeSvg = html => html.replace(/<(title|desc)(\s[^<>]*?)?\s*\/>/gi,
  (_, tag, attributes = '') => `<${tag}${attributes}></${tag}>`);

// Vite validates every served/built HTML page with parse5 and rejects raw
// control characters, lone surrogates and noncharacters outright, so a single
// bad byte makes the whole conversation page unreadable. Tab, LF, CR and FF
// are ordinary HTML whitespace and stay untouched.
const disallowedHtmlCharacters = /[\u0000-\u0008\u000B\u000E-\u001F\u007F-\u009F\p{Cs}\p{Noncharacter_Code_Point}]/gu;

export const findDisallowedHtmlCharacters = html => {
  const found = [];
  for (const match of html.matchAll(disallowedHtmlCharacters)) {
    const line = html.slice(0, match.index).split('\n');
    found.push({ index: match.index, line: line.length, column: line.at(-1).length + 1, codePoint: match[0].codePointAt(0) });
  }
  return found;
};

export const assertHtmlSerializable = (html, label = 'HTML output') => {
  const found = findDisallowedHtmlCharacters(html);
  if (!found.length) return html;
  const shown = found.slice(0, 5)
    .map(item => `U+${item.codePoint.toString(16).toUpperCase().padStart(4, '0')} at ${item.line}:${item.column}`)
    .join(', ');
  throw new Error(`${label} contains ${found.length} character(s) that Vite/parse5 reject: ${shown}`);
};
