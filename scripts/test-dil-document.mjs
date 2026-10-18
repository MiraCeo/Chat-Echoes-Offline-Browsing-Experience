import assert from 'node:assert/strict';
import {
  dilComponentNames,
  dilPlainText,
  extractRenderExpression,
  parseDilExpression,
  readDilDocument,
  tokenize,
} from './dil-document.mjs';

// The DIL reader must understand the payload subset without ever executing it: no eval, no vm, no host
// objects. Everything below runs against the payload's own constants table.
const payload = {
  code: [
    'function __dilSafe(evaluate,failureValue){try{return evaluate()}catch{return failureValue}}',
    '',
    'DIL.render(__dil.jsx(()=>{',
    'const __dilConstants=DIL.useConstants();',
    'const __dilModelDataBindings=DIL.useAppData((appData)=>appData.opGenui?.modelDataBindings??{});',
    'const [mode,setMode]=DIL.useState("survival",{key:"mode"});',
    'return __dil.jsx(__dil.Fragment,null,',
    '__dil.jsx("text",null,__dilConstants["0"],__dil.jsx("bold",null,__dilConstants["1"])),',
    '__dil.jsx("title",{"size":"lg"},__dilConstants["2"]),',
    '__dil.jsx("table",null,__dil.jsx("table-row",null,__dil.jsx("table-cell",{"header":true},__dilConstants["3"]),__dil.jsx("table-cell",{"align":"end"},__dilConstants["4"]))),',
    '__dil.jsx("list",null,__dilConstants["5"].map((item,index)=>__dil.jsx("list-item",{"key":index},item,__dilSafe(()=>(index+1),null)))),',
    '__dil.jsx("text",null,`合计 ${__dilSafe(()=>(Math.round(12.3456*100)/100),0)} 项`),',
    '__dilConstants["6"]==null?null:__dilConstants["6"].type==="math"?__dil.jsx("math",{"value":__dilConstants["6"].value}):null,',
    '__dil.jsx(Cite,{"refs":__dilConstants["7"]}),__dil.jsx(FileCite,{"ref":"turn0file0"}),__dil.jsx(Link,{"url":"https://example.com","title":__dilConstants["8"]})',
    ');},{"key":"body:0"}));',
  ].join('\n'),
  constants: {
    0: '开头', 1: '加粗', 2: '小标题', 3: '项目', 4: '价格',
    5: ['甲', '乙'], 6: { type: 'math', value: 'x^2' }, 7: ['turn1view0'], 8: '示例站点',
  },
  fallbackMarkdown: '# 回退',
};

const expression = extractRenderExpression(payload.code);
assert.ok(expression.startsWith('__dil.jsx('), 'the render expression is extracted from the preamble');
assert.ok(!expression.includes('__dilSafe(evaluate'), 'the helper preamble stays out of the expression');

const document = readDilDocument(payload);
assert.deepEqual(document.notes, [], 'a well-formed payload resolves without notes');
assert.equal(document.tree.type, 'fragment');
const names = dilComponentNames(document.tree);
assert.equal(names.get('fragment'), 1);
assert.equal(names.get('title'), 1);
assert.equal(names.get('table-cell'), 2);
assert.equal(names.get('list-item'), 2, 'array map over constants produces one node per entry');
assert.equal(names.get('math'), 1, 'the ternary branch chosen by constants["6"].type is the math one');
assert.equal(names.get('Cite'), 1, 'components referenced as identifiers keep their names');
assert.equal(names.get('FileCite'), 1);
assert.equal(names.get('Link'), 1);

const text = dilPlainText(document.tree);
assert.ok(text.includes('开头') && text.includes('加粗') && text.includes('小标题'));
assert.ok(text.includes('甲1乙2'), 'mapped list items contribute their text and the index expression');
assert.ok(text.includes('合计 12.35 项'), 'template holes evaluate arithmetic and Math shims');
assert.ok(text.includes('x^2'));

const link = document.tree.children.find(child => child.type === 'Link');
assert.deepEqual(link.props, { url: 'https://example.com', title: '示例站点' }, 'props survive unchanged');
const fileCite = document.tree.children.find(child => child.type === 'FileCite');
assert.equal(fileCite.props.ref, 'turn0file0');

// Declarations, optional chaining, nullish coalescing and loose null comparison all resolve quietly.
const scoped = readDilDocument({
  code: 'DIL.render(__dil.jsx(()=>{const a=DIL.useState(1);const b=__dilConstants["x"]??"缺省";return __dil.jsx("text",null,a[0],b,__dilConstants["missing"]==null?"无":"有");},{"key":"k"}));',
  constants: {},
});
assert.deepEqual(scoped.notes, []);
assert.equal(dilPlainText(scoped.tree), '1缺省无');

// Nothing host-side is reachable: unknown identifiers, members and callees degrade to undefined and
// are recorded as notes instead of running.
const hostile = readDilDocument({
  code: 'DIL.render(__dil.jsx(()=>{const data=require("node:fs").readFileSync("/etc/passwd","utf8");return __dil.jsx("text",null,process.env.SECRET,data);},{"key":"k"}));',
  constants: {},
});
assert.equal(dilPlainText(hostile.tree), '', 'an unresolved value renders as empty text');
assert.ok(hostile.notes.length >= 2, 'unknown identifiers and callees are recorded, not executed');
assert.ok(hostile.notes.some(note => note.includes('require') || note.includes('readFileSync')),
  `notes explain what was skipped: ${hostile.notes}`);

// Malformed input fails loudly at parse time rather than rendering something wrong.
assert.throws(() => parseDilExpression('__dil.jsx('), /Expected|Unsupported|Unexpected/);
assert.equal(readDilDocument({ code: 42 }), null);
assert.equal(readDilDocument(null), null);
assert.throws(() => extractRenderExpression('nothing to see'), /DIL\.render/);
assert.deepEqual(tokenize('a===1?"x":"y"').map(token => token.value), ['a', '===', 1, '?', 'x', ':', 'y']);

console.log('DIL documents parse and evaluate without execution: constants, maps, ternaries, templates, hooks and component identifiers verified.');
