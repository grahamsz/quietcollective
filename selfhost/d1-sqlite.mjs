import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const MIGRATIONS_TABLE = "qc_selfhost_migrations";

function normalizeValue(value) {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "bigint") return Number(value);
  return value;
}

function looksReadable(sql) {
  const trimmed = sql.trim().replace(/^--.*$/gm, "").trim().toUpperCase();
  return /^(SELECT|WITH|PRAGMA|EXPLAIN)\b/.test(trimmed) || /\bRETURNING\b/.test(trimmed);
}

function d1Result(results, meta = {}) {
  return {
    results,
    success: true,
    meta: {
      duration: 0,
      rows_read: meta.rows_read || 0,
      rows_written: meta.rows_written || 0,
    },
  };
}

class SQLiteD1PreparedStatement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new SQLiteD1PreparedStatement(this.database, this.sql, values.map(normalizeValue));
  }

  first(columnName) {
    const row = this.database.prepare(this.sql).get(...this.values);
    if (!row) return Promise.resolve(null);
    return Promise.resolve(columnName ? row[columnName] ?? null : row);
  }

  all() {
    const rows = this.database.prepare(this.sql).all(...this.values);
    return Promise.resolve(d1Result(rows, { rows_read: rows.length }));
  }

  raw() {
    const rows = this.database.prepare(this.sql).all(...this.values);
    return Promise.resolve(rows.map((row) => Object.values(row)));
  }

  run() {
    if (looksReadable(this.sql)) {
      const rows = this.database.prepare(this.sql).all(...this.values);
      return Promise.resolve(d1Result(rows, { rows_read: rows.length }));
    }
    const result = this.database.prepare(this.sql).run(...this.values);
    return Promise.resolve(d1Result([], { rows_written: Number(result.changes || 0) }));
  }
}

export class SQLiteD1Database {
  constructor(databasePath) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath, { timeout: 5000 });
    this.database.exec("PRAGMA journal_mode = WAL;");
    this.database.exec("PRAGMA busy_timeout = 5000;");
    this.database.exec("PRAGMA foreign_keys = ON;");
  }

  prepare(sql) {
    return new SQLiteD1PreparedStatement(this.database, sql);
  }

  async batch(statements) {
    const results = [];
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      for (const statement of statements) {
        results.push(await statement.run());
      }
      this.database.exec("COMMIT;");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  async exec(sql) {
    this.database.exec(sql);
    return d1Result([]);
  }
}

export function applyMigrations(db, migrationsDir) {
  db.database.exec(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);

  const appliedRows = db.database.prepare(`SELECT name FROM ${MIGRATIONS_TABLE}`).all();
  const applied = new Set(appliedRows.map((row) => row.name));
  const files = readdirSync(migrationsDir)
    .filter((name) => /^\d+.*\.sql$/i.test(name))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    console.log(`[selfhost] applying migration ${file}`);
    db.database.exec(sql);
    db.database.prepare(`INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES (?)`).run(file);
  }

  db.database.exec("PRAGMA foreign_keys = ON;");
}

