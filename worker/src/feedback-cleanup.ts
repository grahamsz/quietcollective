import { bumpApiCacheToken } from "./api-cache";

export async function clearExpiredFeedbackRequests(db: D1Database) {
  const result = await db.prepare(
    `UPDATE works
     SET feedback_requested = 0,
         feedback_requested_at = NULL,
         feedback_prompt = NULL
     WHERE feedback_requested = 1
       AND feedback_requested_at IS NOT NULL
       AND datetime(feedback_requested_at) <= datetime('now', '-7 days')`,
  ).run();
  if ((result.meta as { changes?: number } | undefined)?.changes) await bumpApiCacheToken(db);
}
