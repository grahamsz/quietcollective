export function now() {
  return new Date().toISOString();
}

export function jsonText(value: unknown) {
  return JSON.stringify(value ?? null);
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function normalizeHandle(handle: string) {
  return handle.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

export function extractMentions(value: string) {
  return Array.from(new Set(Array.from(value.matchAll(/(^|\s)@([a-z0-9_-]+)/gi)).map((match) => match[2].toLowerCase())));
}

export function stripMarkdownImages(value: string) {
  return value.replace(/!\[[^\]]*]\([^)]*\)/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

export function normalizeTag(value: string) {
  return value.trim().replace(/^#/, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

export function extractTags(value: string) {
  return Array.from(new Set(
    Array.from(value.matchAll(/(^|[^\w-])#([a-z0-9][a-z0-9_-]{0,79})/gi))
      .map((match) => normalizeTag(match[2]))
      .filter(Boolean),
  ));
}

export function recordTagUse(tags: Map<string, { tag: string; count: number; last_used_at: string }>, tag: string, usedAt: string) {
  const normalized = normalizeTag(tag);
  if (!normalized) return;
  const existing = tags.get(normalized);
  if (existing) {
    existing.count += 1;
    if (usedAt > existing.last_used_at) existing.last_used_at = usedAt;
    return;
  }
  tags.set(normalized, { tag: normalized, count: 1, last_used_at: usedAt });
}

export function recordTextTags(tags: Map<string, { tag: string; count: number; last_used_at: string }>, text: string, usedAt: string) {
  for (const tag of extractTags(text)) recordTagUse(tags, tag, usedAt);
}

export function stringField(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim();
  if (value == null) return fallback;
  return String(value).trim();
}

export function normalizeRoleLabel(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
}

export function normalizeClientUploadKey(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, 120);
}

export function normalizeGalleryOwnership(value: unknown): "self" | "collaborative" | "whole_server" {
  const normalized = stringField(value || "self").toLowerCase().replace(/-/g, "_");
  if (normalized === "whole_server" || normalized === "server_public" || normalized === "community") return "whole_server";
  if (normalized === "collaborative") return "collaborative";
  return "self";
}

export function truthy(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

export function numberField(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function fileField(value: unknown): File | null {
  return value instanceof File ? value : null;
}

export function cacheControl(variant: string) {
  return variant === "original"
    ? "private, no-store"
    : "private, max-age=3600";
}
