// Regression coverage for the "hide the real storage link from the
// client" feature: the Portal's cert/invoice preview+download must never
// write the real signed Supabase Storage URL into the DOM (an iframe src,
// a link's href, or an onclick attribute's HTML source) — only a
// same-origin blob: URL, obtained by fetching the real URL in JS memory
// and immediately discarding it. ./main.js is mocked rather than
// imported for real: it pulls in the hero-canvas animation, network
// helpers, and page-load wiring that don't apply here, and the property
// under test — "certs.js/invoice-pdf.js never touch the raw URL except
// to hand it to _blobUrlFor" — is fully verifiable against a mock.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const REAL_CERT_URL = 'https://dzqyqpuhxdrrpipbehpk.supabase.co/storage/v1/object/sign/deepflow/certs/secret-cert.pdf?token=SECRET1';
const REAL_INV_URL = 'https://dzqyqpuhxdrrpipbehpk.supabase.co/storage/v1/object/sign/deepflow/invoices/secret-inv.pdf?token=SECRET2';

const toast = vi.fn();
const fetchMock = vi.fn(async (url) => ({
  ok: true,
  blob: async () => new Blob(['%PDF-fake'], { type: 'application/pdf' }),
}));
global.fetch = fetchMock;

let blobUrlCounter = 0;
const revoked = [];
// Mirrors the real _blobUrlFor in apps/portal/main.js exactly (fetch →
// blob → createObjectURL) — mocked only so the test doesn't have to
// import all of main.js's page-load side effects to reach it.
const _blobUrlFor = vi.fn(async (realUrl) => {
  const res = await fetch(realUrl);
  if (!res.ok) throw new Error('fetch failed: ' + res.status);
  await res.blob();
  const url = `blob:mock-url-${blobUrlCounter++}`;
  return url;
});
global.URL.createObjectURL = vi.fn();
global.URL.revokeObjectURL = vi.fn((url) => revoked.push(url));

// certs.js and invoice-pdf.js both import from this one mocked module, so
// it needs to cover every export either of them pulls in.
const _d = { certs: [] };
const _INV_STORE = new Map();
vi.mock('../../apps/portal/main.js', () => ({
  _d, dd: () => null, empty: () => '', go: () => {}, ptype: 'landlord',
  toast, _blobUrlFor, _INV_STORE, calcTotal: () => ({ grand: 0 }), token: 'test-token',
}));

function setDom(html) { document.body.innerHTML = html; }

describe('Portal cert preview never exposes the real storage URL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    revoked.length = 0;
    _d.certs = [];
    setDom(`
      <div id="cp-pdf-overlay"><div id="cp-pdf-share"></div></div>
      <iframe id="cp-pdf-frame"></iframe>
      <a id="cp-pdf-open" href="#"></a>
      <a id="cp-pdf-download" href="#"></a>
    `);
  });

  it('previewCertPdf fetches the real URL once and only ever writes a blob: URL into the DOM', async () => {
    const { previewCertPdf } = await import('../../apps/portal/certs.js');
    _d.certs = [{ id: 'cert1', pdf_url: REAL_CERT_URL, certNum: 'C-1', type: 'PAT' }];

    await previewCertPdf('cert1');

    expect(_blobUrlFor).toHaveBeenCalledWith(REAL_CERT_URL);
    expect(fetchMock).toHaveBeenCalledWith(REAL_CERT_URL);

    const frameSrc = document.getElementById('cp-pdf-frame').src;
    const openHref = document.getElementById('cp-pdf-open').getAttribute('href');
    const dlHref = document.getElementById('cp-pdf-download').getAttribute('href');
    for (const v of [frameSrc, openHref, dlHref]) {
      expect(v).not.toContain('supabase.co');
      expect(v).not.toContain('SECRET1');
      expect(v.startsWith('blob:')).toBe(true);
    }
  });

  it("the card's onclick attribute carries only the cert id, never the pdf_url", async () => {
    const { certCard } = await import('../../apps/portal/certs.js');
    const cert = { id: 'cert2', pdf_url: REAL_CERT_URL, type: 'Gas', address: '1 Test St' };
    const html = certCard(cert, { jobs: [], invoices: [] });
    expect(html).not.toContain('SECRET1');
    expect(html).not.toContain('supabase.co');
    expect(html).toContain('previewCertPdf(&quot;cert2&quot;)');
  });

  it('closing the preview revokes the blob URL', async () => {
    const { previewCertPdf, closeCertPdfPreview } = await import('../../apps/portal/certs.js');
    _d.certs = [{ id: 'cert1', pdf_url: REAL_CERT_URL }];
    await previewCertPdf('cert1');
    const opened = document.getElementById('cp-pdf-frame').src;
    closeCertPdfPreview();
    expect(revoked).toContain(opened);
  });
});

describe('Portal invoice preview/download never exposes the real storage URL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    revoked.length = 0;
    _INV_STORE.clear();
    setDom(`<div id="pdf-modal"><div id="pdf-modal-bd"></div></div>`);
  });

  it('previewInv fetches the real URL once and the iframe only ever gets a blob: URL', async () => {
    const { previewInv } = await import('../../apps/portal/invoice-pdf.js');
    _INV_STORE.set('inv1', { id: 'inv1', number: 'INV-1', pdf_url: REAL_INV_URL, status: 'Paid' });

    await previewInv('inv1');

    expect(_blobUrlFor).toHaveBeenCalledWith(REAL_INV_URL);
    const frame = document.getElementById('inv-pdf-frame');
    expect(frame.src).not.toContain('supabase.co');
    expect(frame.src).not.toContain('SECRET2');
    expect(frame.src.startsWith('blob:')).toBe(true);
  });

  it('downloadInvPDF creates a blob-backed download link, never one pointing at the real URL', async () => {
    const { downloadInvPDF } = await import('../../apps/portal/invoice-pdf.js');
    _INV_STORE.set('inv1', { id: 'inv1', number: 'INV-1', pdf_url: REAL_INV_URL, status: 'Paid' });

    let capturedHref = null;
    const realCreateElement = document.createElement.bind(document);
    const clickSpy = vi.fn();
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = realCreateElement(tag);
      if (tag === 'a') {
        el.click = clickSpy;
        Object.defineProperty(el, 'href', {
          get() { return capturedHref; },
          set(v) { capturedHref = v; },
        });
      }
      return el;
    });

    await downloadInvPDF('inv1');

    expect(_blobUrlFor).toHaveBeenCalledWith(REAL_INV_URL);
    expect(clickSpy).toHaveBeenCalled();
    expect(capturedHref).not.toContain('supabase.co');
    expect(capturedHref).not.toContain('SECRET2');
    expect(capturedHref.startsWith('blob:')).toBe(true);
  });
});
