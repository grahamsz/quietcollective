// @ts-nocheck
import { api } from "./api";
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

function enhanceMarkdownEditors(scope = document) {
  if (!window.EasyMDE) return;
  scope.querySelectorAll("textarea[data-markdown-editor]:not([data-editor-ready])").forEach((textarea) => {
    textarea.dataset.editorReady = "true";
    if (textarea.required) {
      textarea.dataset.required = "true";
      textarea.required = false;
    }
    const targetType = textarea.dataset.targetType || textarea.closest("[data-target-type]")?.dataset.targetType || "draft";
    const targetId = textarea.dataset.targetId || textarea.closest("[data-target-id]")?.dataset.targetId || "";
    const editor = new EasyMDE({
      element: textarea,
      autofocus: false,
      spellChecker: false,
      status: false,
      minHeight: textarea.dataset.editorMinHeight || "130px",
      renderingConfig: { singleLineBreaks: false },
      uploadImage: true,
      imageAccept: "image/png, image/jpeg, image/gif, image/webp",
      imageMaxSize: 1024 * 1024 * 10,
      imageUploadFunction: async (file, onSuccess, onError) => {
        try {
          const body = new FormData();
          body.set("file", file);
          body.set("target_type", targetType);
          if (targetId) body.set("target_id", targetId);
          const data = await api("/api/markdown-assets", { method: "POST", body });
          onSuccess(data.url || data.data?.filePath);
        } catch (error) {
          onError(error.message || "Image upload failed");
        }
      },
      toolbar: [
        { name: "bold", action: EasyMDE.toggleBold, text: "B", title: "Bold" },
        { name: "italic", action: EasyMDE.toggleItalic, text: "I", title: "Italic" },
        { name: "heading", action: EasyMDE.toggleHeadingSmaller, text: "H", title: "Heading" },
        "|",
        { name: "quote", action: EasyMDE.toggleBlockquote, text: "Quote", title: "Quote" },
        { name: "unordered-list", action: EasyMDE.toggleUnorderedList, text: "List", title: "Bulleted list" },
        { name: "ordered-list", action: EasyMDE.toggleOrderedList, text: "1.", title: "Numbered list" },
        "|",
        { name: "link", action: EasyMDE.drawLink, text: "Link", title: "Link" },
        { name: "upload-image", action: EasyMDE.drawUploadedImage, text: "Image", title: "Upload image" },
        "|",
        { name: "preview", action: EasyMDE.togglePreview, text: "Preview", title: "Preview" },
      ],
    });
    textarea._easyMDE = editor;
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
