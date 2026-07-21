// Guide & SQL snippets — the Settings-page "Guide" tab: a static list of
// copy-pasteable SQL queries for the Supabase SQL editor. Extracted from
// main.js verbatim (Phase 5 of the architecture migration, module 11 —
// see ARCHITECTURE_REDESIGN_PROPOSAL.md Part 5) — no behaviour changes.
//
// This module and main.js import from each other, same as the other
// Phase 5 modules: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import { toast } from './main.js';

//  GUIDE & SQL SNIPPETS
// ══════════════════════════════════════════════════════════════
export function renderSqlSnippets() {
  const SNIPPETS = [
    { title:'View all jobs (latest first)', sql:'SELECT * FROM jobs ORDER BY created DESC LIMIT 100;' },
    { title:'View all engineers', sql:'SELECT name, phone, role, pin FROM users WHERE role = \'engineer\';' },
    { title:'Jobs completed this month', sql:`SELECT j.jobnum, j.address, j.date, j.engineer, j.hours
FROM jobs j
WHERE j.status = 'Completed'
  AND j.date >= date_trunc('month', current_date)::text
ORDER BY j.date DESC;` },
    { title:'Jobs by engineer this month', sql:`SELECT engineer, COUNT(*) as total_jobs, SUM(hours::numeric) as total_hours
FROM jobs
WHERE status = 'Completed'
  AND date >= date_trunc('month', current_date)::text
GROUP BY engineer
ORDER BY total_jobs DESC;` },
    { title:'All attachments / photos with job info', sql:`SELECT a.id, j.jobnum, j.address, a.name, a.type, a.url, a.uploaded_by_name, a.created
FROM attachments a
JOIN jobs j ON j.id = a.jobid
ORDER BY a.created DESC
LIMIT 200;` },
    { title:'All overtime/leave requests (pending first)', sql:`SELECT engineer_name, type, date, hours, rate, leave_from, leave_to, status, notes, created
FROM engineer_requests
ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created DESC;` },
    { title:'Jobs with no engineer assigned', sql:`SELECT jobnum, address, date, status FROM jobs WHERE (engineer IS NULL OR engineer = '') ORDER BY date;` },
    { title:'Find jobs by address', sql:`SELECT jobnum, address, date, engineer, status FROM jobs WHERE address ILIKE '%SEARCH_TERM%' ORDER BY date DESC;` },
    { title:'Certificates expiring next 90 days', sql:`SELECT c.certnum, j.address, j.engineer, c.expirydate, c.certnum
FROM certs c
JOIN jobs j ON j.id = c.jobid
WHERE c.expirydate IS NOT NULL
  AND c.expirydate::date BETWEEN current_date AND current_date + 90
  AND c.noexpiry IS NOT TRUE
ORDER BY c.expirydate;` },
    { title:'Count jobs per status', sql:`SELECT status, COUNT(*) FROM jobs GROUP BY status ORDER BY COUNT(*) DESC;` },
    { title:'Delete a specific job (replace ID)', sql:`DELETE FROM jobs WHERE id = 'REPLACE-WITH-JOB-ID';` },
    { title:'Reset engineer PIN', sql:`UPDATE users SET pin = '1234' WHERE name ILIKE 'ENGINEER NAME';` },
    { title:'View all pending engineer requests', sql:`SELECT * FROM engineer_requests WHERE status = 'pending' ORDER BY created DESC;` },
    { title:'Create engineer_alerts table (for office→engineer broadcasts)', sql:`CREATE TABLE IF NOT EXISTS engineer_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target text DEFAULT 'all',
  type text DEFAULT 'info',
  title text,
  message text,
  sent_by text,
  created bigint,
  expires bigint,
  status text DEFAULT 'active'
);
ALTER TABLE engineer_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "allow_all" ON engineer_alerts FOR ALL USING (true) WITH CHECK (true);` },
    { title:'Approve an overtime request (replace ID)', sql:`UPDATE engineer_requests SET status = 'approved', office_reply = 'Approved - will be on next payslip' WHERE id = 'REPLACE-WITH-REQUEST-ID';` },
  ];

  const FIX_SNIPPETS = [
    { title:'Fix: Re-enable RLS on all tables', sql:`ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE certs ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE engineer_requests ENABLE ROW LEVEL SECURITY;` },
    { title:'Fix: Add allow_all policy (if locked out)', sql:`CREATE POLICY IF NOT EXISTS "allow_all" ON jobs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "allow_all" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "allow_all" ON attachments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "allow_all" ON engineer_requests FOR ALL USING (true) WITH CHECK (true);` },
    { title:'Fix: Storage bucket public access', sql:`INSERT INTO storage.buckets (id, name, public) VALUES ('deepflow', 'deepflow', true)
ON CONFLICT (id) DO UPDATE SET public = true;` },
    { title:'Maintenance: Delete old completed jobs (older than 2 years)', sql:`DELETE FROM jobs WHERE status = 'Completed' AND date < (current_date - interval '2 years')::text RETURNING jobnum, address;` },
    { title:'Maintenance: Clear engineer location data', sql:`UPDATE users SET last_lat = null, last_lng = null, last_seen = null WHERE role = 'engineer';` },
  ];

  const snipEl = document.getElementById('sql-snippets');
  const fixEl  = document.getElementById('fix-snippets');
  if (snipEl) snipEl.innerHTML = SNIPPETS.map(s => `
    <div class="set-card" style="margin-bottom:8px;cursor:pointer" onclick="copySql(this)">
      <div style="font-size:11px;font-weight:700;color:var(--txt2);margin-bottom:6px;display:flex;align-items:center;justify-content:space-between">
        <span>📋 ${s.title}</span>
        <span style="font-size:10px;color:var(--acc);font-weight:600">COPY</span>
      </div>
      <div class="sql-block" style="margin:0">${s.sql}</div>
    </div>`).join('');
  if (fixEl) fixEl.innerHTML = FIX_SNIPPETS.map(s => `
    <div class="set-card" style="margin-bottom:8px;cursor:pointer" onclick="copySql(this)">
      <div style="font-size:11px;font-weight:700;color:var(--txt2);margin-bottom:6px;display:flex;align-items:center;justify-content:space-between">
        <span>🔧 ${s.title}</span>
        <span style="font-size:10px;color:var(--acc);font-weight:600">COPY</span>
      </div>
      <div class="sql-block" style="margin:0">${s.sql}</div>
    </div>`).join('');
}

export function copySql(card) {
  const block = card.querySelector ? card.querySelector('.sql-block') : card;
  const text  = block ? block.textContent.trim() : card.textContent.trim();
  navigator.clipboard.writeText(text).then(() => {
    toast('📋 SQL copied to clipboard!', 'success');
  }).catch(() => {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    toast('📋 SQL copied!', 'success');
  });
}
