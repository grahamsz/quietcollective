import type { WorkRow, WorkVersionRow } from "./types";

export type ZipEntry = {
  path: string;
  data: Uint8Array;
  modifiedAt?: Date;
};

export type ExportWorkVersionRow = WorkVersionRow & {
  work_title: string;
};

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function concatBytes(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function createZip(entries: ZipEntry[]) {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path.replace(/^\/+/, ""));
    const checksum = crc32(entry.data);
    const { time, date } = dosDateTime(entry.modifiedAt);
    const local = new Uint8Array(30 + name.length + entry.data.length);
    writeUint32(local, 0, 0x04034b50);
    writeUint16(local, 4, 20);
    writeUint16(local, 6, 0x0800);
    writeUint16(local, 8, 0);
    writeUint16(local, 10, time);
    writeUint16(local, 12, date);
    writeUint32(local, 14, checksum);
    writeUint32(local, 18, entry.data.length);
    writeUint32(local, 22, entry.data.length);
    writeUint16(local, 26, name.length);
    writeUint16(local, 28, 0);
    local.set(name, 30);
    local.set(entry.data, 30 + name.length);
    locals.push(local);

    const record = new Uint8Array(46 + name.length);
    writeUint32(record, 0, 0x02014b50);
    writeUint16(record, 4, 20);
    writeUint16(record, 6, 20);
    writeUint16(record, 8, 0x0800);
    writeUint16(record, 10, 0);
    writeUint16(record, 12, time);
    writeUint16(record, 14, date);
    writeUint32(record, 16, checksum);
    writeUint32(record, 20, entry.data.length);
    writeUint32(record, 24, entry.data.length);
    writeUint16(record, 28, name.length);
    writeUint16(record, 30, 0);
    writeUint16(record, 32, 0);
    writeUint16(record, 34, 0);
    writeUint16(record, 36, 0);
    writeUint32(record, 38, 0);
    writeUint32(record, 42, offset);
    record.set(name, 46);
    central.push(record);
    offset += local.length;
  }

  const centralDirectory = concatBytes(central);
  const end = new Uint8Array(22);
  writeUint32(end, 0, 0x06054b50);
  writeUint16(end, 4, 0);
  writeUint16(end, 6, 0);
  writeUint16(end, 8, entries.length);
  writeUint16(end, 10, entries.length);
  writeUint32(end, 12, centralDirectory.length);
  writeUint32(end, 16, offset);
  writeUint16(end, 20, 0);
  return concatBytes([...locals, centralDirectory, end]);
}

export function archiveSafeName(value: string, fallback = "item") {
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  return cleaned || fallback;
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function worksCsv(works: WorkRow[], versions: ExportWorkVersionRow[], galleriesByWork: Map<string, string[]>, assetsByWork: Map<string, string[]>) {
  const versionCount = new Map<string, number>();
  for (const version of versions) versionCount.set(version.work_id, (versionCount.get(version.work_id) || 0) + 1);
  const rows = [
    ["work_id", "title", "description", "type", "galleries", "created_at", "updated_at", "feedback_requested", "feedback_prompt", "current_version_id", "version_count", "high_res_files"],
    ...works.map((work) => [
      work.id,
      work.title,
      work.description,
      work.type,
      (galleriesByWork.get(work.id) || []).join("; "),
      work.created_at,
      work.updated_at,
      work.feedback_requested ? "yes" : "no",
      work.feedback_prompt || "",
      work.current_version_id || "",
      String(versionCount.get(work.id) || 0),
      (assetsByWork.get(work.id) || []).join("; "),
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export async function addR2ArchiveEntry(bucket: R2Bucket, entries: ZipEntry[], key: string, path: string): Promise<number | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  const data = new Uint8Array(await object.arrayBuffer());
  entries.push({ path, data });
  return data.length;
}
