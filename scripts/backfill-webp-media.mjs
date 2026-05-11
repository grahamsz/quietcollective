#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);

function option(name, fallback = "") {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

function sqlString(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function usage() {
  console.log(`Backfill WebP preview and thumbnail variants for existing QuietCollective image versions.

Usage:
  npm run media:backfill:webp -- [options]

Options:
  --remote                 Use remote D1/R2 resources. Default unless --local is set.
  --local                  Use local Wrangler D1/R2 resources.
  --config <path>          Wrangler config path, for example /tmp/quietcollective-wrangler.jsonc.
  --database <name>        D1 database name or binding. Default: quietcollective.
  --bucket <name>          R2 bucket name. Default: quietcollective-media.
  --limit <n>              Process at most n versions.
  --dry-run                Print the versions that would be processed.
  --keep-temp              Leave downloaded and converted files in /tmp for inspection.
  --help                   Show this help.

Requires ImageMagick (magick or convert) on PATH.`);
}

if (hasFlag("--help")) {
  usage();
  process.exit(0);
}

const wrangler = process.env.WRANGLER_BIN || "wrangler";
const config = option("--config", process.env.WRANGLER_CONFIG || "");
const database = option("--database", "quietcollective");
const bucket = option("--bucket", "quietcollective-media");
const limit = Number.parseInt(option("--limit", "0"), 10);
const dryRun = hasFlag("--dry-run");
const keepTemp = hasFlag("--keep-temp");
const storageMode = hasFlag("--local") ? "--local" : "--remote";

function baseWranglerArgs() {
  return config ? ["--config", config] : [];
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: options.encoding === null ? undefined : "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0) {
    const stderr = options.capture && result.stderr ? `\n${result.stderr}` : "";
    throw new Error(`${command} ${commandArgs.join(" ")} failed with exit ${result.status}${stderr}`);
  }
  return result.stdout;
}

function findImageMagick() {
  for (const candidate of ["magick", "convert"]) {
    const probe = spawnSync(candidate, ["-version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    if (probe.status === 0) return candidate;
  }
  return "";
}

function extractRows(payload) {
  if (Array.isArray(payload)) {
    for (const item of payload) {
      if (Array.isArray(item?.results)) return item.results;
      if (Array.isArray(item?.result?.results)) return item.result.results;
    }
  }
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.result?.[0]?.results)) return payload.result[0].results;
  return [];
}

function d1Query(sql) {
  const output = run(wrangler, [
    ...baseWranglerArgs(),
    "d1",
    "execute",
    database,
    storageMode,
    "--yes",
    "--json",
    "--command",
    sql,
  ], { capture: true });
  return extractRows(JSON.parse(output));
}

function d1Exec(sql) {
  run(wrangler, [
    ...baseWranglerArgs(),
    "d1",
    "execute",
    database,
    storageMode,
    "--yes",
    "--command",
    sql,
  ]);
}

function r2Get(key, destination) {
  run(wrangler, [
    ...baseWranglerArgs(),
    "r2",
    "object",
    "get",
    `${bucket}/${key}`,
    storageMode,
    "--file",
    destination,
  ]);
}

function r2Put(key, source) {
  run(wrangler, [
    ...baseWranglerArgs(),
    "r2",
    "object",
    "put",
    `${bucket}/${key}`,
    storageMode,
    "--file",
    source,
    "--content-type",
    "image/webp",
    "--cache-control",
    "private, max-age=3600",
  ]);
}

function convertWebp(tool, source, destination, maxDimension, quality) {
  const sourceFrame = `${source}[0]`;
  run(tool, [
    sourceFrame,
    "-auto-orient",
    "-resize",
    `${maxDimension}x${maxDimension}>`,
    "-strip",
    "-quality",
    String(quality),
    destination,
  ]);
  if (!existsSync(destination)) throw new Error(`Expected converted file ${destination}`);
}

function sourceExtension(key) {
  const ext = path.extname(key || "").toLowerCase().replace(/[^.a-z0-9]/g, "");
  return ext || ".image";
}

const imageTool = findImageMagick();
if (!imageTool && !dryRun) {
  console.error("ImageMagick is required. Install `magick` or `convert`, or rerun with --dry-run.");
  process.exit(1);
}

const sql = `
SELECT work_versions.id, work_versions.work_id, work_versions.original_r2_key,
       work_versions.preview_r2_key, work_versions.preview_content_type,
       work_versions.thumbnail_r2_key, work_versions.thumbnail_content_type
FROM work_versions
JOIN works ON works.id = work_versions.work_id
WHERE works.deleted_at IS NULL
  AND works.type = 'image'
  AND COALESCE(work_versions.original_r2_key, work_versions.preview_r2_key, work_versions.thumbnail_r2_key) IS NOT NULL
  AND (
    work_versions.preview_r2_key IS NULL
    OR work_versions.thumbnail_r2_key IS NULL
    OR lower(COALESCE(work_versions.preview_content_type, '')) != 'image/webp'
    OR lower(COALESCE(work_versions.thumbnail_content_type, '')) != 'image/webp'
  )
ORDER BY work_versions.created_at DESC
${Number.isFinite(limit) && limit > 0 ? `LIMIT ${limit}` : ""}
`;

const rows = d1Query(sql);
if (!rows.length) {
  console.log("No image versions need WebP backfill.");
  process.exit(0);
}

console.log(`Found ${rows.length} image version${rows.length === 1 ? "" : "s"} to backfill using ${storageMode.slice(2)} resources.`);
if (dryRun) {
  for (const row of rows) {
    const sourceKey = row.original_r2_key || row.preview_r2_key || row.thumbnail_r2_key;
    console.log(`${row.id}: ${sourceKey} -> works/${row.work_id}/versions/${row.id}/{preview,thumbnail}.webp`);
  }
  process.exit(0);
}

const tempDir = await mkdtemp(path.join(os.tmpdir(), "quietcollective-webp-"));
console.log(`Using temporary directory ${tempDir}`);

let converted = 0;
try {
  for (const row of rows) {
    const sourceKey = row.original_r2_key || row.preview_r2_key || row.thumbnail_r2_key;
    if (!sourceKey) continue;

    const sourcePath = path.join(tempDir, `${row.id}-source${sourceExtension(sourceKey)}`);
    const previewPath = path.join(tempDir, `${row.id}-preview.webp`);
    const thumbnailPath = path.join(tempDir, `${row.id}-thumbnail.webp`);
    const previewKey = `works/${row.work_id}/versions/${row.id}/preview.webp`;
    const thumbnailKey = `works/${row.work_id}/versions/${row.id}/thumbnail.webp`;

    console.log(`Backfilling ${row.id}`);
    r2Get(sourceKey, sourcePath);
    convertWebp(imageTool, sourcePath, previewPath, 2048, 86);
    convertWebp(imageTool, sourcePath, thumbnailPath, 512, 82);
    r2Put(previewKey, previewPath);
    r2Put(thumbnailKey, thumbnailPath);
    d1Exec(`
UPDATE work_versions
SET preview_r2_key = ${sqlString(previewKey)},
    preview_content_type = 'image/webp',
    thumbnail_r2_key = ${sqlString(thumbnailKey)},
    thumbnail_content_type = 'image/webp'
WHERE id = ${sqlString(row.id)}
`);
    converted += 1;
  }
} finally {
  if (!keepTemp) await rm(tempDir, { recursive: true, force: true });
}

console.log(`Backfilled ${converted} image version${converted === 1 ? "" : "s"} to WebP preview and thumbnail variants.`);
