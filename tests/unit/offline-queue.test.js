// Written before extraction, per ARCHITECTURE_REDESIGN_PROPOSAL.md Phase 4.
// The Office App and Employee App had near-identical offline-queue
// implementations (the Office App's was explicitly "ported from
// engineer.html" per its own comment) — this proves the shared behavior
// before consolidating it. Two real, deliberate differences were found by
// reading both implementations directly and are preserved as
// caller-supplied parameters, not unified away:
//   - the localStorage key (each app's queue must stay separate)
//   - what happens on a fully-synced flush (the Office App also refreshes
//     the Jobs list; the Employee App does not)
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isNetworkError, createOfflineQueue } from '../../packages/offline/queue.js';

beforeEach(() => {
  localStorage.clear();
});

describe('isNetworkError', () => {
  it('treats being offline as a network error regardless of the exception', () => {
    const originalOnLine = navigator.onLine;
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    expect(isNetworkError(new Error('anything'))).toBe(true);
    Object.defineProperty(navigator, 'onLine', { value: originalOnLine, configurable: true });
  });

  it('treats a TypeError (fetch itself rejected) as a network error', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('matches known network-error message patterns', () => {
    expect(isNetworkError(new Error('NetworkError when attempting to fetch resource'))).toBe(true);
    expect(isNetworkError(new Error('Load failed'))).toBe(true);
  });

  it('does not treat a real server rejection as a network error', () => {
    expect(isNetworkError(new Error('[DeepFlow] jobs → 403: Forbidden'))).toBe(false);
  });
});

describe('createOfflineQueue', () => {
  function setup(overrides = {}) {
    const sbFetch = vi.fn();
    const onQueueChange = vi.fn();
    const onSynced = vi.fn();
    const queue = createOfflineQueue('test_queue_key', { sbFetch, onQueueChange, onSynced, ...overrides });
    return { queue, sbFetch, onQueueChange, onSynced };
  }

  it('queueableSave succeeds immediately when the write succeeds', async () => {
    const { queue, sbFetch } = setup();
    sbFetch.mockResolvedValue({});
    const result = await queue.queueableSave('label', 'jobs?id=eq.1', { method: 'PATCH' });
    expect(result).toEqual({ ok: true, queued: false });
    expect(queue.getQueue()).toEqual([]);
  });

  it('queueableSave queues the write on a network error instead of losing it', async () => {
    const { queue, sbFetch, onQueueChange } = setup();
    sbFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await queue.queueableSave('Save job', 'jobs?id=eq.1', { method: 'PATCH', body: { x: 1 } });
    expect(result).toEqual({ ok: true, queued: true });
    const q = queue.getQueue();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ label: 'Save job', path: 'jobs?id=eq.1', opts: { method: 'PATCH', body: { x: 1 } } });
    expect(onQueueChange).toHaveBeenCalledWith(1);
  });

  it('queueableSave re-throws a real server rejection rather than queuing it', async () => {
    const { queue, sbFetch } = setup();
    sbFetch.mockRejectedValue(new Error('[DeepFlow] jobs → 403: Forbidden'));
    await expect(queue.queueableSave('label', 'jobs?id=eq.1', {})).rejects.toThrow('403');
    expect(queue.getQueue()).toEqual([]);
  });

  it('flush replays queued items in order and clears them on success', async () => {
    const { queue, sbFetch, onSynced } = setup();
    queue.setQueue([
      { qid: '1', label: 'a', path: 'jobs?id=eq.1', opts: {}, ts: 1 },
      { qid: '2', label: 'b', path: 'jobs?id=eq.2', opts: {}, ts: 2 },
    ]);
    sbFetch.mockResolvedValue({});
    await queue.flush();
    expect(sbFetch).toHaveBeenNthCalledWith(1, 'jobs?id=eq.1', {});
    expect(sbFetch).toHaveBeenNthCalledWith(2, 'jobs?id=eq.2', {});
    expect(queue.getQueue()).toEqual([]);
    expect(onSynced).toHaveBeenCalledTimes(1);
  });

  it('flush stops and keeps the rest queued if a network error recurs', async () => {
    const { queue, sbFetch, onSynced } = setup();
    queue.setQueue([
      { qid: '1', label: 'a', path: 'jobs?id=eq.1', opts: {}, ts: 1 },
      { qid: '2', label: 'b', path: 'jobs?id=eq.2', opts: {}, ts: 2 },
    ]);
    sbFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await queue.flush();
    expect(queue.getQueue()).toHaveLength(2);
    expect(onSynced).not.toHaveBeenCalled();
  });

  it('flush drops an item the server outright rejects, and continues with the rest', async () => {
    const { queue, sbFetch, onSynced } = setup();
    queue.setQueue([
      { qid: '1', label: 'a', path: 'jobs?id=eq.1', opts: {}, ts: 1 },
      { qid: '2', label: 'b', path: 'jobs?id=eq.2', opts: {}, ts: 2 },
    ]);
    sbFetch
      .mockRejectedValueOnce(new Error('[DeepFlow] jobs → 404: Not Found'))
      .mockResolvedValueOnce({});
    await queue.flush();
    expect(queue.getQueue()).toEqual([]);
    expect(onSynced).toHaveBeenCalledTimes(1);
  });
});
