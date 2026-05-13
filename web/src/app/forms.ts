// @ts-nocheck
import EasyMDE from "easymde";
import { icon } from "../components/icons";
import { renderMarkdown } from "../lib/markdown";
import { imageUploadVariants } from "../lib/utils";
import { api } from "./api";
import { bindMarkdownMentionAutocomplete } from "./mentions";
import { toast } from "./toast";

function field(form, name) {
  return form.elements[name];
}

function formDataObject(form) {
  const data = {};
  for (const [key, value] of new FormData(form).entries()) data[key] = value;
  return data;
}


function markdownHint() {
  return `<span class="field-hint">Markdown supported. Use @handle to mention members and #tag to tag ideas.</span>`;
}


function bindJsonForm(selector, handler) {
  const form = document.querySelector(selector);
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    syncMarkdownEditors(form);
    const submit = form.querySelector("[type=submit]");
    submit?.setAttribute("disabled", "disabled");
    try {
      await handler(formDataObject(form), form);
    } catch (error) {
      toast(error.message, "error");
    } finally {
      submit?.removeAttribute("disabled");
    }
  });
}

function markdownImageAlt(value) {
  return String(value || "").replace(/\s+/g, " ").replace(/]/g, "\\]").trim();
}

function markdownImageUrl(value) {
  return encodeURI(String(value || "")).replace(/([\\()])/g, "\\$1");
}

function insertMarkdownImage(editor, imageUrl) {
  const cm = editor?.codemirror;
  if (!cm || !imageUrl) return false;
  const from = cm.getCursor("from");
  const startIndex = cm.indexFromPos(from);
  const alt = markdownImageAlt(cm.getSelection());
  const markdown = `![${alt}](${markdownImageUrl(imageUrl)})`;
  cm.replaceSelection(markdown);
  cm.setCursor(cm.posFromIndex(startIndex + markdown.length));
  cm.focus();
  return true;
}

function enhanceMarkdownEditors(scope = document) {
  scope.querySelectorAll("textarea[data-markdown-editor]:not([data-editor-ready])").forEach((textarea) => {
    textarea.dataset.editorReady = "true";
    if (textarea.required) {
      textarea.dataset.required = "true";
      textarea.required = false;
    }
    const targetType = textarea.dataset.targetType || textarea.closest("[data-target-type]")?.dataset.targetType || "draft";
    const targetId = textarea.dataset.targetId || textarea.closest("[data-target-id]")?.dataset.targetId || "";
    let editor;
    editor = new EasyMDE({
      element: textarea,
      autofocus: false,
      spellChecker: false,
      status: false,
      minHeight: textarea.dataset.editorMinHeight || "130px",
      renderingConfig: { singleLineBreaks: false },
      previewRender: (plainText) => renderMarkdown(plainText),
      uploadImage: true,
      imageAccept: "image/png, image/jpeg, image/gif, image/webp",
      imageMaxSize: 1024 * 1024 * 10,
      imageUploadFunction: async (file, onSuccess, onError) => {
        try {
          const { preview, thumbnail } = await imageUploadVariants(file);
          const body = new FormData();
          body.set("file", file);
          body.set("preview", preview);
          body.set("thumbnail", thumbnail);
          body.set("target_type", targetType);
          if (targetId) body.set("target_id", targetId);
          const data = await api("/api/markdown-assets", { method: "POST", body });
          const imageUrl = data.url || data.data?.filePath;
          if (!insertMarkdownImage(editor, imageUrl)) onSuccess(imageUrl);
          textarea.value = editor.value();
        } catch (error) {
          onError(error.message || "Image upload failed");
        }
      },
      toolbar: [
        { name: "bold", action: EasyMDE.toggleBold, icon: icon("bold"), title: "Bold" },
        { name: "italic", action: EasyMDE.toggleItalic, icon: icon("italic"), title: "Italic" },
        { name: "quote", action: EasyMDE.toggleBlockquote, icon: icon("quote"), title: "Quote" },
        { name: "unordered-list", action: EasyMDE.toggleUnorderedList, icon: icon("list"), title: "Bulleted list" },
        { name: "ordered-list", action: EasyMDE.toggleOrderedList, icon: icon("list-ordered"), title: "Numbered list" },
        "|",
        { name: "link", action: EasyMDE.drawLink, icon: icon("link"), title: "Link" },
        { name: "upload-image", action: EasyMDE.drawUploadedImage, icon: icon("image"), title: "Upload image" },
        "|",
        { name: "preview", action: EasyMDE.togglePreview, icon: icon("eye"), title: "Preview", noDisable: true },
      ],
    });
    textarea._easyMDE = editor;
    bindMarkdownMentionAutocomplete(editor.codemirror);
    editor.codemirror.on("change", () => {
      textarea.value = editor.value();
    });
  });
}

function syncMarkdownEditors(scope = document) {
  scope.querySelectorAll("textarea[data-markdown-editor]").forEach((textarea) => {
    if (textarea._easyMDE) textarea.value = textarea._easyMDE.value();
  });
}


export { bindJsonForm, enhanceMarkdownEditors, field, formDataObject, markdownHint, syncMarkdownEditors };
