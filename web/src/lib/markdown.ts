import { escapeHtml } from "./utils";

type MarkdownList = {
  type: "ul" | "ol";
  items: string[];
};

export function stripMarkdownImages(value: unknown) {
  return String(value || "")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[[^\]]+]\((?:https?:\/\/[^/\s)]+)?\/api\/media\/markdown-assets\/[^)\s]+\)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function markdownAssetVariantUrl(url: string, variant: "preview" | "thumbnail") {
  const match = url.match(/^(?:https?:\/\/[^/\s)]+)?\/api\/media\/markdown-assets\/([^/\s)]+)(?:\/(?:original|preview|thumbnail))?$/);
  return match ? `/api/media/markdown-assets/${match[1]}/${variant}` : null;
}

function renderMarkdownImage(alt: string, url: string) {
  const thumbnailUrl = markdownAssetVariantUrl(url, "thumbnail") || url;
  const fullUrl = markdownAssetVariantUrl(url, "preview") || url;
  return `<a class="markdown-image-link" href="${fullUrl}" data-markdown-image-full="${fullUrl}" rel="noreferrer" target="_blank"><img class="markdown-image" src="${thumbnailUrl}" alt="${alt}" loading="lazy" decoding="async"></a>`;
}

export function renderMarkdownInline(value: unknown) {
  return escapeHtml(value || "")
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g, (_match, alt, url) => renderMarkdownImage(alt, url))
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g, (_match, label, url) => (
      markdownAssetVariantUrl(url, "thumbnail")
        ? renderMarkdownImage(label, url)
        : `<a href="${url}" rel="noreferrer">${label}</a>`
    ))
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
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const quote = line.match(/^>\s?(.+)$/);
    const rule = line.match(/^\s*([-*_])(?:\s*\1){2,}\s*$/);
    if (!line.trim()) {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderMarkdownInline(heading[2])}</h${level}>`);
    } else if (quote) {
      flushParagraph();
      flushList();
      blocks.push(`<blockquote>${renderMarkdownInline(quote[1])}</blockquote>`);
    } else if (rule) {
      flushParagraph();
      flushList();
      blocks.push("<hr>");
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
