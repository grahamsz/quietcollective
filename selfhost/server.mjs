import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import worker, { runScheduledTasks } from "../worker/src/index.ts";
import { StaticAssetsBinding } from "./assets.mjs";
import { SQLiteD1Database, applyMigrations } from "./d1-sqlite.mjs";
import { FilesystemMediaBucket } from "./fs-media.mjs";
import { createLocalQueue } from "./queue.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultAppDir = process.env.QC_APP_DIR || path.resolve(__dirname, "../..");
const dataDir = process.env.QC_DATA_DIR || "/data";
const port = Number.parseInt(process.env.PORT || "8787", 10);
const host = process.env.HOST || "0.0.0.0";

function randomSecret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function parseEnvFile(filePath) {
  try {
    const rows = readFileSync(filePath, "utf8").split(/\r?\n/);
    const values = {};
    for (const row of rows) {
      const match = row.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) values[match[1]] = match[2];
    }
    return values;
  } catch {
    return {};
  }
}

function ensureGeneratedSecrets(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const existing = parseEnvFile(filePath);
  const next = { ...existing };
  const created = {};

  if (!process.env.JWT_SECRET && !next.JWT_SECRET) {
    next.JWT_SECRET = randomSecret();
    created.JWT_SECRET = next.JWT_SECRET;
  }
  if (!process.env.ADMIN_SETUP_TOKEN && !next.ADMIN_SETUP_TOKEN) {
    next.ADMIN_SETUP_TOKEN = randomSecret(24);
    created.ADMIN_SETUP_TOKEN = next.ADMIN_SETUP_TOKEN;
  }

  if (Object.keys(created).length) {
    writeFileSync(filePath, Object.entries(next).map(([key, value]) => `${key}=${value}`).join("\n") + "\n", { mode: 0o600 });
  }

  return { values: next, created };
}

function requestUrl(req) {
  const protocol = req.headers["x-forwarded-proto"] || "http";
  const hostHeader = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${port}`;
  return `${protocol}://${hostHeader}${req.url || "/"}`;
}

function requestFromIncoming(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value != null) {
      headers.set(key, value);
    }
  }
  const init = {
    method: req.method,
    headers,
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = Readable.toWeb(req);
    init.duplex = "half";
  }
  return new Request(requestUrl(req), init);
}

function createExecutionContext() {
  const tasks = [];
  return {
    waitUntil(task) {
      const promise = Promise.resolve(task).catch((error) => console.error("[selfhost] waitUntil failed", error));
      tasks.push(promise);
    },
    passThroughOnException() {},
    async drain() {
      await Promise.all(tasks);
    },
  };
}

async function writeNodeResponse(res, response) {
  res.statusCode = response.status;
  res.statusMessage = response.statusText;
  const getSetCookie = response.headers.getSetCookie?.bind(response.headers);
  const setCookies = getSetCookie ? getSetCookie() : [];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") res.setHeader(key, value);
  });
  if (setCookies.length) res.setHeader("Set-Cookie", setCookies);
  if (!response.body) {
    res.end();
    return;
  }
  Readable.fromWeb(response.body).pipe(res);
}

function queueBatch(body) {
  return {
    messages: [{
      body,
      ack() {},
      retry() {},
    }],
  };
}

const generatedEnvPath = path.join(dataDir, "generated.env");
const generated = ensureGeneratedSecrets(generatedEnvPath);
const databasePath = process.env.QC_SQLITE_PATH || path.join(dataDir, "quietcollective.sqlite");
const mediaDir = process.env.QC_MEDIA_DIR || path.join(dataDir, "media");
const publicDir = process.env.QC_PUBLIC_DIR || path.join(defaultAppDir, "public");
const migrationsDir = process.env.QC_MIGRATIONS_DIR || path.join(defaultAppDir, "migrations");

mkdirSync(mediaDir, { recursive: true });

const db = new SQLiteD1Database(databasePath);
applyMigrations(db, migrationsDir);

const env = {
  ASSETS: new StaticAssetsBinding(publicDir),
  DB: db,
  MEDIA: new FilesystemMediaBucket(mediaDir),
  INSTANCE_NAME: process.env.INSTANCE_NAME || "QuietCollective",
  SITE_URL: process.env.SITE_URL || `http://localhost:${port}`,
  SOURCE_CODE_URL: process.env.SOURCE_CODE_URL || "",
  JWT_SECRET: process.env.JWT_SECRET || generated.values.JWT_SECRET,
  ADMIN_SETUP_TOKEN: process.env.ADMIN_SETUP_TOKEN || generated.values.ADMIN_SETUP_TOKEN,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_USERNAME: process.env.SMTP_USERNAME,
  SMTP_PASSWORD: process.env.SMTP_PASSWORD,
  SMTP_FROM_EMAIL: process.env.SMTP_FROM_EMAIL,
  SMTP_REPLY_TO: process.env.SMTP_REPLY_TO,
  SMTP_CONFIG_SECRET: process.env.SMTP_CONFIG_SECRET,
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
  VAPID_SUBJECT: process.env.VAPID_SUBJECT,
};

env.JOBS = createLocalQueue(async (body) => worker.queue(queueBatch(body), env));

const cronSeconds = Number.parseInt(process.env.QC_CRON_INTERVAL_SECONDS || "86400", 10);
if (Number.isFinite(cronSeconds) && cronSeconds > 0) {
  setInterval(() => {
    runScheduledTasks(env).catch((error) => console.error("[selfhost] scheduled tasks failed", error));
  }, cronSeconds * 1000).unref();
}

if (generated.created.ADMIN_SETUP_TOKEN) {
  console.log(`[selfhost] generated ADMIN_SETUP_TOKEN: ${generated.created.ADMIN_SETUP_TOKEN}`);
  console.log(`[selfhost] generated secrets persisted at ${generatedEnvPath}`);
}

const server = createServer(async (req, res) => {
  const ctx = createExecutionContext();
  try {
    const response = await worker.fetch(requestFromIncoming(req), env, ctx);
    await writeNodeResponse(res, response);
  } catch (error) {
    console.error("[selfhost] request failed", error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
    }
    res.end(JSON.stringify({ error: "Internal server error" }));
  } finally {
    ctx.drain().catch((error) => console.error("[selfhost] background task failed", error));
  }
});

server.listen(port, host, () => {
  console.log(`[selfhost] QuietCollective listening on http://${host}:${port}`);
  console.log(`[selfhost] SQLite database: ${databasePath}`);
  console.log(`[selfhost] media directory: ${mediaDir}`);
});

