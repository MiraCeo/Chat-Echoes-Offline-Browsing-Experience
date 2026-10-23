// 分享页的载荷里，正文有时被写了两层 JSON 转义：解码一次后剩下 "\\u63a8\\u8350" 这样的字面量。
// 直接交给 Markdown 解析，反斜杠会被当成转义符号吃掉，读者看到的是 "u63a8u8350"。
// 这里把代码块之外的这类序列还原成字符；代码块里的字面量保持原样。
const ESCAPE = /\\u([0-9a-fA-F]{4})/g;

const decodeSegment = text => String(text || '').replace(ESCAPE, (whole, hex) => {
  const code = Number.parseInt(hex, 16);
  // 控制字符不还原：它们在原文里更有可能是真的转义写法。
  return code >= 0x20 && code !== 0x7f ? String.fromCharCode(code) : whole;
});

export const decodeUnicodeEscapes = text => {
  const source = String(text || '');
  if (!source.includes('\\u')) return source;
  let inFence = false;
  return source.split('\n').map(line => {
    if (/^\s*```/.test(line)) { inFence = !inFence; return line; }
    return inFence ? line : decodeSegment(line);
  }).join('\n');
};

// 有的载荷在解析时把反斜杠也吃掉了，只剩 "u63a8u8350..." 这样的裸序列。
// 连续两个以上的 uXXXX 基本可以确定是转义文本，逐段还原。
export const decodeBareEscapes = text => String(text || '').replace(/(?:u[0-9a-fA-F]{4}){2,}/g, run =>
  run.replace(/u([0-9a-fA-F]{4})/g, (whole, hex) => {
    const code = Number.parseInt(hex, 16);
    return code >= 0x20 && code !== 0x7f ? String.fromCharCode(code) : whole;
  }));
