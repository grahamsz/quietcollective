type SortableByTime = {
  created_at?: string | null;
  updated_at?: string | null;
};

export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function encodePath(value: unknown) {
  return encodeURIComponent(String(value ?? ""));
}

export function newestFirst(a: SortableByTime, b: SortableByTime) {
  return String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || ""));
}

export function clientKey(prefix = "qc") {
  if (crypto.randomUUID) return `${prefix}:${crypto.randomUUID()}`;
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}

export async function resizeImageForUpload(file: File, maxDimension: number, label: string, quality = 0.86) {
  if (!file.type.startsWith("image/")) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  if (scale === 1 && file.type === "image/webp") {
    bitmap.close?.();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return file;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
  if (!blob) return file;
  const base = (file.name || "image").replace(/\.[^.]+$/, "");
  return new File([blob], `${base}-${label}.webp`, { type: "image/webp", lastModified: Date.now() });
}

export async function imageUploadVariants(file: File) {
  const [preview, thumbnail] = await Promise.all([
    resizeImageForUpload(file, 2048, "preview", 0.88),
    resizeImageForUpload(file, 512, "thumb", 0.82),
  ]);
  return { preview, thumbnail };
}

export function initials(name: unknown) {
  const bits = String(name || "QC").trim().split(/\s+/).slice(0, 2);
  return bits.map((bit) => bit[0]?.toUpperCase() || "").join("") || "QC";
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function relativeTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  const units: Array<[string, number]> = [["y", 31536000], ["mo", 2592000], ["d", 86400], ["h", 3600], ["m", 60]];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return `${Math.round(Math.abs(seconds) / size)}${unit} ${seconds >= 0 ? "ago" : "from now"}`;
  }
  return seconds >= 10 ? `${Math.abs(seconds)}s ago` : "now";
}

export function activeLabel(value: string | null | undefined) {
  if (!value) return "not active yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "not active yet";
  if (date.toDateString() === new Date().toDateString()) return "active today";
  return `last active ${relativeTime(value)}`;
}
