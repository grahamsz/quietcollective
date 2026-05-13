// @ts-nocheck
import { encodePath } from "../lib/utils";
import { api } from "./api";

const PREFETCH_TTL_MS = 2 * 60 * 1000;
const workPayloads = new Map();
const workComments = new Map();
const workRequests = new Map();
const commentRequests = new Map();

function fresh(entry) {
  return entry && Date.now() - entry.storedAt <= PREFETCH_TTL_MS;
}

function remember(cache, key, data) {
  cache.set(key, { data, storedAt: Date.now() });
  return data;
}

function consume(cache, key) {
  const entry = cache.get(key);
  if (!fresh(entry)) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  return entry.data;
}

async function prefetch(cache, requests, key, path) {
  if (!key || fresh(cache.get(key)) || requests.has(key)) return;
  const request = api(path)
    .then((data) => remember(cache, key, data))
    .catch(() => null)
    .finally(() => requests.delete(key));
  requests.set(key, request);
  await request;
}

function prefetchWorkPayload(id) {
  void prefetch(workPayloads, workRequests, id, `/api/works/${encodePath(id)}`);
}

function prefetchWorkComments(id) {
  void prefetch(workComments, commentRequests, id, `/api/works/${encodePath(id)}/comments`);
}

async function loadWorkPayload(id) {
  const cached = consume(workPayloads, id);
  if (cached) return cached;
  if (workRequests.has(id)) return workRequests.get(id);
  return api(`/api/works/${encodePath(id)}`);
}

async function loadWorkComments(id) {
  const cached = consume(workComments, id);
  if (cached) return cached;
  if (commentRequests.has(id)) return commentRequests.get(id);
  return api(`/api/works/${encodePath(id)}/comments`);
}

function warmWorkRoute(id) {
  if (!id) return;
  prefetchWorkPayload(id);
  prefetchWorkComments(id);
}

function updatePrefetchedWorkReactions(id, reactions) {
  const entry = workPayloads.get(id);
  if (!fresh(entry) || !entry.data?.work) return;
  entry.data = {
    ...entry.data,
    work: {
      ...entry.data.work,
      reactions,
    },
  };
  entry.storedAt = Date.now();
}

export { loadWorkComments, loadWorkPayload, prefetchWorkComments, prefetchWorkPayload, updatePrefetchedWorkReactions, warmWorkRoute };
