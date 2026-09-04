// communicationProvider — proves the EMAIL/PUSH adapters call the right
// Edge Function with the right payload and translate the response/error
// shape correctly, since Phase B's whole point is "existing call sites
// migrate to this and behave identically" (docs/communications/
// 08-IMPLEMENTATION-PLAN.md Phase B).
import { describe, it, expect, vi } from 'vitest';
import { createCommunicationProvider } from '../../packages/comms/provider.js';

function setup(fetchImpl) {
  return createCommunicationProvider({
    sbUrl: 'https://x.supabase.co',
    sbKey: 'anon-key',
    getJWT: async () => 'jwt-token',
    fetchImpl,
  });
}

describe('createCommunicationProvider', () => {
  describe('EMAIL channel', () => {
    it('posts to send-email with the right auth headers and body', async () => {
      const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'abc' }) });
      const provider = setup(fetchImpl);
      const result = await provider.send({
        channel: 'EMAIL',
        content: { to: 'a@b.com', subject: 'Hi', html: '<p>hi</p>', cc: 'c@d.com', replyTo: 'r@e.com' },
      });
      expect(result).toEqual({ ok: true });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchImpl.mock.calls[0];
      expect(url).toBe('https://x.supabase.co/functions/v1/send-email');
      expect(opts.headers.apikey).toBe('anon-key');
      expect(opts.headers.Authorization).toBe('Bearer jwt-token');
      expect(JSON.parse(opts.body)).toEqual({
        to: 'a@b.com', cc: 'c@d.com', subject: 'Hi', html: '<p>hi</p>', attachments: undefined, replyTo: 'r@e.com',
      });
    });

    it('rejects before fetching when a required field is missing', async () => {
      const fetchImpl = vi.fn();
      const provider = setup(fetchImpl);
      await expect(provider.send({ channel: 'EMAIL', content: { to: 'a@b.com' } })).rejects.toThrow(
        'EMAIL requires to, subject and html'
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('surfaces the Edge Function error message on failure', async () => {
      const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'quota exceeded' }) });
      const provider = setup(fetchImpl);
      const result = await provider.send({ channel: 'EMAIL', content: { to: 'a@b.com', subject: 'Hi', html: '<p>hi</p>' } });
      expect(result).toEqual({ ok: false, error: 'quota exceeded' });
    });
  });

  describe('PUSH channel', () => {
    it('posts to send-push with the content payload as-is', async () => {
      const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sent: 2, removed: 0 }) });
      const provider = setup(fetchImpl);
      const result = await provider.send({
        channel: 'PUSH',
        content: { title: 'Job update', message: 'Completed', landlordName: 'N&N' },
      });
      expect(result).toEqual({ ok: true, sent: 2, removed: 0 });
      const [url, opts] = fetchImpl.mock.calls[0];
      expect(url).toBe('https://x.supabase.co/functions/v1/send-push');
      expect(JSON.parse(opts.body)).toEqual({ title: 'Job update', message: 'Completed', landlordName: 'N&N' });
    });

    it('surfaces the Edge Function error message on failure', async () => {
      const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'bad request' }) });
      const provider = setup(fetchImpl);
      const result = await provider.send({ channel: 'PUSH', content: { title: 't', message: 'm' } });
      expect(result).toEqual({ ok: false, error: 'bad request' });
    });
  });

  it('rejects an unwired channel without calling fetch', async () => {
    const fetchImpl = vi.fn();
    const provider = setup(fetchImpl);
    await expect(provider.send({ channel: 'WHATSAPP', content: {} })).rejects.toThrow(
      'communicationProvider: channel "WHATSAPP" is not wired yet (Phase B covers EMAIL/PUSH only)'
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
