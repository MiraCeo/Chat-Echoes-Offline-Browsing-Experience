from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from importers.chatgpt_share.importer import import_share_html, extract_loader_chunks, decode_loader_payload  # noqa: E402
import json
import hashlib
import tempfile
from importers.chatgpt_share.importer import import_share_file, audit_conversation


FIXTURE = (
    ROOT
    / "fixtures"
    / "chatgpt-share"
    / "6a9849f6-3bec-83ee-b032-618d95fc0917"
    / "share.html"
)
SOURCE_URL = "https://chatgpt.com/share/6a9849f6-3bec-83ee-b032-618d95fc0917"


class ChatGptShareImporterAcceptanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.conversation = import_share_html(
            FIXTURE.read_text(encoding="utf-8"), source_url=SOURCE_URL
        )

    def test_identity_and_full_tree_are_preserved(self) -> None:
        conversation = self.conversation
        self.assertEqual(conversation["source"]["share_id"], SOURCE_URL.rsplit("/", 1)[-1])
        self.assertEqual(conversation["title"], "分支 · 测试消息")
        self.assertEqual(len(conversation["nodes"]), 162)
        self.assertEqual(len(conversation["linear_node_ids"]), 162)
        self.assertEqual(len(conversation["messages"]), 161)

    def test_citations_and_content_references_are_not_flattened(self) -> None:
        messages = self.conversation["messages"].values()
        self.assertGreaterEqual(sum(bool(m["content_references"]) for m in messages), 4)
        self.assertGreaterEqual(sum(bool(m["citations"]) for m in messages), 2)
        self.assertTrue(
            any(
                block.get("type") == "file_citation"
                for message in messages
                for block in message["content"]["blocks"]
            )
        )
        web_references = [
            reference
            for message in messages
            for reference in message["content_references"]
            if isinstance(reference, dict) and reference.get("type") == "grouped_webpages"
        ]
        self.assertTrue(web_references)
        self.assertTrue(
            any(
                "help.openai.com" in url
                for reference in web_references
                for url in reference.get("safe_urls", [])
                if isinstance(url, str)
            )
        )

    def test_widget_is_structured_and_numeric_values_are_correct(self) -> None:
        widgets = [
            block
            for message in self.conversation["messages"].values()
            for block in message["content"]["blocks"]
            if block.get("type") == "widget" and block.get("widget_type") == "genui"
        ]
        self.assertEqual(len(widgets), 1)
        chart = widgets[0]["data"]["chart"]["content"]
        self.assertEqual(chart["chartType"], "bar")
        self.assertEqual([row["count"] for row in chart["data"]], [210, 30, 24])

    def test_markdown_capabilities_survive_as_source_text(self) -> None:
        all_text = "\n".join(
            block["text"]
            for message in self.conversation["messages"].values()
            for block in message["content"]["blocks"]
            if block.get("type") == "text"
        )
        self.assertIn("\\[", all_text)
        self.assertIn("| 中文 | English | 数字 | 粗体 | 行内代码 |", all_text)
        self.assertIn("```kotlin", all_text)

    def test_assets_keep_local_and_generated_pointers(self) -> None:
        assets = [
            asset
            for message in self.conversation["messages"].values()
            for asset in message["attachments"]
        ]
        self.assertTrue(any(asset.get("id", "").startswith("file_") for asset in assets))
        self.assertTrue(
            any(str(asset.get("pointer", "")).startswith("sediment://") for asset in assets)
        )
        self.assertTrue(
            any(str(asset.get("pointer", "")).startswith("sandbox:/mnt/data/") for asset in assets)
        )

    def test_raw_page_payload_and_extra_records_survive_json_roundtrip(self) -> None:
        source = FIXTURE.read_text(encoding="utf-8")
        extra = 'P999:[{"future":"extra data"}]\n'
        imported = import_share_html(source + '<script>streamController.enqueue(' + json.dumps(extra) + ');</script>')
        restored = json.loads(json.dumps(imported))
        self.assertEqual(restored['raw_payload']['loader_chunks'], extract_loader_chunks(source) + [extra])
        self.assertIn('loaderData', restored['raw_payload']['decoded_root'])
        self.assertEqual(restored['import_report']['retained_protocol_records'], 2)
        self.assertFalse(any(i['code'] == 'additional_loader_chunks_retained' for i in restored['import_report']['issues']))
        self.assertFalse(restored['import_report']['complete_offline_archive'])

    def test_virtualized_dom_is_audited_but_never_used_as_message_source(self) -> None:
        source = FIXTURE.read_text(encoding="utf-8")
        visible_message_id = next(
            message_id for message_id in self.conversation["linear_message_ids"]
            if self.conversation["messages"][message_id]["role"] == "user"
        )
        captured = import_share_html(
            source + f'<section data-testid="conversation-turn-1"><div data-message-id="{visible_message_id}"></div></section>'
        )
        completeness = captured["completeness"]
        self.assertEqual(completeness["canonical_source"], "structured_react_payload")
        self.assertEqual(completeness["structured_payload"]["status"], "usable")
        self.assertEqual(completeness["rendered_dom"]["status"], "partial_virtualized")
        self.assertEqual(completeness["rendered_dom"]["turn_count"], 1)
        self.assertEqual(len(captured["messages"]), len(self.conversation["messages"]))

    def test_http_share_without_rendered_dom_records_that_fact(self) -> None:
        self.assertEqual(self.conversation["completeness"]["rendered_dom"]["status"], "absent")
        self.assertEqual(self.conversation["completeness"]["structured_payload"]["status"], "usable")

    def test_cycles_and_file_hash(self) -> None:
        decoded = decode_loader_payload([{'_1': 0}, 'self'])
        self.assertEqual(decoded['self'], {'$ceobe_cycle_ref': 0})
        json.dumps(decoded)
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'share.html'
            raw = FIXTURE.read_bytes().replace(b'\n', b'\r\n')
            source.write_bytes(raw)
            result = import_share_file(source, Path(folder) / 'conversation.json')
            self.assertEqual(result['source']['sha256'], hashlib.sha256(raw).hexdigest())
            self.assertEqual(source.read_bytes(), raw)

    def test_missing_order_is_reported(self) -> None:
        report = audit_conversation(self.conversation, {'mapping': self.conversation['nodes']})
        self.assertTrue(any(i['code'] == 'missing_reading_order' for i in report['issues']))


if __name__ == "__main__":
    unittest.main()
