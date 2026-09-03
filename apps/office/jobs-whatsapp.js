// WhatsApp job dispatch — the panel that groups today's jobs by engineer
// and previews/sends the dispatch message, plus single-job and
// multi-selected-job WhatsApp sends. The message-text building itself is
// already in @business (Phase 5a); this is the DOM panel/click-handler
// shell around it. Extracted from main.js verbatim (Phase 5b of the
// follow-up modularization pass) — no behaviour changes.
//
// This module and main.js (and the other jobs-*.js files) import from each
// other, same as every other extracted module: safe because every
// cross-module reference is used only inside function bodies, never at
// module-evaluation time.

import { escHtml } from '@ui';
import { buildJobWhatsAppMessage } from '@business';
import { S, dAll, dGet, toast, jDate, editJid, selJobs, fmtD, openModal, closeModal } from './main.js';

function buildJobWAMsg(jobs, engName){
  return buildJobWhatsAppMessage(jobs, engName, S.waJobTpl||'', S.coName);
}

export async function showWaPanel(){
  const panel=document.getElementById('wa-panel');
  const btn=document.getElementById('btn-wa-panel');
  if(panel.style.display!=='none'){panel.style.display='none';if(btn)btn.textContent='📱 Send to Engineer';return}
  if(btn)btn.textContent='✕ Close Panel';

  const jobs=(await dAll('jobs')).filter(j=>j.date===jDate);
  if(!jobs.length){toast('No jobs for this date','warn');panel.style.display='none';if(btn)btn.textContent='📱 Send to Engineer';return}

  // Group by engineer
  const byEng={};
  jobs.forEach(j=>{const e=j.engineer||'Unassigned';if(!byEng[e])byEng[e]=[];byEng[e].push(j)});
  const engs=Object.keys(byEng);

  panel.style.display='block';
  panel.innerHTML=`<div class="wa-panel">
    <div class="wa-panel-title">📱 Send Jobs to Engineers — ${fmtD(jDate)}</div>
    <div class="wa-eng-tabs" id="wa-eng-tabs">
      ${engs.map((e,i)=>`<div class="wa-eng-tab ${i===0?'active':''}" onclick="waShowEng(${escHtml(JSON.stringify(e))},this)">${escHtml(e)} (${byEng[e].length})</div>`).join('')}
    </div>
    <div id="wa-preview-area"></div>
  </div>`;

  window._waJobsByEng=byEng;
  if(engs.length>0) waShowEng(engs[0], panel.querySelector('.wa-eng-tab'));
}

export function waShowEng(engName, tabEl){
  document.querySelectorAll('.wa-eng-tab').forEach(t=>t.classList.remove('active'));
  if(tabEl) tabEl.classList.add('active');
  const jobs=window._waJobsByEng[engName]||[];
  const msg=buildJobWAMsg(jobs, engName);
  const engObj=(S.engineers||[]).find(e=>e.name===engName);
  const waNum=engObj?.wa||'';

  const area=document.getElementById('wa-preview-area');
  area.innerHTML=`
    <div style="margin-bottom:10px">
      <div style="font-size:10px;color:var(--txt3);margin-bottom:6px;letter-spacing:1px;text-transform:uppercase;font-family:var(--fh);font-weight:600">Job Cards — ${engName}</div>
      <div class="wa-job-cards">
        ${jobs.map((j,i)=>{
          const ords=['1st','2nd','3rd','4th','5th','6th','7th','8th','9th','10th'];
          // FIX 20: Previously access and contact were merged on one line with 🔑 making
          // it unclear whether the contact field is an access code or a person's name.
          // Now rendered as two distinct lines with clear labels when both are present.
          const accessLine = j.access ? `🔑 ${escHtml(j.access)}` : '';
          const contactLine = j.contact ? `👤 Contact: ${escHtml(j.contact)}` : '';
          return `<div class="wa-job-card">
            <div class="wa-job-num">${ords[i]||i+1+'th'} Job ${j.timeSlot?'· '+escHtml(j.timeSlot):''}</div>
            <div class="wa-job-addr">${escHtml(j.address)}</div>
            <div class="wa-job-meta">
              👤 ${escHtml(j.referrer)||'—'}<br>
              🔧 ${escHtml(j.description)||'—'}<br>
              ${accessLine?accessLine+'<br>':''}
              ${contactLine?contactLine+'<br>':''}
              ${j.notes?'📝 '+escHtml(j.notes):''}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
    <div style="font-size:10px;color:var(--txt3);margin-bottom:6px;letter-spacing:1px;text-transform:uppercase;font-family:var(--fh);font-weight:600">Message Preview</div>
    <div class="wa-msg-preview">${escHtml(msg)}</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <div class="fg" style="margin:0;flex:1;max-width:260px">
        <input type="text" class="fi" id="wa-eng-num-inp" value="${waNum}" placeholder="WhatsApp number (447...)">
      </div>
      <button class="btn btn-ghost btn-sm" onclick="copyText(${JSON.stringify(msg)})">📋 Copy</button>
      <button class="btn btn-wa" onclick="sendToWA(document.getElementById('wa-eng-num-inp').value, ${JSON.stringify(msg)})">📱 Open WhatsApp</button>
    </div>
  `;
}

export async function waSingleJobById(id){
  const j=await dGet('jobs',id);
  if(!j)return;
  const msg=buildJobWAMsg([j], j.engineer||'Engineer');
  const engObj=(S.engineers||[]).find(e=>e.name===j.engineer);
  const waNum=engObj?.wa||'';
  document.getElementById('wa-preview-text').textContent=msg;
  document.getElementById('wa-send-to').value=waNum;
  window._waPendingMsg=msg;
  openModal('mo-wa');
}

export function waSingleJob(){waSingleJobById(editJid)}

export async function waSingleEngJob(jobId,engName){
  const j=await dGet('jobs',jobId);
  if(!j) return;
  const msg=buildJobWAMsg([j],engName);
  const engObj=(S.engineers||[]).find(e=>e.name===engName);
  document.getElementById('wa-preview-text').textContent=msg;
  document.getElementById('wa-send-to').value=engObj?.wa||'';
  window._waPendingMsg=msg;
  openModal('mo-wa');
}

export async function waEngineerAllJobs(engName){
  const jobs=await dAll('jobs');
  const ejobs=jobs.filter(j=>j.engineer===engName&&j.date===jDate);
  if(!ejobs.length){toast('No jobs today for '+engName,'warn');return}
  const msg=buildJobWAMsg(ejobs,engName);
  const engObj=(S.engineers||[]).find(e=>e.name===engName);
  document.getElementById('wa-preview-text').textContent=msg;
  document.getElementById('wa-send-to').value=engObj?.wa||'';
  window._waPendingMsg=msg;
  openModal('mo-wa');
}

export async function waJobsSelected(){
  const ids=[...selJobs];
  const jobs=await Promise.all(ids.map(id=>dGet('jobs',id)));
  if(!jobs.length)return;
  const msg=buildJobWAMsg(jobs,'Engineer');
  document.getElementById('wa-preview-text').textContent=msg;
  document.getElementById('wa-send-to').value='';
  window._waPendingMsg=msg;
  openModal('mo-wa');
}

export function openWhatsApp(){
  const num=(document.getElementById('wa-send-to').value||'').replace(/[^0-9]/g,'');
  const msg=window._waPendingMsg||'';
  sendToWA(num,msg);
  closeModal('mo-wa');
}

export function sendToWA(num,msg){
  const enc=encodeURIComponent(msg);
  const n=num.replace(/[^0-9]/g,'');
  const url=n?`https://wa.me/${n}?text=${enc}`:`https://wa.me/?text=${enc}`;
  window.open(url,'_blank');
  toast('Opening WhatsApp…','wa');
}

export function copyText(txt){navigator.clipboard?.writeText(txt).then(()=>toast('Copied to clipboard','success')).catch(()=>{const t=document.createElement('textarea');t.value=txt;document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();toast('Copied','success')})}
export function copyWAText(){copyText(window._waPendingMsg||'')}
