/**
 * DIL document reader.
 *
 * Current official assistant answers ship a generative-UI document in
 * `metadata.model_dil_v2.code` alongside the Markdown fallback. The code is a small, machine-written
 * JavaScript subset:
 *
 *   DIL.render(__dil.jsx(() => {
 *     const __dilConstants = DIL.useConstants();
 *     return __dil.jsx(__dil.Fragment, null,
 *       __dil.jsx("text", null, __dilConstants["0"], __dil.jsx("bold", null, __dilConstants["1"])),
 *       __dil.jsx("table", null, ...));
 *   }, { key: "body:0" }));
 *
 * This module parses that subset and interprets it against the payload's own `constants` table. It is
 * a reader, not an execution sandbox: there is no `eval`, no `node:vm`, no host object, and every
 * unknown identifier, member or callee degrades to `undefined` (recorded as a note) instead of
 * throwing or reaching anything real.
 */
import { parseHTML } from 'linkedom';

const PUNCTUATION = ['===', '!==', '==', '!=', '=>', '<=', '>=', '&&', '||', '...', '?.', '??', '(', ')', '[', ']', '{', '}', '.', ',', ':', '?', ';', '+', '-', '*', '/', '!', '<', '>', '='];
const KEYWORDS = new Set(['const', 'let', 'var', 'return', 'function', 'true', 'false', 'null', 'undefined', 'new', 'typeof', 'if', 'else']);

/**
 * Components the payload refers to as bare identifiers rather than strings. They keep their own names
 * so the renderer can map them onto the same inline-component renderers used for text markup.
 */
export const DIL_COMPONENT_IDENTIFIERS = new Set(['Cite', 'FileCite', 'CodeCite', 'MemoryCite', 'Link', 'Entity', 'AsyncImage', 'Image', 'File']);

/** Tokenize the payload subset; anything unrecognized becomes an `error` token the parser rejects. */
export function tokenize(source) {
  const tokens = [];
  const text = String(source);
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (/\s/.test(character)) { index += 1; continue; }
    if (character === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') index += 1;
      continue;
    }
    if (character === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2);
      index = end < 0 ? text.length : end + 2;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      const start = index;
      const quote = character;
      let value = '';
      let cursor = index + 1;
      const parts = [];
      while (cursor < text.length && text[cursor] !== quote) {
        if (text[cursor] === '\\') { value += text[cursor + 1]; cursor += 2; continue; }
        if (quote === '`' && text[cursor] === '$' && text[cursor + 1] === '{') {
          let depth = 1;
          let inner = cursor + 2;
          while (inner < text.length && depth > 0) {
            if (text[inner] === '{') depth += 1;
            else if (text[inner] === '}') depth -= 1;
            inner += 1;
          }
          parts.push({ text: value }, { expression: text.slice(cursor + 2, inner - 1) });
          value = '';
          cursor = inner;
          continue;
        }
        value += text[cursor];
        cursor += 1;
      }
      parts.push({ text: value });
      tokens.push({ type: 'value', value: quote === '`' ? { template: parts } : value, index: start });
      index = cursor + 1;
      continue;
    }
    if (/[0-9]/.test(character)) {
      const match = /^[0-9]+(?:\.[0-9]+)?/.exec(text.slice(index));
      tokens.push({ type: 'value', value: Number(match[0]), index });
      index += match[0].length;
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      const match = /^[A-Za-z_$][\w$]*/.exec(text.slice(index));
      tokens.push({ type: KEYWORDS.has(match[0]) ? 'keyword' : 'identifier', value: match[0], index });
      index += match[0].length;
      continue;
    }
    const punctuation = PUNCTUATION.find(candidate => text.startsWith(candidate, index));
    if (punctuation) {
      tokens.push({ type: 'punctuation', value: punctuation, index });
      index += punctuation.length;
      continue;
    }
    tokens.push({ type: 'error', value: character, index });
    index += 1;
  }
  return tokens;
}

class Parser {
  constructor(tokens, source) {
    this.tokens = tokens;
    this.source = source;
    this.position = 0;
  }

  peek(offset = 0) { return this.tokens[this.position + offset]; }

  next() { return this.tokens[this.position++]; }

  is(value, offset = 0) {
    const token = this.peek(offset);
    return Boolean(token) && token.value === value;
  }

  expect(value) {
    if (!this.is(value)) {
      const token = this.peek();
      const near = token ? ` at char ${token.index}: …${this.source.slice(Math.max(0, token.index - 60), token.index + 60)}…` : ' at end of payload';
      throw new Error(`Expected ${JSON.stringify(value)}${near}`);
    }
    return this.next();
  }

  parseProgram() {
    const statements = [];
    while (this.position < this.tokens.length) {
      const token = this.peek();
      const statement = this.parseStatement();
      if (statement) statements.push(statement);
      else if (token === this.peek()) throw new Error(`Unparsed token ${JSON.stringify(this.peek())}`);
      if (this.is(';')) this.next();
    }
    return { kind: 'program', statements };
  }

  parseStatement() {
    if (this.is('const') || this.is('let') || this.is('var')) {
      this.next();
      // `const [mode, setMode] = DIL.useState(…)` — hooks are read as data, the setter stays unused.
      if (this.is('[')) {
        this.next();
        const names = [];
        while (!this.is(']')) {
          const token = this.next();
          if (token.type === 'identifier') names.push(token.value);
          if (this.is(',')) this.next();
        }
        this.expect(']');
        this.expect('=');
        return { kind: 'declare', names, pattern: 'array', value: this.parseExpression() };
      }
      const name = this.next().value;
      this.expect('=');
      const value = this.parseExpression();
      return { kind: 'declare', name, value };
    }
    if (this.is('return')) {
      this.next();
      return { kind: 'return', value: this.parseExpression() };
    }
    return { kind: 'expression', value: this.parseExpression() };
  }

  parseExpression() { return this.parseTernary(); }

  parseTernary() {
    const test = this.parseLogicalOr();
    if (!this.is('?')) return test;
    this.next();
    const consequent = this.parseExpression();
    this.expect(':');
    const alternate = this.parseExpression();
    return { kind: 'conditional', test, consequent, alternate };
  }

  parseLogicalOr() {
    let left = this.parseLogicalAnd();
    while (this.is('||')) {
      this.next();
      left = { kind: 'binary', operator: '||', left, right: this.parseLogicalAnd() };
    }
    return left;
  }

  parseLogicalAnd() {
    let left = this.parseBinary();
    while (this.is('&&')) {
      this.next();
      left = { kind: 'binary', operator: '&&', left, right: this.parseBinary() };
    }
    return left;
  }

  parseBinary() {
    let left = this.parseUnary();
    while (this.is('??') || this.is('===') || this.is('!==') || this.is('==') || this.is('!=')) {
      const operator = this.next().value;
      const right = this.parseUnary();
      left = { kind: 'binary', operator, left, right };
    }
    return left;
  }

  parseUnary() {
    if (this.is('!')) { this.next(); return { kind: 'unary', operator: '!', value: this.parseUnary() }; }
    return this.parseMultiplicative();
  }

  parseMultiplicative() {
    let left = this.parseAdditive();
    while (this.is('*') || this.is('/')) {
      const operator = this.next().value;
      left = { kind: 'binary', operator, left, right: this.parseAdditive() };
    }
    return left;
  }

  parseAdditive() {
    let left = this.parseComparison();
    while (this.is('+') || this.is('-')) {
      const operator = this.next().value;
      left = { kind: 'binary', operator, left, right: this.parseComparison() };
    }
    return left;
  }

  parseComparison() {
    let left = this.parseCallMember();
    while (this.is('<') || this.is('>') || this.is('<=') || this.is('>=')) {
      const operator = this.next().value;
      left = { kind: 'binary', operator, left, right: this.parseCallMember() };
    }
    return left;
  }

  parseCallMember() {
    let node = this.parsePrimary();
    for (;;) {
      if (this.is('.') || this.is('?.')) {
        const optional = this.next().value === '?.';
        const property = this.next().value;
        node = { kind: 'member', object: node, property: { kind: 'literal', value: property }, computed: false, optional };
        continue;
      }
      if (this.is('[')) {
        this.next();
        const property = this.parseExpression();
        this.expect(']');
        node = { kind: 'member', object: node, property, computed: true, optional: false };
        continue;
      }
      if (this.is('(')) {
        this.next();
        const args = [];
        while (!this.is(')')) {
          if (this.is('...')) { this.next(); args.push({ kind: 'spread', value: this.parseExpression() }); }
          else args.push(this.parseExpression());
          if (this.is(',')) { this.next(); continue; }
          break;
        }
        this.expect(')');
        node = { kind: 'call', callee: node, args };
        continue;
      }
      return node;
    }
  }

  parsePrimary() {
    const token = this.peek();
    if (!token) throw new Error('Unexpected end of payload');
    if (token.type === 'value') {
      this.next();
      // Template literals may embed expressions; parse them here so evaluation never re-parses source.
      if (token.value && typeof token.value === 'object' && token.value.template) {
        return {
          kind: 'template',
          parts: token.value.template.map(part => (part.expression === undefined
            ? { text: part.text }
            : { expression: parseInnerExpression(part.expression) })),
        };
      }
      return { kind: 'literal', value: token.value };
    }
    if (token.type === 'keyword' && ['true', 'false', 'null', 'undefined'].includes(token.value)) {
      this.next();
      return { kind: 'literal', value: token.value === 'undefined' ? undefined : token.value === 'null' ? null : token.value === 'true' };
    }
    if (token.type === 'error') throw new Error(`Unsupported character ${JSON.stringify(token.value)} at char ${token.index}`);
    if (token.type === 'identifier') {
      if (DIL_COMPONENT_IDENTIFIERS.has(token.value)) {
        this.next();
        return { kind: 'literal', value: { dilComponent: token.value } };
      }
      // `x => …` arrow without parentheses: consume the parameter and the arrow itself.
      if (this.is('=>', 1)) {
        const name = this.next().value;
        this.next();
        return this.parseArrow([name]);
      }
      this.next();
      return { kind: 'identifier', name: token.value };
    }
    if (this.is('(')) {
      // Either a parenthesized expression or an arrow parameter list.
      const arrow = this.tryParseArrow();
      if (arrow) return arrow;
      this.next();
      const value = this.parseExpression();
      this.expect(')');
      return value;
    }
    if (this.is('[')) {
      this.next();
      const elements = [];
      while (!this.is(']')) {
        if (this.is('...')) { this.next(); elements.push({ kind: 'spread', value: this.parseExpression() }); }
        else elements.push(this.parseExpression());
        if (this.is(',')) { this.next(); continue; }
        break;
      }
      this.expect(']');
      return { kind: 'array', elements };
    }
    if (this.is('{')) {
      this.next();
      const properties = [];
      while (!this.is('}')) {
        const key = this.next().value;
        this.expect(':');
        properties.push({ key: String(key), value: this.parseExpression() });
        if (this.is(',')) { this.next(); continue; }
        break;
      }
      this.expect('}');
      return { kind: 'object', properties };
    }
    if (token.type === 'keyword' && token.value === 'function') throw new Error('Function declarations are not part of the render expression');
    const near = token.index === undefined ? '' : ` at char ${token.index}: …${this.source.slice(Math.max(0, token.index - 70), token.index + 70)}…`;
    throw new Error(`Unsupported token ${JSON.stringify(token.value)}${near}`);
  }

  /** `(a, b) => …` — only when the parenthesis is directly followed by `=>`. */
  tryParseArrow() {
    let depth = 0;
    let cursor = this.position;
    const names = [];
    let expectName = true;
    for (; cursor < this.tokens.length; cursor += 1) {
      const token = this.tokens[cursor];
      if (token.value === '(') { depth += 1; continue; }
      if (token.value === ')') {
        depth -= 1;
        if (depth === 0) break;
        continue;
      }
      if (depth === 1) {
        if (token.value === ',') { expectName = true; continue; }
        if (expectName && token.type === 'identifier') { names.push(token.value); expectName = false; }
      }
    }
    if (this.tokens[cursor + 1]?.value !== '=>') return null;
    this.position = cursor + 2;
    return this.parseArrow(names);
  }

  parseArrow(params) {
    if (this.is('{')) {
      this.next();
      const statements = [];
      while (!this.is('}')) {
        const statement = this.parseStatement();
        if (statement) statements.push(statement);
        if (this.is(';')) this.next();
      }
      this.expect('}');
      return { kind: 'arrow', params, body: { kind: 'block', statements } };
    }
    return { kind: 'arrow', params, body: this.parseExpression() };
  }
}

/** Split the payload into its optional helper preamble and the `DIL.render(…)` argument. */
export function extractRenderExpression(code) {
  const text = String(code);
  const anchor = text.lastIndexOf('DIL.render(');
  if (anchor < 0) throw new Error('Payload has no DIL.render(...) call');
  let start = anchor + 'DIL.render('.length;
  let depth = 1;
  let inString = null;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (character === '\\') index += 1;
      else if (character === inString) inString = null;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') { inString = character; continue; }
    if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index);
    }
  }
  throw new Error('Unbalanced DIL.render(...) call');
}

export function parseDilExpression(expression) {
  const parser = new Parser(tokenize(expression), expression);
  return parser.parseProgram();
}

/** One `${…}` hole: usually a single expression, but a block is accepted so nothing is lost. */
export function parseInnerExpression(expression) {
  const program = parseDilExpression(expression);
  if (program.statements.length === 1) {
    const [statement] = program.statements;
    if (statement.kind === 'expression' || statement.kind === 'return') return statement.value;
    if (statement.kind === 'declare') return { kind: 'literal', value: undefined };
  }
  return { kind: 'block', statements: program.statements };
}

/** Interpreter over the parsed subset. `notes` records anything the reader could not resolve. */
export function evaluateDil(program, { constants = {}, appData = {} } = {}) {
  const notes = [];
  const note = message => { if (!notes.includes(message)) notes.push(message); };

  const stringify = value => (value === undefined || value === null ? '' : String(value));

  const runStatements = (statements, scope) => {
    let last;
    for (const statement of statements) {
      if (statement.kind === 'declare') {
        const value = evaluate(statement.value, scope);
        if (statement.names) statement.names.forEach((name, position) => scope.set(name, Array.isArray(value) ? value[position] : undefined));
        else scope.set(statement.name, value);
      } else if (statement.kind === 'return') return evaluate(statement.value, scope);
      else last = evaluate(statement.value, scope);
    }
    return last;
  };

  // `__dil.jsx(fn, {…})` is a lazy element: the component tree comes from calling `fn`.
  const jsx = (type, props, ...children) => {
    if (typeof type === 'function') return type();
    const name = type && typeof type === 'object' && type.dilComponent ? type.dilComponent : String(type);
    return {
      type: name === String(fragmentSymbol) ? 'fragment' : name,
      props: props && typeof props === 'object' ? props : {},
      children: children.flat(Infinity).filter(child => child !== undefined && child !== null),
    };
  };

  const fragmentSymbol = Symbol('dil.fragment');

  // Only pure arithmetic helpers the payloads use to format numbers; nothing host-reaching.
  const mathShim = {
    ceil: Math.ceil, floor: Math.floor, round: Math.round, abs: Math.abs,
    max: Math.max, min: Math.min, pow: Math.pow, sqrt: Math.sqrt, trunc: Math.trunc,
  };

  function evaluate(node, scope = new Map()) {
    switch (node?.kind) {
      case 'literal':
        return node.value;
      case 'template':
        return node.parts.map(part => (part.text !== undefined ? part.text : stringify(evaluate(part.expression, scope)))).join('');
      case 'identifier': {
        if (scope.has(node.name)) return scope.get(node.name);
        if (node.name === '__dilConstants') return constants;
        if (node.name === '__dilModelDataBindings') return appData;
        if (node.name === '__dil') return { jsx, Fragment: fragmentSymbol };
        if (node.name === 'DIL') {
          return {
            useConstants: () => constants,
            useAppData: () => appData,
            render: value => value,
            // Read-only reading: hooks yield their initial value, setters are never needed.
            useState: initial => [initial, () => undefined],
            useMemo: factory => (typeof factory === 'function' ? factory() : factory),
          };
        }
        if (node.name === 'Math') return mathShim;
        if (node.name === 'String') return value => stringify(value);
        if (node.name === 'Number') return value => Number(value);
        if (node.name === 'undefined') return undefined;
        note(`unknown identifier ${node.name}`);
        return undefined;
      }
      case 'array':
        return node.elements.flatMap(element => (element.kind === 'spread' ? evaluate(element.value, scope) : [evaluate(element, scope)]));
      case 'object':
        return Object.fromEntries(node.properties.map(property => [property.key, evaluate(property.value, scope)]));
      case 'member': {
        const object = evaluate(node.object, scope);
        const key = node.computed ? evaluate(node.property, scope) : node.property.value;
        if (object === undefined || object === null) {
          if (!node.optional) note(`member ${String(key)} read on ${object === null ? 'null' : 'undefined'}`);
          return undefined;
        }
        if (typeof object === 'object' || typeof object === 'string' || Array.isArray(object)) return object[key];
        note(`member ${String(key)} read on ${typeof object}`);
        return undefined;
      }
      case 'call': {
        const args = node.args.map(argument => (argument.kind === 'spread' ? evaluate(argument.value, scope) : evaluate(argument, scope)));
        const callee = node.callee;
        if (callee.kind === 'identifier' && callee.name === '__dilSafe') {
          try { return typeof args[0] === 'function' ? args[0]() : args[0]; } catch { return args[1]; }
        }
        if (callee.kind === 'member') {
          const object = evaluate(callee.object, scope);
          const key = callee.computed ? evaluate(callee.property, scope) : callee.property.value;
          if (Array.isArray(object)) {
            if (key === 'map') return object.map((item, index) => callValue(args[0], [item, index]));
            if (key === 'filter') return object.filter((item, index) => callValue(args[0], [item, index]));
            if (key === 'join') return object.join(args[0] ?? ',');
            if (key === 'flatMap') return object.flatMap((item, index) => callValue(args[0], [item, index]));
          }
          const value = object === undefined || object === null ? undefined : object[key];
          if (typeof value === 'function') return callValue(value, args);
          note(`unsupported call ${String(key)}()`);
          return undefined;
        }
        const value = evaluate(callee, scope);
        if (typeof value === 'function') return callValue(value, args);
        note('unsupported callee');
        return undefined;
      }
      case 'conditional':
        return evaluate(node.test, scope) ? evaluate(node.consequent, scope) : evaluate(node.alternate, scope);
      case 'binary': {
        const left = evaluate(node.left, scope);
        if (node.operator === '??') return left ?? evaluate(node.right, scope);
        if (node.operator === '&&') return left ? evaluate(node.right, scope) : left;
        if (node.operator === '||') return left ? left : evaluate(node.right, scope);
        const right = evaluate(node.right, scope);
        switch (node.operator) {
          case '===': return left === right;
          case '!==': return left !== right;
          // Loose equality is only used for the `== null` nullish test in these payloads.
          case '==': return left === right || (left === null && right === undefined) || (left === undefined && right === null);
          case '!=': return !(left === right || (left === null && right === undefined) || (left === undefined && right === null));
          case '<': return left < right;
          case '>': return left > right;
          case '<=': return left <= right;
          case '>=': return left >= right;
          case '+': return typeof left === 'string' || typeof right === 'string' ? `${stringify(left)}${stringify(right)}` : Number(left) + Number(right);
          case '-': return Number(left) - Number(right);
          case '*': return Number(left) * Number(right);
          case '/': return Number(left) / Number(right);
          default:
            note(`unsupported operator ${node.operator}`);
            return undefined;
        }
      }
      case 'unary':
        return !evaluate(node.value, scope);
      case 'arrow':
        return (...called) => {
          const local = new Map(scope);
          node.params.forEach((name, position) => local.set(name, called[position]));
          return node.body.kind === 'block' ? runStatements(node.body.statements, local) : evaluate(node.body, local);
        };
      case 'block':
        return runStatements(node.statements, new Map(scope));
      case 'program':
        return runStatements(node.statements, new Map(scope));
      case 'spread':
        return evaluate(node.value, scope);
      default:
        note(`unsupported node ${node?.kind}`);
        return undefined;
    }
  }

  const callValue = (value, args) => value(...args);

  const tree = evaluate(program);
  return { tree, notes };
}

/** Parse and interpret one `model_dil_v2` payload. */
export function readDilDocument(payload) {
  if (!payload || typeof payload !== 'object' || typeof payload.code !== 'string') return null;
  const program = parseDilExpression(extractRenderExpression(payload.code));
  const { tree, notes } = evaluateDil(program, { constants: payload.constants || {}, appData: payload.appData || {} });
  return { tree, notes, fallbackMarkdown: typeof payload.fallbackMarkdown === 'string' ? payload.fallbackMarkdown : null };
}

export const dilComponentNames = tree => {
  const names = new Map();
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    names.set(node.type, (names.get(node.type) || 0) + 1);
    for (const child of node.children || []) walk(child);
  };
  walk(tree);
  return names;
};

export const dilPlainText = tree => {
  const walk = node => {
    if (node === null || node === undefined) return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(walk).join('');
    const children = (node.children || []).map(walk).join('');
    if (children) return children;
    // Some components carry their text in props rather than children (`math`, `badge`, icons).
    for (const key of ['value', 'text', 'label', 'title', 'content']) {
      const value = node.props?.[key];
      if (typeof value === 'string' || typeof value === 'number') return String(value);
    }
    return '';
  };
  return walk(tree);
};

export { parseHTML };
