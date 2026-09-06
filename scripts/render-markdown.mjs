import hljs from "highlight.js";
import katex from "katex";
import { marked, Renderer } from "marked";
import { htmlSafeSvg } from './serialize-html.mjs';

const labels = {
  bash: "Bash", shell: "Shell", sh: "Shell", html: "HTML",
  java: "Java", javascript: "JavaScript", js: "JavaScript",
  json: "JSON", kotlin: "Kotlin", kt: "Kotlin",
  python: "Python", py: "Python", text: "Text",
  typescript: "TypeScript", ts: "TypeScript",
};

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll('"', "&quot;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

const genuiChart = (source, officialChartTemplates) => {
  try {
    const specification = JSON.parse(source);
    const content = specification?.chart?.content;
    const series = content?.series?.[0];
    const data = Array.isArray(content?.data) ? content.data : [];
    if (!content || !series || data.length === 0) return null;
    const officialTemplate = officialChartTemplates?.[content.meta?.title];
    if (officialTemplate) return officialTemplate;
    const values = data.map((item) => Number(item[series.dataKey]) || 0);
    const maximum = Math.max(...values, 1);
    const bars = data.map((item, index) => {
      const label = item[content.xKey] ?? "";
      const value = values[index];
      const width = Math.max((value / maximum) * 100, value > 0 ? 2 : 0);
      return [
        '<div class="ceobe-chart-row"><span class="ceobe-chart-label">',
        escapeHtml(label),
        '</span><span class="ceobe-chart-track"><span class="ceobe-chart-bar" style="width:',
        width,
        '%"></span></span><strong>',
        escapeHtml(value),
        "</strong></div>",
      ].join("");
    }).join("");
    const title = content.meta?.title || "图表";
    const description = content.meta?.description || "";
    return [
      '<div class="ceobe-chart" role="img" aria-label="', escapeHtml(description || title), '">',
      '<div class="ceobe-chart-title">', escapeHtml(title), "</div>",
      description ? '<div class="ceobe-chart-description">' + escapeHtml(description) + "</div>" : "",
      '<div class="ceobe-chart-body">', bars, "</div></div>",
    ].join("");
  } catch {
    return null;
  }
};

const enhanceCodeBlocks = (document, container) => {
  for (const code of [...container.querySelectorAll("pre > code")]) {
    const originalPre = code.parentElement;
    const languageClass = [...code.classList].find((name) => name.startsWith("language-"));
    const language = languageClass?.slice("language-".length).toLowerCase() || "text";
    const source = code.textContent.replace(/\n$/, "");
    const highlighted = language !== "text" && hljs.getLanguage(language)
      ? hljs.highlight(source, { language }).value
      : escapeHtml(source);
    const wrapper = document.createElement("div");
    wrapper.className = "relative w-full mt-4 mb-1 ceobe-code-block";
    wrapper.innerHTML = [
      '<div class="border border-token-border-light border-radius-3xl corner-superellipse/1.1 rounded-3xl">',
      '<div class="relative h-full w-full border-radius-3xl bg-(--code-block-surface) corner-superellipse/1.1 overflow-clip rounded-3xl [--code-block-surface:var(--bg-elevated-secondary)] dark:[--code-block-surface:var(--composer-surface-primary)] lxnfua_clipPathFallback">',
      '<div class="select-none sticky z-2 top-(--sticky-padding-top)"><div class="flex w-full items-center justify-between py-1.5 ps-4 pe-1.5 font-sans md:ps-5 bg-(--code-block-surface)">',
      '<div class="flex max-w-[75%] min-w-0 cursor-default items-center text-sm font-medium justify-self-start text-token-text-primary">',
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" aria-hidden="true" class="icon-sm me-2.5 shrink-0"><use href="/cdn/assets/sprites-core-26c3f2d4.svg#72c6a7" fill="currentColor"></use></svg>',
      escapeHtml(labels[language] || language),
      '</div><div class="flex flex-row items-center gap-0.5 justify-self-end"><button type="button" class="flex gap-1 items-center select-none py-2 text-sm font-medium size-9 rounded-full px-2" aria-label="复制" tabindex="-1">',
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" aria-hidden="true" class="icon-md"><use href="/cdn/assets/sprites-core-26c3f2d4.svg#7fccfb" fill="currentColor"></use></svg>',
      '</button></div></div></div><div class="relative z-0 flex max-w-full">',
      '<div dir="ltr" class="q9tKkq_viewer cm-editor z-10 light:cm-light dark:cm-light flex h-full w-full flex-col items-stretch ceobe-code-viewer"><div class="cm-scroller">',
      '<pre class="cm-content q9tKkq_readonly m-0"><code class="language-', escapeHtml(language), '">', highlighted,
      "</code></pre></div></div></div></div></div>",
    ].join("");
    originalPre.replaceWith(wrapper);
  }
};

const enhanceTables = (document, container, officialTableTemplate) => {
  for (const table of [...container.querySelectorAll("table")]) {
    if (table.parentElement?.classList.contains("TyagGW_tableWrapper")) continue;
    if (officialTableTemplate) {
      const holder = document.createElement('div');
      holder.innerHTML = htmlSafeSvg(officialTableTemplate);
      const wrapper = holder.firstElementChild;
      const capturedTable = wrapper?.querySelector('table');
      if (wrapper && capturedTable) {
        table.className = capturedTable.className;
        for (const cell of table.querySelectorAll('th, td')) {
          const sourceCell = capturedTable.querySelector(cell.localName);
          if (sourceCell) {
            cell.className = sourceCell.className;
            for (const attribute of sourceCell.attributes) {
              if (attribute.name !== 'class') cell.setAttribute(attribute.name, attribute.value);
            }
          }
        }
        table.replaceWith(wrapper);
        capturedTable.replaceWith(table);
        continue;
      }
    }
    table.className = "w-fit min-w-(--thread-content-width)";
    for (const cell of table.querySelectorAll("th, td")) {
      cell.setAttribute("data-col-size", "sm");
      cell.classList.add("last:pe-10");
    }
    const wrapper = document.createElement("div");
    wrapper.setAttribute("tabindex", "-1");
    wrapper.className = "TyagGW_tableWrapper flex flex-col-reverse w-fit";
    table.replaceWith(wrapper);
    wrapper.append(table);
    const actions = document.createElement("div");
    actions.className = "relative h-0 self-end select-none";
    actions.innerHTML = '<div class="absolute end-0 flex items-end ceobe-table-actions"><button aria-label="复制表格" tabindex="-1" class="text-token-text-secondary relative z-10 my-1 rounded-sm p-1"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" aria-hidden="true" class="icon"><use href="/cdn/assets/sprites-core-26c3f2d4.svg#7fccfb" fill="currentColor"></use></svg></button></div>';
    wrapper.prepend(actions);
  }
};

export const renderAssistantMarkdown = (
  document,
  source,
  { officialChartTemplates = {}, officialTableTemplate, contentReferences = [], officialCitations, generatedFiles } = {},
) => {
  const math = [];
  const sources = [];
  const charts = [];
  const references = [];
  const referenceByToken = new Map(
    contentReferences
      .filter((reference) => reference && typeof reference.matched_text === "string")
      .map((reference) => [reference.matched_text, reference]),
  );
  const normalized = source
    .replace(/\uE200([^\uE201\uE202]+)(?:\uE202(.*?))?\uE201/gs, (raw, kind, payload = "") => {
      if (kind === "genui") {
        const rendered = genuiChart(payload, officialChartTemplates);
        if (!rendered) return raw;
        const token = "CEOBECHART" + charts.length + "TOKEN";
        charts.push({ token, rendered });
        return "\n\n" + token + "\n\n";
      }
      if (kind === "url") {
        const [title = "网页来源", url = "#"] = payload.split("\uE202");
        const token = "CEOBESOURCE" + sources.length + "TOKEN";
        sources.push({ token, title, url });
        return token;
      }
      if (kind === "filecite" || kind === "cite") {
        const reference = referenceByToken.get(raw) || {};
        const rendered = kind === "filecite"
          ? officialCitations.file(reference)
          : officialCitations.web(reference);
        const token = "CEOBEREFERENCE" + references.length + "TOKEN";
        references.push({ token, rendered });
        return token;
      }
      return raw;
    })
    .replace(/(^|[\t \u3000。，；、])file(?:[\t ]+file)*[\t ]*$/gm, "$1")
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, expression) => {
      const token = "CEOBEMATHBLOCK" + math.length + "TOKEN";
      math.push({ token, expression: expression.trim(), displayMode: true });
      return "\n\n" + token + "\n\n";
    })
    .replace(/\\\((.+?)\\\)/g, (_, expression) => {
      const token = "CEOBEMATHINLINE" + math.length + "TOKEN";
      math.push({ token, expression: expression.trim(), displayMode: false });
      return token;
    })
    .replace(/^url(.+?)(https?:\/\/\S+)\s*$/gm, (_, title, url) => {
      const token = "CEOBESOURCE" + sources.length + "TOKEN";
      sources.push({ token, title: title.trim(), url });
      return "\n\n" + token + "\n\n";
    })
    .replace(/^genui(\{.+\})\s*$/gm, (full, json) => {
      const rendered = genuiChart(json, officialChartTemplates);
      if (!rendered) return full;
      const token = "CEOBECHART" + charts.length + "TOKEN";
      charts.push({ token, rendered });
      return "\n\n" + token + "\n\n";
    });

  // Imported conversation HTML is text, not executable application markup.
  const renderer = new Renderer();
  renderer.html = token => escapeHtml(token.text);
  let html = marked.parse(normalized, { renderer });
  for (const item of math) {
    const rendered = katex.renderToString(item.expression, {
      displayMode: item.displayMode,
      output: "html",
      strict: false,
      throwOnError: false,
    });
    if (item.displayMode) html = html.replace("<p>" + item.token + "</p>", rendered);
    html = html.replaceAll(item.token, rendered);
  }
  for (const item of sources) {
    const rendered = officialCitations.url(item.title, item.url);
    html = html.replaceAll(item.token, rendered);
  }
  for (const item of charts) {
    html = html.replace("<p>" + item.token + "</p>", item.rendered);
    html = html.replaceAll(item.token, item.rendered);
  }
  for (const item of references) {
    html = html.replaceAll(item.token, item.rendered);
  }

  const container = document.createElement("div");
  container.innerHTML = htmlSafeSvg(html);
  generatedFiles?.enhance(container);
  for (const element of container.querySelectorAll('a[href], img[src]')) {
    const attribute = element.localName === 'a' ? 'href' : 'src';
    const value = (element.getAttribute(attribute) || '').replace(/[\u0000-\u0020]/g, '');
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^(https?:|mailto:)/i.test(value)) {
      element.removeAttribute(attribute);
      element.setAttribute('title', '该资源尚未关联可用的本地地址');
    }
  }
  enhanceCodeBlocks(document, container);
  enhanceTables(document, container, officialTableTemplate);
  return htmlSafeSvg(container.innerHTML);
};
