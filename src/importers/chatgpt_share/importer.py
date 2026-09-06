"""Loss-preserving ChatGPT share-page importer.

The public share page embeds the conversation in a React/Remix slot table.  This
module deliberately keeps the original HTML as the archival source of truth and
creates a stable CEOBE view of the conversation without flattening messages to
Markdown.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


SCHEMA_VERSION = "1.0.0"
ROUTE_PREFIX = "routes/share."
PRIVATE_REFERENCE_RE = re.compile("\ue200([^\ue201\ue202]+)(?:\ue202(.*?))?\ue201", re.DOTALL)
SANDBOX_LINK_RE = re.compile(r"\[([^\]]+)\]\((sandbox:/mnt/data/[^)]+)\)")


def _extract_scripts(html: str) -> Iterable[str]:
    """Yield script bodies without requiring a browser or an HTML dependency."""

    script_re = re.compile(r"<script\b[^>]*>(.*?)</script\s*>", re.IGNORECASE | re.DOTALL)
    for match in script_re.finditer(html):
        yield match.group(1)


def extract_loader_chunks(html: str) -> list[str]:
    """Keep every enqueue payload, including deferred protocol records."""
    chunks: list[str] = []

    decoder = json.JSONDecoder()
    anchor_text = "streamController.enqueue("
    for script in _extract_scripts(html):
        if anchor_text not in script:
            continue
        cursor = 0
        while True:
            anchor = script.find(anchor_text, cursor)
            if anchor < 0:
                break
            anchor += len(anchor_text)
            quote = script.find('"', anchor)
            close = script.find(");", anchor)
            if quote >= 0 and (close < 0 or quote < close):
                try:
                    chunk, cursor = decoder.raw_decode(script, quote)
                except json.JSONDecodeError:
                    cursor = anchor + 1
                    continue
            else:
                if close < 0:
                    break
                chunk = script[anchor:close].strip()
                cursor = close + 2
            if isinstance(chunk, str):
                chunks.append(chunk)
    return chunks


def extract_loader_payload(html: str) -> list[Any]:
    """Find a slot table that actually contains the shared conversation."""
    for chunk in extract_loader_chunks(html):
        try:
            parsed = json.loads(chunk)
            if isinstance(parsed, list):
                _share_route(decode_loader_payload(parsed))
                return parsed
        except (ValueError, TypeError, RecursionError):
            continue
    raise ValueError("ChatGPT React Flight loader payload not found")


class _ConversationDomInventory(HTMLParser):
    """Inventory rendered turns without treating the visual DOM as conversation data."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.active: dict[str, Any] | None = None
        self.turns: list[dict[str, Any]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "section" and str(values.get("data-testid", "")).startswith("conversation-turn-"):
            self.active = {"depth": self.depth, "testid": values.get("data-testid"), "message_ids": []}
        if self.active is not None and values.get("data-message-id"):
            message_id = str(values["data-message-id"])
            if message_id not in self.active["message_ids"]:
                self.active["message_ids"].append(message_id)
        if tag not in {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}:
            self.depth += 1

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if self.active is not None and values.get("data-message-id"):
            message_id = str(values["data-message-id"])
            if message_id not in self.active["message_ids"]:
                self.active["message_ids"].append(message_id)

    def handle_endtag(self, tag: str) -> None:
        if tag not in {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}:
            self.depth = max(0, self.depth - 1)
        if tag == "section" and self.active is not None and self.depth == self.active["depth"]:
            self.turns.append({key: value for key, value in self.active.items() if key != "depth"})
            self.active = None


def assess_capture_completeness(conversation: Mapping[str, Any], html: str) -> dict[str, Any]:
    """Separate structured-payload coverage from the potentially virtualized DOM."""

    nodes = conversation["nodes"]
    messages = conversation["messages"]
    linear_node_ids = conversation["linear_node_ids"]
    linear_message_ids = conversation["linear_message_ids"]
    missing_nodes = [node_id for node_id in linear_node_ids if node_id not in nodes]
    missing_messages = [message_id for message_id in linear_message_ids if message_id not in messages]
    structured_status = "usable" if nodes and linear_node_ids and not missing_nodes and not missing_messages else "incomplete"

    parser = _ConversationDomInventory()
    try:
        parser.feed(html)
    except Exception:
        # The original HTML remains archived even if its optional visual DOM is malformed.
        parser.turns = []
    rendered_ids = list(dict.fromkeys(
        message_id for turn in parser.turns for message_id in turn["message_ids"]
    ))
    expected_ids = [
        message_id for message_id in linear_message_ids
        if message_id in messages
        and messages[message_id].get("visible", True)
        and messages[message_id].get("role") in {"user", "assistant"}
    ]
    missing_rendered_ids = [message_id for message_id in expected_ids if message_id not in rendered_ids] if rendered_ids else []
    if not parser.turns:
        dom_status = "absent"
    elif not rendered_ids:
        dom_status = "unverifiable"
    elif missing_rendered_ids:
        dom_status = "partial_virtualized"
    else:
        dom_status = "covers_visible_messages"

    return {
        "scope": "captured_public_share",
        "canonical_source": "structured_react_payload",
        "structured_payload": {
            "status": structured_status,
            "node_count": len(nodes),
            "message_count": len(messages),
            "reading_order_node_count": len(linear_node_ids),
            "reading_order_message_count": len(linear_message_ids),
            "missing_node_ids": missing_nodes,
            "missing_message_ids": missing_messages,
        },
        "rendered_dom": {
            "status": dom_status,
            "turn_count": len(parser.turns),
            "message_ids": rendered_ids,
            "expected_visible_message_count": len(expected_ids),
            "missing_message_ids": missing_rendered_ids,
            "authoritative": False,
        },
        "renderer_policy": "Rebuild every visible turn from canonical JSON; never infer completeness from the rendered DOM.",
    }


class _SlotDecoder:
    """Decode ChatGPT's indexed slot table without mistaking numeric leaves for refs.

    Container members are slot references.  A number stored *inside the referenced
    slot* is a real numeric value.  ChatPeek's recursive integer resolver conflates
    these two cases, which can turn values such as chart counts into unrelated
    objects elsewhere in the table.
    """

    def __init__(self, slots: Sequence[Any]):
        self.slots = slots
        self.cache: dict[int, Any] = {}
        self.resolving: set[int] = set()

    def decode_root(self) -> Mapping[str, Any]:
        if not self.slots:
            raise ValueError("Empty React Flight loader payload")
        root = self._reference(0)
        if not isinstance(root, Mapping):
            raise ValueError("Unsupported React Flight loader root")
        return root

    def _key(self, key: Any) -> str:
        if isinstance(key, str) and key.startswith("_") and key[1:].isdigit():
            decoded = self._reference(int(key[1:]))
            if isinstance(decoded, str):
                return decoded
        return str(key)

    def _member(self, value: Any) -> Any:
        if type(value) is int:
            if value == -5:
                return None
            if value < 0:
                return {"$ceobe_slot_sentinel": value}
            return self._reference(value)
        return self._inline(value)

    def _inline(self, value: Any) -> Any:
        if isinstance(value, list):
            return [self._member(item) for item in value]
        if isinstance(value, dict):
            return {self._key(key): self._member(item) for key, item in value.items()}
        return value

    def _reference(self, index: int) -> Any:
        if index in self.resolving:
            return {"$ceobe_cycle_ref": index}
        if index in self.cache:
            return self.cache[index]
        if not 0 <= index < len(self.slots):
            return {"$ceobe_invalid_ref": index}

        self.resolving.add(index)
        raw = self.slots[index]
        if isinstance(raw, dict):
            target: dict[str, Any] = {}
            self.cache[index] = target
            for key, value in raw.items():
                target[self._key(key)] = self._member(value)
            decoded: Any = target
        elif isinstance(raw, list):
            target_list: list[Any] = []
            self.cache[index] = target_list
            target_list.extend(self._member(value) for value in raw)
            decoded = target_list
        else:
            # This is the important boundary: an integer in its own slot is data,
            # not another reference.
            decoded = raw
            self.cache[index] = decoded
        self.resolving.remove(index)
        return decoded


def decode_loader_payload(slots: Sequence[Any]) -> Mapping[str, Any]:
    return _SlotDecoder(slots).decode_root()


def _share_route(decoded: Mapping[str, Any]) -> Mapping[str, Any]:
    loader_data = decoded.get("loaderData")
    if not isinstance(loader_data, Mapping):
        raise ValueError("Share loaderData missing")
    for key, value in loader_data.items():
        if str(key).startswith(ROUTE_PREFIX) and isinstance(value, Mapping):
            return value
    raise ValueError("ChatGPT share route missing")


def _reference_block(kind: str, payload: str | None, raw: str) -> dict[str, Any]:
    chunks = payload.split("\ue202") if payload else []
    if kind == "filecite":
        return {
            "type": "file_citation",
            "reference": chunks[0] if chunks else None,
            "locator": chunks[1] if len(chunks) > 1 else None,
            "raw": raw,
        }
    if kind == "cite":
        return {"type": "web_citation", "references": chunks, "raw": raw}
    if kind == "genui":
        serialized = "\ue202".join(chunks)
        try:
            data = json.loads(serialized)
        except (TypeError, json.JSONDecodeError):
            data = None
        return {
            "type": "widget",
            "widget_type": "genui",
            "data": data,
            "raw": raw,
        }
    if kind == "url":
        return {
            "type": "url",
            "title": chunks[0] if chunks else None,
            "url": chunks[1] if len(chunks) > 1 else None,
            "raw": raw,
        }
    return {
        "type": "embedded_reference",
        "reference_type": kind,
        "segments": chunks,
        "raw": raw,
    }


def _tokenize_text(text: str) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    cursor = 0
    for match in PRIVATE_REFERENCE_RE.finditer(text):
        if match.start() > cursor:
            blocks.append({"type": "text", "text": text[cursor : match.start()]})
        blocks.append(_reference_block(match.group(1), match.group(2), match.group(0)))
        cursor = match.end()
    if cursor < len(text):
        blocks.append({"type": "text", "text": text[cursor:]})
    if not blocks and text == "":
        blocks.append({"type": "text", "text": ""})
    return blocks


def _normalise_content(content: Mapping[str, Any]) -> list[dict[str, Any]]:
    content_type = content.get("content_type")
    if content_type == "text":
        blocks: list[dict[str, Any]] = []
        parts = content.get("parts")
        if isinstance(parts, list):
            for part in parts:
                if isinstance(part, str):
                    blocks.extend(_tokenize_text(part))
                else:
                    blocks.append({"type": "unknown_part", "data": part})
        return blocks

    if content_type == "code":
        return [{
            "type": "code",
            "language": content.get("language") if isinstance(content.get("language"), str) else None,
            "text": content.get("text") if isinstance(content.get("text"), str) else "",
        }]

    if content_type == "multimodal_text":
        blocks = []
        parts = content.get("parts")
        if isinstance(parts, list):
            for part in parts:
                if isinstance(part, str):
                    blocks.extend(_tokenize_text(part))
                elif isinstance(part, Mapping):
                    part_type = part.get("content_type") or part.get("type")
                    if part_type in {"image_asset_pointer", "file"}:
                        blocks.append({
                            "type": "asset",
                            "asset_type": "image" if part_type == "image_asset_pointer" else "file",
                            "pointer": part.get("asset_pointer"),
                            "mime_type": part.get("mime_type"),
                            "size_bytes": part.get("size_bytes"),
                            "raw": dict(part),
                        })
                    elif part_type == "text":
                        value = part.get("text")
                        texts = value if isinstance(value, list) else [value]
                        for text in texts:
                            if isinstance(text, str):
                                blocks.extend(_tokenize_text(text))
                    else:
                        blocks.append({"type": "unknown_part", "data": dict(part)})
        return blocks

    # Tool output, reasoning, execution output, and future content types remain
    # typed and fully recoverable through `data` instead of being coerced to text.
    return [{"type": str(content_type or "unknown"), "data": dict(content)}]


def _message_assets(message: Mapping[str, Any], blocks: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    assets: list[dict[str, Any]] = []
    metadata = message.get("metadata")
    if isinstance(metadata, Mapping):
        attachments = metadata.get("attachments")
        if isinstance(attachments, list):
            for attachment in attachments:
                if isinstance(attachment, Mapping):
                    assets.append({"type": "attachment", **dict(attachment)})

    for block in blocks:
        if block.get("type") == "asset":
            assets.append({
                "type": block.get("asset_type", "file"),
                "pointer": block.get("pointer"),
                "mime_type": block.get("mime_type"),
                "size_bytes": block.get("size_bytes"),
            })
        if block.get("type") == "text" and isinstance(block.get("text"), str):
            for label, pointer in SANDBOX_LINK_RE.findall(block["text"]):
                assets.append({"type": "generated_file", "name": label, "pointer": pointer})

    unique: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    for asset in assets:
        key = (asset.get("id"), asset.get("pointer"), asset.get("name"), asset.get("type"))
        if key not in seen:
            seen.add(key)
            unique.append(asset)
    return unique


def _normalise_message(node_id: str, message: Mapping[str, Any]) -> dict[str, Any]:
    author = message.get("author") if isinstance(message.get("author"), Mapping) else {}
    content = message.get("content") if isinstance(message.get("content"), Mapping) else {}
    metadata = message.get("metadata") if isinstance(message.get("metadata"), Mapping) else {}
    blocks = _normalise_content(content)
    return {
        "id": message.get("id") or node_id,
        "role": author.get("role"),
        "author": dict(author),
        "created_at": message.get("create_time"),
        "updated_at": message.get("update_time"),
        "status": message.get("status"),
        "end_turn": message.get("end_turn"),
        "recipient": message.get("recipient"),
        "channel": message.get("channel"),
        "content": {
            "type": content.get("content_type"),
            "blocks": blocks,
            "raw": dict(content),
        },
        "attachments": _message_assets(message, blocks),
        "citations": metadata.get("citations") if isinstance(metadata.get("citations"), list) else [],
        "content_references": (
            metadata.get("content_references")
            if isinstance(metadata.get("content_references"), list)
            else []
        ),
        "metadata": dict(metadata),
        "visible": not bool(metadata.get("is_visually_hidden_from_conversation")),
        "raw": dict(message),
    }


def import_share_html(
    html: str,
    *,
    source_url: str | None = None,
    source_file: str | None = None,
) -> dict[str, Any]:
    """Convert saved ChatGPT share HTML into the CEOBE canonical schema."""

    slots = extract_loader_payload(html)
    decoded = decode_loader_payload(slots)
    route = _share_route(decoded)
    server_response = route.get("serverResponse")
    if not isinstance(server_response, Mapping):
        raise ValueError("Share serverResponse missing")
    data = server_response.get("data")
    if not isinstance(data, Mapping):
        raise ValueError("Share conversation data missing")

    mapping = data.get("mapping") if isinstance(data.get("mapping"), Mapping) else {}
    nodes: dict[str, Any] = {}
    messages: dict[str, Any] = {}
    for raw_id, raw_node in mapping.items():
        node_id = str(raw_id)
        if not isinstance(raw_node, Mapping):
            continue
        raw_message = raw_node.get("message")
        message = _normalise_message(node_id, raw_message) if isinstance(raw_message, Mapping) else None
        nodes[node_id] = {
            "id": node_id,
            "parent_id": raw_node.get("parent"),
            "children": raw_node.get("children") if isinstance(raw_node.get("children"), list) else [],
            "message_id": message.get("id") if message else None,
            "raw": dict(raw_node),
        }
        if message:
            messages[str(message["id"])] = message

    linear = data.get("linear_conversation")
    linear_node_ids = [
        str(entry.get("id"))
        for entry in linear
        if isinstance(entry, Mapping) and entry.get("id") is not None
    ] if isinstance(linear, list) else []
    linear_message_ids = [
        nodes[node_id]["message_id"]
        for node_id in linear_node_ids
        if node_id in nodes and nodes[node_id].get("message_id") is not None
    ]

    html_bytes = html.encode("utf-8")
    share_id = route.get("sharedConversationId")
    conversation = {
        "schema_version": SCHEMA_VERSION,
        "kind": "ceobe.conversation",
        "id": data.get("conversation_id") or share_id,
        "title": data.get("title") or "ChatGPT conversation",
        "created_at": data.get("create_time"),
        "updated_at": data.get("update_time"),
        "current_node_id": data.get("current_node"),
        "source": {
            "type": "chatgpt_share",
            "share_id": share_id,
            "url": source_url,
            "file": source_file,
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "sha256": hashlib.sha256(html_bytes).hexdigest(),
            "format": "chatgpt_react_flight_html",
        },
        "linear_node_ids": linear_node_ids,
        "linear_message_ids": linear_message_ids,
        "nodes": nodes,
        "messages": messages,
        "metadata": {
            key: value
            for key, value in data.items()
            if key not in {"mapping", "linear_conversation"}
        },
        "raw_payload": {
            "loader_chunks": extract_loader_chunks(html),
            "decoded_root": decoded,
        },
    }
    conversation["completeness"] = assess_capture_completeness(conversation, html)
    conversation["import_report"] = audit_conversation(conversation, data)
    return conversation


def audit_conversation(conversation: Mapping[str, Any], data: Mapping[str, Any]) -> dict[str, Any]:
    nodes = conversation["nodes"]
    messages = conversation["messages"]
    issues: list[dict[str, Any]] = []
    def issue(code: str, detail: Any) -> None:
        issues.append({"code": code, "detail": detail})
    if not nodes:
        issue("empty_mapping", "No message nodes available")
    linear = data.get("linear_conversation")
    if not isinstance(linear, list) or not linear:
        issue("missing_reading_order", "No usable linear_conversation")
    ids = conversation["linear_node_ids"]
    if len(ids) != len(set(ids)):
        issue("duplicate_reading_order_ids", "Repeated node in reading order")
    if isinstance(linear, list) and len(linear) != len(ids):
        issue("invalid_reading_order_entries", len(linear) - len(ids))
    missing = [node_id for node_id in ids if node_id not in nodes]
    if missing:
        issue("missing_reading_order_nodes", missing)
    for node in nodes.values():
        for related in [node["parent_id"], *node["children"]]:
            if related is not None and str(related) not in nodes:
                issue("missing_tree_node", {"node": node["id"], "reference": related})
    raw_mapping = data.get("mapping", {})
    if isinstance(raw_mapping, Mapping) and len(raw_mapping) != len(nodes):
        issue("unparsed_mapping_entries", len(raw_mapping) - len(nodes))
    raw_message_ids = [str(node["message_id"]) for node in nodes.values() if node["message_id"] is not None]
    if len(raw_message_ids) != len(set(raw_message_ids)):
        issue("duplicate_message_ids", "Normalized messages share an ID; raw nodes retained")
    current = conversation.get("current_node_id")
    if current is not None and str(current) not in nodes:
        issue("missing_current_node", current)
    chunks = conversation["raw_payload"]["loader_chunks"]
    assets = []
    seen = set()
    for message in messages.values():
        for asset in message["attachments"]:
            key = (asset.get("id"), asset.get("pointer"), asset.get("name"))
            if key in seen:
                continue
            seen.add(key)
            assets.append({**asset, "local_status": "not_downloaded"})
    return {
        "scope": "Data supplied by this captured share page; not the private account conversation",
        "status": "needs_review" if issues else "structure_checked",
        "complete_offline_archive": False,
        "counts": {
            "nodes": len(nodes), "messages": len(messages), "reading_order_nodes": len(ids),
            "loader_chunks": len(chunks),
            "rendered_dom_turns": conversation.get("completeness", {}).get("rendered_dom", {}).get("turn_count", 0),
        },
        "completeness": conversation.get("completeness"),
        "retained_protocol_records": max(0, len(chunks) - 1),
        "issues": issues,
        "assets": assets,
        "note": "Attachment pointers do not establish that original files are available offline",
    }


def import_share_file(
    input_path: Path,
    output_path: Path,
    *,
    source_url: str | None = None,
) -> dict[str, Any]:
    raw_bytes = input_path.read_bytes()
    html = raw_bytes.decode("utf-8")
    conversation = import_share_html(
        html,
        source_url=source_url,
        source_file=input_path.as_posix(),
    )
    conversation["source"]["sha256"] = hashlib.sha256(raw_bytes).hexdigest()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(conversation, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return conversation
