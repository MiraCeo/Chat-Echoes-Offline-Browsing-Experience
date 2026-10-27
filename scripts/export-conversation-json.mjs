/**
 * 把 CEOBE canonical JSON 映射回 ChatGPT 官方导出格式（`conversations.json` 的单个会话）。
 *
 * 保真原则（见 docs/ecosystem.md 方向 3）：
 * - `content.raw` 原样透传，不做 LaTeX/Markdown 改写，也不伪造 `file-service://` id；
 * - 隐藏消息保留在 mapping 里，另在 `ceobe.hidden_message_ids` 标记；
 * - 不导出 `raw_payload`（单会话可达数十 MB，且是抓取过程的旁路记录）；
 * - `nodes` 缺失的旧快照回退成线性 mapping，并标 `ceobe.degraded = true`。
 *
 * 纯函数：附件路径由调用方提供（`attachmentPath(resource)` 返回相对路径或 null），
 * 便于 CLI 与测试使用同一份映射而不碰文件系统。
 */

export const OFFICIAL_EXPORT_FORMAT = 'ceobe.official-export';
export const OFFICIAL_EXPORT_VERSION = 1;
const LINEAR_ROOT = 'client-created-root';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** 官方 message：字段顺序固定，`content` 直接引用归档里的 `content.raw`。 */
export function officialMessage(message) {
  const content = isObject(message?.content?.raw) ? message.content.raw : null;
  const author = isObject(message?.author) ? message.author : { role: message?.role ?? null };
  const value = {
    id: message?.id ?? null,
    author,
    create_time: message?.created_at ?? null,
    update_time: message?.updated_at ?? null,
    content: content || { content_type: message?.content?.type ?? null, parts: [] },
    status: message?.status ?? null,
    end_turn: message?.end_turn ?? null,
    recipient: message?.recipient ?? null,
    channel: message?.channel ?? null,
    metadata: isObject(message?.metadata) ? message.metadata : {},
  };
  // weight 是官方消息的字段之一，归档里有就带上，没有就不凭空补。
  if (message?.raw && Object.hasOwn(message.raw, 'weight')) value.weight = message.raw.weight;
  return value;
}

/**
 * 建立官方 mapping。
 * - 正常快照：逐个 node 输出 `{id,parent,children,message}`，顺序沿用归档里的键顺序；
 * - 缺 nodes：按 `linear_message_ids` 串一条线性链（根节点固定为 `client-created-root`）。
 */
export function buildOfficialMapping(conversation) {
  const messages = isObject(conversation?.messages) ? conversation.messages : {};
  const nodes = isObject(conversation?.nodes) ? conversation.nodes : null;
  const linear = Array.isArray(conversation?.linear_message_ids)
    ? conversation.linear_message_ids.filter(id => typeof id === 'string' && messages[id])
    : Object.keys(messages);
  const hidden = Object.keys(messages).filter(id => messages[id]?.visible === false);
  const degraded = !nodes || Object.keys(nodes).length === 0;
  const mapping = {};
  const missing = [];

  if (!degraded) {
    const referenced = new Set();
    for (const [key, node] of Object.entries(nodes)) {
      if (!isObject(node)) continue;
      const id = String(node.id ?? key);
      const message = node.message_id ? messages[node.message_id] : null;
      if (node.message_id && !message) missing.push(String(node.message_id));
      if (node.message_id) referenced.add(String(node.message_id));
      mapping[id] = {
        id,
        parent: node.parent_id ?? null,
        children: Array.isArray(node.children) ? [...node.children] : [],
        message: message ? officialMessage(message) : null,
      };
    }
    const orphans = Object.keys(messages).filter(id => !referenced.has(id));
    return { mapping, linear, hidden, degraded, missing, orphans };
  }

  // 降级：旧快照没有 nodes。用消息 ID 当节点 ID，保证 mapping 键唯一且可回查。
  const root = messages[LINEAR_ROOT] ? `${LINEAR_ROOT}-root` : LINEAR_ROOT;
  mapping[root] = { id: root, parent: null, children: linear.length ? [linear[0]] : [], message: null };
  let parent = root;
  for (const [index, id] of linear.entries()) {
    const next = linear[index + 1] ?? null;
    mapping[id] = { id, parent, children: next ? [next] : [], message: officialMessage(messages[id]) };
    parent = id;
  }
  return { mapping, linear, hidden, degraded, missing, orphans: [] };
}

/**
 * 当前节点必须可达：优先用归档的 current_node_id，缺失或不在 mapping 时退回线性路径末节点，
 * 并在 `ceobe.current_node_repaired` 里说明（不静默造一个到不了的节点）。
 */
function resolveCurrent(conversation, mapping, linear, degraded) {
  const requested = degraded ? null : conversation.current_node_id;
  if (requested && Object.hasOwn(mapping, requested)) return { current: requested, repaired: false };
  const last = linear.at(-1);
  const node = Object.values(mapping).find(item => item.message?.id === last);
  if (node) return { current: node.id, repaired: true };
  const roots = Object.values(mapping).filter(item => !item.parent);
  return { current: roots.at(-1)?.id ?? null, repaired: true };
}

/**
 * 单个会话 → 官方格式对象。
 * @param {object} conversation canonical CEOBE JSON
 * @param {{title?: string, attachmentPath?: (resource: object) => (string|null)}} options
 */
export function conversationToOfficial(conversation, { title, attachmentPath = () => null } = {}) {
  if (!isObject(conversation) || typeof conversation.title !== 'string') {
    throw new Error('Expected CEOBE JSON with title and messages.');
  }
  const built = buildOfficialMapping(conversation);
  const { mapping, linear, hidden, degraded, missing, orphans } = built;
  const resolved = resolveCurrent(conversation, mapping, linear, degraded);
  const displayTitle = typeof title === 'string' && title ? title : conversation.title;
  const source = isObject(conversation.source) ? conversation.source : null;
  const ceobe = {
    format: OFFICIAL_EXPORT_FORMAT,
    version: OFFICIAL_EXPORT_VERSION,
    source: source ? {
      type: source.type ?? null,
      share_id: source.share_id ?? null,
      url: source.url ?? null,
      captured_at: source.captured_at ?? null,
      sha256: source.sha256 ?? null,
    } : null,
    linear_message_ids: linear,
    hidden_message_ids: hidden,
    resources: (Array.isArray(conversation.resources) ? conversation.resources : []).map(resource => ({
      key: resource.key ?? null,
      name: resource.name ?? null,
      mime_type: resource.mime_type ?? null,
      size_bytes: resource.size_bytes ?? null,
      status: resource.status ?? null,
      local_path: attachmentPath(resource),
      message_ids: Array.isArray(resource.message_ids) ? [...resource.message_ids] : [],
      pointers: Array.isArray(resource.pointers) ? [...resource.pointers] : [],
    })),
    import_report: isObject(conversation.import_report) ? conversation.import_report : null,
    degraded,
  };
  if (displayTitle !== conversation.title) ceobe.original_title = conversation.title;
  if (missing.length) ceobe.missing_message_ids = missing;
  if (orphans.length) ceobe.orphan_message_ids = orphans;
  if (resolved.repaired) ceobe.current_node_repaired = true;
  return {
    title: displayTitle,
    create_time: conversation.created_at ?? null,
    update_time: conversation.updated_at ?? null,
    conversation_id: conversation.id ?? null,
    current_node: resolved.current,
    mapping,
    moderation_results: [],
    plugin_ids: null,
    ceobe,
  };
}

/** 供 CLI 统计：mapping 里的节点/消息数与隐藏数。 */
export function officialStats(official) {
  const nodes = Object.keys(official.mapping).length;
  const messages = Object.values(official.mapping).filter(node => node.message).length;
  return { nodes, messages, hidden: official.ceobe.hidden_message_ids.length, degraded: official.ceobe.degraded };
}
