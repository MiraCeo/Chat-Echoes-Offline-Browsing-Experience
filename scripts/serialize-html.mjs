// linkedom serializes empty SVG title/desc as self-closing tags. Its HTML
// parser treats title as raw text on the next pass, swallowing the plot.
// Use explicit end tags at every serialization boundary (including output).
export const htmlSafeSvg = html => html.replace(/<(title|desc)(\s[^<>]*?)?\s*\/>/gi,
  (_, tag, attributes = '') => `<${tag}${attributes}></${tag}>`);
