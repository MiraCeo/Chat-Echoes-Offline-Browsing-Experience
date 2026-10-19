/**
 * Convert a logged-in web capture into CEOBE canonical JSON.
 *
 * Input: either the extension's `ceobe.response-capture` wrapper (an array of captured responses, of
 * which one carries the conversation) or a raw conversation JSON as returned by
 * GET /backend-api/conversations/<id>?num_turns=….
 *
 * The web endpoint returns a linear `messages` array (no mapping/branch tree) and paginates with
 * `page_info`. So the canonical file is built as a linear path: messages sorted by create_time,
 * one node per message, and `completeness.structured_payload.status = usable_linear` to make the
 * missing branch tree explicit instead of pretending this is a share capture.
 *
 * Usage:
 *   node scripts/convert-web-capture.mjs --input <capture.json> [--output out.ceobe.json]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const KNOWN = new Set(['text', 'multimodal_text', 'code', 'thoughts', 'reasoning_recap', 'execution_output',
  'model_editable_context', 'tether_browsing_display', 'tether_quote', 'system_error', 'user_editable_context']);

const textOf = parts => (Array.isArray(parts) ? parts : []).filter(part => typeof part === 'string').join('');
const assetOf = parts => (Array.isArray(parts) ? parts : [])
  .filter(part => part && typeof part === 'object' && part.asset_pointer)
  .map(part => ({
    type: 'asset',
    asset_type: part.content_type === 'image_asset_pointer' ? 'image' : 'file',
    asset_pointer: part.asset_pointer,
    pointer: part.asset_pointer,
    metadata: part.metadata || null,
  }));

export const blocksFromContent = content => {
  const type = content?.content_type || 'text';
  const parts = content?.parts ?? (content?.text ? [content.text] : []);
  const text = textOf(parts);
  const assets = assetOf(parts);
  if (type === 'code') {
    return [{ type: 'code', language: content?.language || 'text', text: content?.text || text }];
  }
  if (type === 'thoughts') {
    return [{ type: 'thoughts', data: content }];
  }
  if (type === 'reasoning_recap') {
    return [{ type: 'reasoning_recap', data: content }];
  }
  if (type === 'model_editable_context' || type === 'user_editable_context') {
    return [{ type, data: content }];
  }
  const blocks = [];
  if (text) blocks.push({ type: 'text', text });
  blocks.push(...assets);
  if (!blocks.length) {
    blocks.push({ type: KNOWN.has(type) ? type : 'unknown', data: content });
  }
  return blocks;
};

export const messageFromApi = message => ({
  id: message.id,
  role: message.author?.role || null,
  content: {
    type: message.content?.content_type || null,
    blocks: blocksFromContent(message.content),
    raw: message.content || {},
  },
  attachments: message.metadata?.attachments || [],
  citations: message.metadata?.citations || [],
  content_references: message.metadata?.content_references || [],
  metadata: message.metadata || {},
  visible: !(message.metadata?.is_visually_hidden_from_conversation === true),
  raw: message,
});

export const pickConversation = payload => {
  if (payload && Array.isArray(payload.messages) && payload.conversation_id) return payload;
  const responses = Array.isArray(payload?.responses) ? payload.responses : [];
  let best = null;
  for (const response of responses) {
    try {
      const parsed = JSON.parse(response.text);
      if (parsed && Array.isArray(parsed.messages) && parsed.conversation_id) {
        if (!best || parsed.messages.length > best.messages.length) best = parsed;
      }
    } catch { /* not this one */ }
  }
  return best;
};

export const convertWebCapture = (payload, { capturedAt = new Date().toISOString(), sourceUrl = null } = {}) => {
  const conversation = pickConversation(payload);
  if (!conversation) throw new Error('capture carries no conversation with messages + conversation_id');
  const messages = conversation.messages
    .slice()
    .sort((left, right) => (left.create_time || 0) - (right.create_time || 0));
  const byId = {};
  for (const message of messages) byId[message.id] = messageFromApi(message);
  const linear = messages.map(message => message.id);
  const nodes = {};
  messages.forEach((message, index) => {
    nodes[message.id] = {
      id: message.id,
      parent_id: index === 0 ? null : messages[index - 1].id,
      children: index === messages.length - 1 ? [] : [messages[index + 1].id],
      message_id: message.id,
      raw: {},
    };
  });
  const visible = Object.values(byId).filter(message => message.visible);
  return {
    schema_version: '1.0.0',
    kind: 'ceobe.conversation',
    id: conversation.conversation_id,
    title: conversation.title || '未命名会话',
    created_at: conversation.create_time || null,
    updated_at: conversation.update_time || null,
    current_node_id: conversation.current_node || null,
    source: {
      type: 'chatgpt_web',
      conversation_id: conversation.conversation_id,
      url: sourceUrl,
      captured_at: capturedAt,
      format: 'chatgpt_web_conversation_endpoint',
      sha256: createHash('sha256').update(JSON.stringify(conversation)).digest('hex'),
      pagination: conversation.page_info || null,
    },
    linear_node_ids: linear,
    linear_message_ids: linear,
    nodes,
    messages: byId,
    completeness: {
      scope: 'captured_logged_in_conversation',
      canonical_source: 'conversation_endpoint',
      structured_payload: {
        status: 'usable_linear',
        message_count: messages.length,
        visible_message_count: visible.length,
        note: 'The web endpoint returns a linear message list without a branch tree; branches are not captured.',
      },
      rendered_dom: { status: 'absent', authoritative: false },
      renderer_policy: 'Rebuild every visible turn from canonical JSON; never infer completeness from the rendered DOM.',
    },
    import_report: {
      status: 'structure_checked',
      scope: 'Captured from the signed-in web session by the CEOBE extension; not a public share capture.',
      counts: { messages: messages.length, visible: visible.length },
      issues: [],
      assets: [],
      resources: [],
      resource_counts: { downloaded: 0, unresolved: 0, failed: 0 },
      complete_offline_archive: false,
      note: 'Attachments are not downloaded by the converter; run the resource step before treating this as offline-complete.',
    },
  };
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const { values } = parseArgs({ options: { input: { type: 'string' }, output: { type: 'string' } } });
  if (!values.input) {
    console.error('Usage: node scripts/convert-web-capture.mjs --input <capture.json> [--output out.ceobe.json]');
    process.exitCode = 2;
  } else {
    const payload = JSON.parse(await readFile(resolve(values.input), 'utf8'));
    const conversation = convertWebCapture(payload, { sourceUrl: values.input });
    const output = resolve(values.output || `data/private/web-capture/${conversation.id}.ceobe.json`);
    await writeFile(output, `${JSON.stringify(conversation, null, 2)}\n`, 'utf8');
    const roles = {};
    for (const message of Object.values(conversation.messages)) {
      const role = message.role || 'unknown';
      roles[role] = (roles[role] || 0) + 1;
    }
    console.log(`${output} (${(Buffer.byteLength(JSON.stringify(conversation)) / 1024).toFixed(0)} KB)`);
    console.log('messages:', Object.keys(conversation.messages).length, 'roles:', JSON.stringify(roles));
  }
}
