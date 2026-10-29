#!/usr/bin/env node
// 零依赖输出校验器：node validate-output.mjs --input input --output output
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const inputDir = resolve(option('--input', 'input'));
const outputDir = resolve(option('--output', 'output'));
const errors = [];
const warnings = [];
const chars = value => [...value].length;

const readManifest = async () => {
  const path = join(inputDir, 'manifest.json');
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    errors.push(`找不到 ${path}`);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    errors.push(`manifest.json 不是合法 JSON：${error.message}`);
    return null;
  }
};

const checkText = (label, value, { min = 1, max = Infinity, required = true } = {}) => {
  if (typeof value !== 'string') {
    if (required) errors.push(`${label} 必须是字符串`);
    return;
  }
  const length = chars(value.trim());
  if (required && length < min) errors.push(`${label} 长度不足（${length} < ${min}）`);
  if (length > max) errors.push(`${label} 过长（${length} > ${max}）`);
};

const manifest = await readManifest();
if (manifest) {
  if (manifest.kind !== 'ceobe.memory-input') errors.push('manifest.kind 不是 ceobe.memory-input');
  if (manifest.schema_version !== '1.0.0') errors.push(`不支持的 manifest.schema_version：${manifest.schema_version}`);
  if (!Array.isArray(manifest.conversations)) errors.push('manifest.conversations 不是数组');
}

const conversations = Array.isArray(manifest?.conversations) ? manifest.conversations : [];
const ids = new Set();
for (const conversation of conversations) {
  if (!conversation || typeof conversation !== 'object') {
    errors.push('manifest 中存在非法会话条目');
    continue;
  }
  if (!conversation.id) errors.push('manifest 中存在没有 id 的会话');
  if (ids.has(conversation.id)) errors.push(`manifest 中 id 重复：${conversation.id}`);
  ids.add(conversation.id);
  for (const key of ['last_message_id', 'source_hash', 'file']) {
    if (typeof conversation[key] !== 'string' || !conversation[key]) {
      errors.push(`${conversation.id || '(unknown)'} 缺少 ${key}`);
    }
  }
}

let outputFiles = [];
try {
  outputFiles = (await readdir(outputDir)).filter(name => name.endsWith('.json'));
} catch {
  errors.push(`找不到输出目录 ${outputDir}`);
}

const seen = new Set();
for (const conversation of conversations) {
  if (!conversation?.id) continue;
  const expectedFile = `${conversation.id}.json`;
  if (!outputFiles.includes(expectedFile)) {
    errors.push(`${conversation.id} 缺少输出文件 ${expectedFile}`);
    continue;
  }
  seen.add(expectedFile);
  let record;
  try {
    record = JSON.parse(await readFile(join(outputDir, expectedFile), 'utf8'));
  } catch (error) {
    errors.push(`${expectedFile} 不是合法 JSON：${error.message}`);
    continue;
  }
  const label = `${expectedFile}`;
  if (record.id !== conversation.id) errors.push(`${label} 的 id 不匹配`);
  if (!['fresh', 'failed'].includes(record.status)) errors.push(`${label} status 必须是 fresh/failed`);
  checkText(`${label} generator.model`, record.generator?.model, { max: 120 });
  checkText(`${label} generator.prompt_version`, record.generator?.prompt_version, { max: 80 });
  checkText(`${label} generator.run_id`, record.generator?.run_id, { max: 120 });
  checkText(`${label} source.last_message_id`, record.source?.last_message_id, { max: 200 });
  checkText(`${label} source.source_hash`, record.source?.source_hash, { max: 200 });
  if (record.source?.last_message_id !== conversation.last_message_id) {
    errors.push(`${label} 的 last_message_id 与 manifest 不一致`);
  }
  if (record.source?.source_hash !== conversation.source_hash) {
    errors.push(`${label} 的 source_hash 与 manifest 不一致`);
  }
  if (typeof record.generated_at !== 'string' || Number.isNaN(Date.parse(record.generated_at))) {
    errors.push(`${label} generated_at 不是可解析日期`);
  }

  if (record.status === 'fresh') {
    checkText(`${label} summary`, record.summary, { min: 1, max: 160 });
    if (!Array.isArray(record.tags)) {
      errors.push(`${label} tags 必须是数组`);
    } else {
      if (record.tags.length < 3 || record.tags.length > 4) {
        errors.push(`${label} fresh 需要 3–4 个 tag（当前 ${record.tags.length}）`);
      }
      const unique = new Set();
      for (const [index, tag] of record.tags.entries()) {
        checkText(`${label} tags[${index}]`, tag, { min: 2, max: 16 });
        if (typeof tag === 'string' && unique.has(tag.trim())) errors.push(`${label} tag 重复：${tag}`);
        if (typeof tag === 'string') unique.add(tag.trim());
      }
    }
    if (record.error != null && record.error !== '') {
      warnings.push(`${label} 是 fresh，但 error 非空`);
    }
  } else {
    checkText(`${label} error`, record.error, { min: 1, max: 200 });
  }
}

for (const file of outputFiles) {
  if (!seen.has(file)) warnings.push(`输出目录里有 manifest 之外的 ${file}`);
}

console.log(`input:  ${inputDir}`);
console.log(`output: ${outputDir}`);
console.log(`manifest: ${conversations.length} conversation(s)`);
console.log(`output:   ${outputFiles.length} json file(s)`);
if (warnings.length) {
  console.log(`\nWARN (${warnings.length})`);
  for (const warning of warnings) console.log(`- ${warning}`);
}
if (errors.length) {
  console.log(`\nERROR (${errors.length})`);
  for (const error of errors) console.log(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('\nPASS: output matches the input manifest contract.');
}
