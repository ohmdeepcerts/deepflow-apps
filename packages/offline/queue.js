// The offline write-queue pattern — the Office App's copy was explicitly
// "ported from engineer.html" per its own comment, and the two
// implementations were near-identical when compared directly before this
// extraction. Two real, deliberate differences are kept as parameters
// rather than unified away (see tests/unit/offline-queue.test.js):
//   - each app's localStorage key must stay separate (`queueKey`)
//   - each app's own fetch wrapper, badge rendering, and what happens on a
//     fully-synced flush differ and are supplied by the caller

export function isNetworkError(e) {
  if (!navigator.onLine) return true;
  if (e instanceof TypeError) return true; // fetch() itself rejected — no HTTP response at all
  return /failed to fetch|networkerror|load failed/i.test(e?.message || '');
}

export function createOfflineQueue(queueKey, { sbFetch, onQueueChange, onSynced } = {}) {
  function getQueue() {
    try {
      return JSON.parse(localStorage.getItem(queueKey) || '[]');
    } catch (e) {
      return [];
    }
  }

  function setQueue(arr) {
    localStorage.setItem(queueKey, JSON.stringify(arr));
    if (onQueueChange) onQueueChange(arr.length);
  }

  // Wraps a write: tries it immediately, and if it fails for what looks like
  // a connectivity reason, queues it for later instead of losing it. `label`
  // is shown in the caller's pending-sync badge (pass null for background
  // writes that don't need their own line item).
  async function queueableSave(label, path, opts) {
    try {
      await sbFetch(path, opts);
      return { ok: true, queued: false };
    } catch (e) {
      if (isNetworkError(e)) {
        const q = getQueue();
        q.push({ qid: Date.now() + '_' + Math.random().toString(36).slice(2), label, path, opts, ts: Date.now() });
        setQueue(q);
        return { ok: true, queued: true };
      }
      throw e; // a real server-side rejection — let the caller's existing catch/toast handle it
    }
  }

  let flushing = false;
  async function flush() {
    if (flushing || !navigator.onLine) return;
    const q = getQueue();
    if (!q.length) return;
    flushing = true;
    try {
      while (q.length) {
        const item = q[0];
        try {
          await sbFetch(item.path, item.opts);
        } catch (e) {
          if (isNetworkError(e)) break; // still offline (or flaky) — stop, keep the rest queued, try again later
          console.warn('[OfflineQueue] dropping unsendable item', item, e); // server rejected it outright — will never succeed
        }
        q.shift();
        setQueue(q);
      }
      if (!q.length && onSynced) onSynced();
    } finally {
      flushing = false;
    }
  }

  return { getQueue, setQueue, queueableSave, flush };
}
