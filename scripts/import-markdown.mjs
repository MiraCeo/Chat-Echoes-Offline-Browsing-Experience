import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const entries = await readdir(projectRoot, { withFileTypes: true });
const markdownFiles = entries
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md") && entry.name !== "README.md")
  .map((entry) => entry.name);

if (markdownFiles.length === 0) {
  throw new Error("项目根目录中没有可导入的 Markdown conversation。");
}

const sourceName = markdownFiles[0];
const sourcePath = join(projectRoot, sourceName);
const source = (await readFile(sourcePath, "utf8")).replaceAll("\r\n", "\n");
const lines = source.split("\n");

const titleMatch = lines.find((line) => /^#\s+/.test(line));
const dateMatch = lines.find((line) => /^_\d{4}-\d{2}-\d{2}[^_]*_$/.test(line.trim()));
const title = titleMatch?.replace(/^#\s+/, "").trim() || basename(sourceName, ".md");
const exportedAt = dateMatch?.trim().slice(1, -1) || null;

const marker = /^### (User|Assistant)\s*$/gm;
const chunks = [];
let match;
let previous = null;

while ((match = marker.exec(source)) !== null) {
  if (previous) {
    chunks.push({
      role: previous.role.toLowerCase(),
      markdown: source.slice(previous.contentStart, match.index).trim(),
    });
  }
  previous = { role: match[1], contentStart: marker.lastIndex };
}

if (previous) {
  chunks.push({
    role: previous.role.toLowerCase(),
    markdown: source.slice(previous.contentStart).trim(),
  });
}

const isActivity = (markdown) => {
  const value = markdown.trim();
  return /^_[^\n]{1,240}_$/.test(value) && (
    /思考|搜索|梳理|评估|校准|停止/.test(value) ||
    value.includes(":") || value.includes("：")
  );
};

const isToolOutput = (markdown) => {
  const value = markdown.trim();
  return /^```[\s\S]*```$/.test(value) || value === "This code was redacted.";
};

const contentType = (role, markdown) => {
  if (role !== "assistant") return "markdown";
  if (isActivity(markdown)) return "activity";
  if (isToolOutput(markdown)) return "tool";
  return "markdown";
};

const messages = [];
for (const chunk of chunks) {
  const last = messages.at(-1);
  if (chunk.role === "assistant" && last?.role === "assistant") {
    last.content.push({
      type: contentType(chunk.role, chunk.markdown),
      text: chunk.markdown,
    });
    continue;
  }

  messages.push({
    id: `message-${messages.length + 1}`,
    role: chunk.role,
    content: [{
      type: contentType(chunk.role, chunk.markdown),
      text: chunk.markdown,
    }],
  });
}

const conversation = {
  schemaVersion: "0.1.0",
  id: basename(sourceName, ".md"),
  title,
  createdAt: exportedAt,
  updatedAt: exportedAt,
  source: {
    type: "markdown",
    filename: sourceName,
  },
  messages,
  metadata: {
    importedAt: new Date().toISOString(),
    sourceChunkCount: chunks.length,
  },
};

const outputDirectory = join(projectRoot, "public", "data");
await mkdir(outputDirectory, { recursive: true });
await writeFile(
  join(outputDirectory, "conversation.json"),
  `${JSON.stringify(conversation, null, 2)}\n`,
  "utf8",
);

console.log(`Imported ${sourceName}: ${chunks.length} source chunks → ${messages.length} conversation turns.`);
