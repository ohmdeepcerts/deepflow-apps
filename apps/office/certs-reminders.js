// Certificates reminders + CSV import/export — the bulk landlord/agent
// reminder composer (email or WhatsApp), CSV import (with duplicate/date
// validation), CSV/PDF export, and the downloadable import template.
// Extracted from certs.js verbatim (Phase 2 of the follow-up modularization
// pass — see the plan file for scope) — no behaviour changes.
//
// This module and main.js (and certs-list.js, for the shared filter/status
// helpers) import from each other, same as every other extracted module:
// safe because every cross-module reference is used only inside function
// bodies, never at module-evaluation time.

import { daysDiff, formatDateUK, localDateStr } from '@business';
import { S, dAll, dPut, TODAY, toast, uid, logActivity, updateBadges } from './main.js';
import { ctblGetFiltered, calcCertStatus } from './certs-list.js';

let _cremMode='email', _cremEmailLink='';

// ════════════════════════════════════════════════════════════════
//  REMINDERS (📣 Reminders tab)
// ════════════════════════════════════════════════════════════════

export async function initCertReminders(){
  const all=await dAll('certs');
  const lls=[...new Set(all.map(c=>c.landlord).filter(Boolean))].sort();
  const ags=[...new Set(all.map(c=>c.agent).filter(Boolean))].sort();
  const llEl=document.getElementById('crem-landlord');
  const agEl=document.getElementById('crem-agent');
  if(llEl)llEl.innerHTML='<option value="">— Select Landlord —</option>'+lls.map(l=>`<option>${l}</option>`).join('');
  if(agEl)agEl.innerHTML='<option value="">— Select Agent —</option>'+ags.map(a=>`<option>${a}</option>`).join('');
}

export function setCremMode(mode){
  _cremMode=mode;
  document.getElementById('crem-btn-email')?.classList.toggle('active',mode==='email');
  document.getElementById('crem-btn-wa')?.classList.toggle('active',mode==='wa');
  document.getElementById('crem-output').style.display='none';
}

export async function generateBulkReminder(){
  const ll=document.getElementById('crem-landlord')?.value||'';
  const ag=document.getElementById('crem-agent')?.value||'';
  const cutoff=document.getElementById('crem-cutoff')?.value||'';
  if(!ll&&!ag)return toast('Select a landlord or agent first','warn');

  // Excludes superseded certs — reminding a client about a certificate
  // that's already been renewed would be confusing and wrong.
  let all=(await dAll('certs')).filter(c=>!c.supersededBy);
  let filtered=all.filter(c=>(ll&&c.landlord===ll)||(ag&&c.agent===ag));
  if(cutoff)filtered=filtered.filter(c=>c.expiryDate&&c.expiryDate<=cutoff);
  if(!filtered.length)return toast('No certificates found for this client','warn');
  filtered.sort((a,b)=>(a.expiryDate||'')>(b.expiryDate||'')?1:-1);

  const clientName=ll||ag||'Client';

  // FIX 9: Look up contact details from the directory (persons or agencies table) using
  // the selected name — NOT from filtered[0] which was reading the first cert's fields
  // and would use the wrong contact if certs came from different jobs with mixed details.
  let email='', phone='';
  if(ll){
    const persons=await dAll('persons');
    const match=persons.find(p=>p.name===ll||(p.roles||[]).includes('landlord')&&p.name===ll)
      || persons.find(p=>p.name===ll);
    email=match?.email||'';
    phone=match?.phone||match?.wa||'';
  } else if(ag){
    const agencies=await dAll('agencies');
    const agents=await dAll('agents');
    const agencyMatch=agencies.find(a=>a.name===ag);
    const agentMatch=agents.find(a=>a.name===ag);
    const contact=agencyMatch||agentMatch;
    email=contact?.email||'';
    phone=contact?.phone||contact?.wa||'';
  }
  // Fallback: if not found in directory, try the cert fields as last resort
  if(!email) email=filtered[0]?.email||'';
  if(!phone) phone=filtered[0]?.phone||'';

  const out=document.getElementById('crem-output');
  const preview=document.getElementById('crem-preview');
  const sendBtn=document.getElementById('crem-btn');
  const sendLink=document.getElementById('crem-link');
  out.style.display='block';

  if(_cremMode==='email'){
    _cremEmailLink=`mailto:${email}?subject=${encodeURIComponent('Urgent: Compliance Update — '+clientName)}`;
    let html=`<div style="font-family:Arial,sans-serif;color:#1e293b;font-size:14px;line-height:1.5">
      <p>Hi ${clientName},</p>
      <p>Please review the following certificates in your portfolio:</p>
      <table style="width:auto;min-width:400px;border-collapse:collapse;margin:16px 0;border:1px solid #cbd5e1">
        <thead><tr style="background:#f1f5f9">
          <th style="padding:10px;border:1px solid #cbd5e1;text-align:left">Address</th>
          <th style="padding:10px;border:1px solid #cbd5e1">Type</th>
          <th style="padding:10px;border:1px solid #cbd5e1">Expiry</th>
          <th style="padding:10px;border:1px solid #cbd5e1">Status</th>
        </tr></thead><tbody>`;
    filtered.forEach(c=>{
      const diff=c.expiryDate?daysDiff(c.expiryDate):null;
      const isExp=diff!==null&&diff<0;
      const statusTxt=diff===null?'No Date':isExp?`${Math.abs(diff)} DAYS OVERDUE`:`${diff} days left`;
      const statusCol=diff===null?'#94a3b8':isExp?'#dc2626':diff<=30?'#d97706':'#16a34a';
      html+=`<tr><td style="padding:10px;border:1px solid #e2e8f0"><strong>${c.address||'—'}</strong></td><td style="padding:10px;border:1px solid #e2e8f0;text-align:center">${c.type||'—'}</td><td style="padding:10px;border:1px solid #e2e8f0;text-align:center">${formatDateUK(c.expiryDate)||'—'}</td><td style="padding:10px;border:1px solid #e2e8f0;text-align:center;font-weight:800;color:${statusCol}">${statusTxt}</td></tr>`;
    });
    html+=`</tbody></table><p>Please confirm if we should proceed with renewal.</p><p>Thanks,<br><strong>DeepFlow</strong></p></div>`;
    preview.innerHTML=html;
    document.getElementById('crem-lbl').textContent='Email Preview (rich HTML)';
    if(sendBtn)sendBtn.textContent='Send Email';
    if(sendLink)sendLink.removeAttribute('href');
  } else {
    let body=`*COMPLIANCE ALERT*\n\nDear ${clientName},\n\nPlease review your expiring certificates:\n\n`;
    filtered.forEach(c=>{
      const isExp=c.expiryDate&&daysDiff(c.expiryDate)<0;
      body+=`*Property:* ${c.address}\n*Type:* ${c.type}\n*Status:* ${isExp?'*EXPIRED*':'Expiring'} (${formatDateUK(c.expiryDate)||'No date'})\n\n`;
    });
    body+=`Please reply *YES* to authorise renewal.\n\nDeepFlow`;
    preview.style.fontFamily='var(--fm)';
    preview.textContent=body;
    document.getElementById('crem-lbl').textContent='WhatsApp Message Preview';
    if(sendBtn){sendBtn.textContent='Open WhatsApp';}
    const cleanPhone=phone.replace(/\D/g,'').replace(/^0/,'44');
    if(sendLink&&phone)sendLink.href=`https://wa.me/${cleanPhone}?text=${encodeURIComponent(body)}`;
  }
}

export function copyCremMsg(){
  const preview=document.getElementById('crem-preview');
  if(_cremMode==='email'){
    const range=document.createRange();range.selectNode(preview);
    window.getSelection().removeAllRanges();window.getSelection().addRange(range);
    document.execCommand('copy');window.getSelection().removeAllRanges();
    toast('HTML copied — paste into Outlook/Gmail');
  } else {
    navigator.clipboard.writeText(preview.textContent||'').then(()=>toast('Message copied!')).catch(()=>toast('Could not copy','warn'));
  }
}

export function certSendEmail(e){
  if(_cremMode!=='email')return;
  e.preventDefault();
  const preview=document.getElementById('crem-preview');
  const range=document.createRange();range.selectNode(preview);
  window.getSelection().removeAllRanges();window.getSelection().addRange(range);
  document.execCommand('copy');window.getSelection().removeAllRanges();
  toast('Table copied! Opening email client…');
  setTimeout(()=>window.location.href=_cremEmailLink,500);
}

// ════════════════════════════════════════════════════════════════
//  IMPORT / EXPORT
// ════════════════════════════════════════════════════════════════
export function parseDateSmart(v){
  if(!v)return null;
  const s=v.trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
  const parts=s.split(/[\/\-\.]/);
  if(parts.length===3){
    let d=parseInt(parts[0]),m=parseInt(parts[1]),y=parseInt(parts[2]);
    if(parts[0].length===4){y=parseInt(parts[0]);m=parseInt(parts[1]);d=parseInt(parts[2]);}
    else if(y<100)y+=2000;
    if(m>=1&&m<=12&&d>=1&&d<=31)return`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  // Last-resort fallback for formats the numeric-slash parse above didn't
  // catch (e.g. "15 March 2024"). Freeform, non-ISO strings like this parse
  // as LOCAL midnight, so reading dt's own local fields back (localDateStr)
  // is correct -- dt.toISOString() (UTC) would silently shift the imported
  // date by a day for any date that falls within BST.
  const dt=new Date(s);
  if(!isNaN(dt.getTime()))return localDateStr(dt);
  return null;
}

export async function importCertCSV(event){
  const file=event.target.files[0]; if(!file)return;
  const overlay=document.getElementById('cimport-overlay');
  const title=document.getElementById('cimport-title');
  const sub=document.getElementById('cimport-sub');
  const fill=document.getElementById('cimport-fill');
  const reasons=document.getElementById('cimport-reasons');
  const closeBtn=document.getElementById('cimport-close');
  overlay.style.display='flex';
  title.textContent='Reading file…'; sub.textContent='Please wait…';
  fill.style.width='0%'; reasons.style.display='none'; reasons.innerHTML=''; closeBtn.style.display='none';

  const reader=new FileReader();
  reader.onload=async function(e){
    title.textContent='Parsing data…'; fill.style.width='20%';
    const lines=e.target.result.split(/\r?\n/).filter(l=>l.trim());
    if(lines.length<=1){overlay.style.display='none';return toast('Empty CSV','error');}

    const parseLine=line=>{
      const parts=[]; let cur=''; let inQ=false;
      for(const ch of line){
        if(ch==='"')inQ=!inQ;
        else if(ch===','&&!inQ){parts.push(cur.trim());cur='';}
        else cur+=ch;
      }
      parts.push(cur.trim()); return parts;
    };

    const header=parseLine(lines[0]);
    const colMap={}; header.forEach((h,i)=>colMap[h.toLowerCase().replace(/['"]/g,'').trim()]=i);
    const gi=names=>{for(const n of names)if(colMap[n]!==undefined)return colMap[n];return -1;};
    const idx={addr:gi(['address','property address','addr']),type:gi(['type','certificate type','cert type']),
      exp:gi(['expiry','expiry date','expiry_date','date']),landlord:gi(['landlord','landlord name']),
      email:gi(['email','email address']),phone:gi(['phone','phone number','mobile']),
      agent:gi(['agent','agent details','agency']),notes:gi(['notes','comments','comment']),
      certnum:gi(['cert no','cert #','certificate number','cert number'])};

    const existing=await dAll('certs');
    let added=0,skipped=0; const skipLog=[];

    for(let i=1;i<lines.length;i++){
      const p=parseLine(lines[i]);
      const addr=idx.addr>=0?p[idx.addr]?.replace(/^"|"$/g,'')?.trim():'';
      const type=idx.type>=0?p[idx.type]?.replace(/^"|"$/g,'')?.trim():'';
      const expRaw=idx.exp>=0?p[idx.exp]?.replace(/^"|"$/g,'')?.trim():'';
      if(!addr||!type){skipped++;skipLog.push(`Row ${i+1}: Missing address or type`);continue;}
      const exp=parseDateSmart(expRaw);
      if(expRaw&&!exp){skipped++;skipLog.push(`Row ${i+1}: Invalid date "${expRaw}"`);continue;}
      // Duplicate check
      const isDup=existing.some(c=>
        (c.address||'').toLowerCase()===(addr||'').toLowerCase()&&
        (c.type||'').toLowerCase()===(type||'').toLowerCase()&&
        c.expiryDate===exp
      );
      if(isDup){skipped++;skipLog.push(`Row ${i+1}: Duplicate (${addr})`);continue;}

      const rec={id:uid(),address:addr,type,expiryDate:exp||'',noExpiry:!exp,
        landlord:idx.landlord>=0?p[idx.landlord]?.replace(/^"|"$/g,'')||'':'',
        email:idx.email>=0?p[idx.email]?.replace(/^"|"$/g,'')||'':'',
        phone:idx.phone>=0?p[idx.phone]?.replace(/^"|"$/g,'')||'':'',
        agent:idx.agent>=0?p[idx.agent]?.replace(/^"|"$/g,'')||'':'',
        notes:idx.notes>=0?p[idx.notes]?.replace(/^"|"$/g,'')||'':'',
        certNum:idx.certnum>=0?p[idx.certnum]?.replace(/^"|"$/g,'')||'':'',
        notResponding:false,issueDate:''};
      await dPut('certs',rec);
      existing.push(rec);
      added++;
      const pct=20+Math.round((i/lines.length)*70);
      fill.style.width=pct+'%';
      sub.textContent=`Added: ${added} | Skipped: ${skipped}`;
    }

    fill.style.width='100%';
    title.textContent='Import Complete! ✅';
    sub.textContent=`Added: ${added} | Skipped: ${skipped}`;
    if(skipLog.length){reasons.style.display='block';reasons.innerHTML='<strong>Skipped info:</strong><br>'+skipLog.slice(0,60).join('<br>')+(skipLog.length>60?`<br>… +${skipLog.length-60} more`:'');}
    closeBtn.style.display='inline-block';
    updateBadges(); await logActivity(`CSV import: ${added} certs added`,'cert');
    event.target.value='';
  };
  reader.readAsText(file);
}

export async function exportCertCSV(){
  const all=await dAll('certs');
  const filtered=ctblGetFiltered(all);
  let csv='Cert No,Address,Type,Expiry,Status,Landlord,Email,Phone,Agent,Notes\n';
  filtered.forEach(c=>{
    const st=calcCertStatus(c);
    csv+=`"${c.certNum||''}","${c.address||''}","${c.type||''}","${formatDateUK(c.expiryDate)}","${st.label}","${c.landlord||''}","${c.email||''}","${c.phone||''}","${c.agent||''}","${(c.notes||'').replace(/"/g,'""')}"\n`;
  });
  const b=new Blob([csv],{type:'text/csv'});
  const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`Certs_Export_${TODAY()}.csv`;a.click();
  toast(`${filtered.length} certs exported`,'success');
}

export async function exportCertPDF(){
  if(!window.jspdf)return toast('PDF library not loaded','error');
  if(!window.jspdf){toast('PDF library not loaded — please check your internet connection and try again','error');return;}
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF('l','mm','a4');
  const all=await dAll('certs');
  const filtered=ctblGetFiltered(all);
  doc.setFontSize(16);doc.text('DeepFlow — Compliance Certificate Report',14,18);
  doc.setFontSize(9);doc.text(`Generated: ${new Date().toLocaleDateString('en-GB')} | ${filtered.length} records`,14,25);
  const rows=filtered.map(c=>{
    const st=calcCertStatus(c);
    return[c.certNum||'—',c.address||'—',c.type||'—',formatDateUK(c.expiryDate)||'—',st.label,c.landlord||'—',c.agent||'—'];
  });
  doc.autoTable({startY:30,head:[['Cert #','Address','Type','Expiry','Status','Landlord','Agent']],body:rows,theme:'striped',styles:{fontSize:8},headStyles:{fillColor:[15,23,42]}});
  doc.save(`Certs_Report_${TODAY()}.pdf`);
  toast(`PDF generated (${filtered.length} records)`,'success');
}

export function downloadCertTemplate(){
  const csv='Cert No,Address,Type,Expiry,Landlord,Email,Phone,Agent,Notes\n"GAS-001","10 Example Street, London","Gas Safety","31/12/2025","John Smith","john@example.com","+44 7700 000000","ABC Agency","Annual check"';
  const b=new Blob([csv],{type:'text/csv'});
  const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='CertImport_Template.csv';a.click();
}
