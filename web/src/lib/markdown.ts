import { escapeHtml } from "./utils";

type MarkdownList = {
  type: "ul" | "ol";
  items: string[];
};

export function stripMarkdownImages(value: unknown) {
  return String(value || "").replace(/!\[[^\]]*]\([^)]*\)/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

export function renderMarkdownInline(value: unknown) {
  return escapeHtml(value || "")
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g, '<img class="markdown-image" src="$2" alt="$1">')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/(^|\s)@([a-z0-9_-]+)/gi, '$1<a href="/members/$2" data-link>@$2</a>')
    .replace(/(^|\s)#([a-z0-9_-]+)/gi, '$1<a class="text-tag" href="/tags/$2" data-link>#$2</a>');
}

export function renderMarkdown(value: unknown) {
  const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: MarkdownList | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${paragraph.map(renderMarkdownInline).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push(`<${list.type}>${list.items.map((item) => `<li>${renderMarkdownInline(item)}</li>`).join("")}</${list.type}>`);
    list = null;
  };

  for (const line of lines) {
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (!line.trim()) {
      flushParagraph();
      flushList();
    } else if (unordered || ordered) {
      const type: MarkdownList["type"] = unordered ? "ul" : "ol";
      const item = (unordered || ordered)?.[1] || "";
      flushParagraph();
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push(item);
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks.join("");
}

export function renderMarkdownNoImages(value: unknown) {
  return renderMarkdownInline(stripMarkdownImages(value)).replace(/\n/g, "<br>");
}
