import type { Env } from "./types";

export type D1Metrics = {
  rowsRead: number;
  rowsWritten: number;
  queryCount: number;
};

const D1_METRIC_HEADERS = [
  "X-D1-Rows-Read",
  "X-D1-Rows-Written",
  "X-D1-Query-Count",
] as const;

type D1ResultWithMeta = {
  meta?: {
    rows_read?: number;
    rows_written?: number;
  };
};

export function createD1Metrics(): D1Metrics {
  return {
    rowsRead: 0,
    rowsWritten: 0,
    queryCount: 0,
  };
}

function numericMetric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function recordD1Result(metrics: D1Metrics, result: D1ResultWithMeta) {
  metrics.queryCount += 1;
  metrics.rowsRead += numericMetric(result.meta?.rows_read);
  metrics.rowsWritten += numericMetric(result.meta?.rows_written);
}

function trackPreparedStatement(
  statement: D1PreparedStatement,
  metrics: D1Metrics,
  originals: WeakMap<object, D1PreparedStatement>,
): D1PreparedStatement {
  const proxy = new Proxy(statement, {
    get(target, prop, receiver) {
      if (prop === "bind") {
        return (...values: unknown[]) => trackPreparedStatement(target.bind(...values), metrics, originals);
      }
      if (prop === "run") {
        return async () => {
          const result = await target.run();
          recordD1Result(metrics, result);
          return result;
        };
      }
      if (prop === "all") {
        return async () => {
          const result = await target.all();
          recordD1Result(metrics, result);
          return result;
        };
      }
      if (prop === "first") {
        return async (columnName?: string) => {
          const result = await target.run<Record<string, unknown>>();
          recordD1Result(metrics, result);
          const row = result.results?.[0];
          if (!row) return null;
          return columnName ? row[columnName] ?? null : row;
        };
      }

      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  originals.set(proxy, statement);
  return proxy;
}

function trackD1Database(db: D1Database, metrics: D1Metrics): D1Database {
  const originals = new WeakMap<object, D1PreparedStatement>();
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "prepare") {
        return (query: string) => trackPreparedStatement(target.prepare(query), metrics, originals);
      }
      if (prop === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          const unwrapped = statements.map((statement) => originals.get(statement) || statement);
          const results = await target.batch(unwrapped);
          for (const result of results) recordD1Result(metrics, result);
          return results;
        };
      }

      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function instrumentD1Env(env: Env) {
  const metrics = createD1Metrics();
  return {
    env: {
      ...env,
      DB: trackD1Database(env.DB, metrics),
    },
    metrics,
  };
}

function exposeMetricHeaders(response: Response) {
  const existing = response.headers.get("Access-Control-Expose-Headers");
  const values = new Set(
    (existing ? existing.split(",") : [])
      .map((value) => value.trim())
      .filter(Boolean),
  );
  for (const header of D1_METRIC_HEADERS) values.add(header);
  response.headers.set("Access-Control-Expose-Headers", Array.from(values).join(", "));
}

export function withD1MetricsHeaders(response: Response, metrics: D1Metrics) {
  const nextResponse = new Response(response.body, response);
  nextResponse.headers.set("X-D1-Rows-Read", String(metrics.rowsRead));
  nextResponse.headers.set("X-D1-Rows-Written", String(metrics.rowsWritten));
  nextResponse.headers.set("X-D1-Query-Count", String(metrics.queryCount));
  exposeMetricHeaders(nextResponse);
  return nextResponse;
}
