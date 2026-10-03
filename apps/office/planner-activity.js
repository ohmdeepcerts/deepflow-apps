// Job Activity tab — the visits, engineers, comments, photos and tasks for one
// job, with engineer chips, content filters, search, sort, a comment feed and
// per-engineer task lists. Rendered into #dfpDetailActivity by
// planner-detail.js; every control is wired through the data-act attributes
// and the data-* hooks handled below.

import { escHtml } from '@ui';
import { formatDateUK } from '@business';
import { S, _sb, toast, getAppUser, signedUrl, uploadVisitPhotos } from './main.js';

const PALETTE = ['#6d54c1','#0f766e','#b45309','#be123c','#1d4ed8','#4d7c0f','#a21caf','#0e7490'];
const TYPES = [['all','Everything'],['comments','Comments'],['photos','Photos'],['handover','Handover']];

const state = { view:'visits', eng:'all', type:'all', q:'', sort:'newest' };
let ctx = { jobId:null, visits:[], photos:[], signed:{} };

const stamp = () => new Date().toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
const isHandover = c => c.kind==='handover';
const colour = name => { let h=0; for(const ch of String(name)) h=(h*31+ch.charCodeAt(0))|0; return PALETTE[Math.abs(h)%PALETTE.length]; };
const initials = name => String(name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
const hit = s => !state.q || String(s||'').toLowerCase().includes(state.q.toLowerCase());
const commentsOf = v => Array.isArray(v.comments) ? v.comments : [];
const engsOf = v => v.engineers||[];
const photosOf = v => ctx.photos.filter(p=>p.visit_id===v.id);
const dateOf = v => formatDateUK(v.visit_date)||v.visit_date||'';

function engineerNames(){
  const names=new Set((S.engineers||[]).map(e=>e.name).filter(Boolean));
  ctx.visits.forEach(v=>{
    engsOf(v).forEach(n=>names.add(n));
    commentsOf(v).forEach(c=>{ if(c.by && c.by!=='Office') names.add(c.by); });
  });
  return [...names].sort((a,b)=>a.localeCompare(b));
}

function visibleComments(v){
  return commentsOf(v).map((c,i)=>({...c,_i:i})).filter(c=>{
    if(state.eng!=='all' && c.by!==state.eng) return false;
    if(state.type==='photos') return false;
    if(state.type==='comments' && isHandover(c)) return false;
    if(state.type==='handover' && !isHandover(c)) return false;
    return hit(c.text);
  });
}

function visitMatchesEng(v){
  return state.eng==='all' || engsOf(v).includes(state.eng) || commentsOf(v).some(c=>c.by===state.eng);
}

function visitVisible(v){
  if(!visitMatchesEng(v)) return false;
  const cs=visibleComments(v);
  if(state.type==='comments'||state.type==='handover') return cs.length>0;
  if(state.type==='photos') return photosOf(v).length>0;
  if(state.q) return hit(v.notes) || engsOf(v).some(hit) || cs.length>0;
  return true;
}

function render(){
  const el=document.getElementById('dfpDetailActivity');
  if(!el) return;
  if(!ctx.visits.length){ el.innerHTML='<div class="detail-empty">No visits logged for this job yet.</div>'; return; }
  el.innerHTML = filterBar() + (state.eng!=='all' ? tasksPanel() : '') + (state.view==='feed' ? feedView() : visitsView());
}

const ENG_PREVIEW = 3;
let showAllEng = false;

function assignedNames(){
  return [...new Set(ctx.visits.flatMap(v=>engsOf(v)))].sort((a,b)=>a.localeCompare(b));
}

function filterBar(){
  const all=assignedNames();
  const extra=all.slice(ENG_PREVIEW);
  const names = showAllEng ? all : [...all.slice(0,ENG_PREVIEW), ...(extra.includes(state.eng) ? [state.eng] : [])];
  const hidden = all.length - names.length;
  const chip=(val,label,sub,dot)=>`<button type="button" class="act-chip${state.eng===val?' on':''}" data-act="eng" data-val="${escHtml(val)}">${dot?`<span class="dot" style="background:${dot}"></span>`:''}${escHtml(label)}${sub?` <small>${escHtml(sub)}</small>`:''}</button>`;
  const engChips = chip('all','All engineers',`${ctx.visits.length} visits`) + names.map(n=>{
    const visits=ctx.visits.filter(v=>engsOf(v).includes(n)).length;
    const notes=ctx.visits.reduce((s,v)=>s+commentsOf(v).filter(c=>!isHandover(c)&&c.by===n).length,0);
    return chip(n,n,`${visits} visit${visits===1?'':'s'} · ${notes} comment${notes===1?'':'s'}`,colour(n));
  }).join('') + (all.length>ENG_PREVIEW ? `<button type="button" class="act-chip act-more" data-act="more-eng">${showAllEng?'Show fewer':`+${hidden} more`}</button>` : '');
  const totalNotes=ctx.visits.reduce((s,v)=>s+commentsOf(v).filter(c=>!isHandover(c)).length,0);
  const totalPhotos=ctx.photos.length;
  const totalHandover=ctx.visits.reduce((s,v)=>s+commentsOf(v).filter(isHandover).length,0);
  return `<div class="act-bar">
    <div class="act-row act-engs">${engChips}</div>
    <div class="act-row">
      ${TYPES.map(([v,l])=>`<button type="button" class="act-chip${state.type===v?' on':''}" data-act="type" data-val="${v}">${l}</button>`).join('')}
      <span class="act-sep"></span>
      <button type="button" class="act-chip${state.view==='visits'?' on':''}" data-act="view" data-val="visits">By visit</button>
      <button type="button" class="act-chip${state.view==='feed'?' on':''}" data-act="view" data-val="feed">Comment feed</button>
    </div>
    <div class="act-row">
      <input type="search" class="act-search" data-act="search" placeholder="Search notes, handovers and comments…" value="${escHtml(state.q)}">
      <select class="act-select" data-act="sort" title="Sort order">
        <option value="newest"${state.sort==='newest'?' selected':''}>Newest first</option>
        <option value="oldest"${state.sort==='oldest'?' selected':''}>Oldest first</option>
      </select>
    </div>
    <div class="act-stats">${ctx.visits.length} visits · ${totalNotes} comments · ${totalHandover} handover notes · ${totalPhotos} photos</div>
  </div>`;
}

function tasksPanel(){
  const mine=ctx.visits.map((v,i)=>({v,no:i+1})).filter(({v})=>engsOf(v).includes(state.eng));
  const done=mine.filter(({v})=>v.completed).length;
  return `<div class="act-tasks">
    <div class="act-tasks-head"><b>${escHtml(state.eng)} — tasks</b><span>${done} of ${mine.length} visit${mine.length===1?'':'s'} done</span></div>
    ${mine.length ? mine.map(({v,no})=>{
      const next=commentsOf(v).filter(isHandover).map(c=>c.text).join('\n\n');
      return `<div class="act-task${v.completed?' done':''}">
        <button type="button" class="act-task-check" data-act="task-toggle" data-visit="${v.id}" data-done="${v.completed?'0':'1'}" title="${v.completed?'Reopen this visit':'Mark this visit done'}">${v.completed?'✓':''}</button>
        <div class="act-task-body"><b>Visit ${no} · ${escHtml(dateOf(v))}</b><span>${escHtml(v.notes||'No notes yet')}</span>${next?`<em>Next: ${escHtml(next)}</em>`:''}</div>
      </div>`;
    }).join('') : `<div class="detail-empty" style="padding:12px">No visits assigned to ${escHtml(state.eng)} yet.</div>`}
  </div>`;
}

function visitsView(){
  const list=ctx.visits.map((v,i)=>({v,no:i+1})).filter(({v})=>visitVisible(v));
  if(!list.length) return '<div class="detail-empty">Nothing matches these filters.</div>';
  list.sort((a,b)=>(a.v.visit_date||'').localeCompare(b.v.visit_date||'') * (state.sort==='newest'?-1:1));
  return `<div class="activity-timeline">${list.map(({v,no})=>visitCard(v,no)).join('')}</div>`;
}

function visitCard(v,no){
  const shown=visibleComments(v);
  const handover=shown.filter(isHandover);
  const comments=shown.filter(c=>!isHandover(c));
  const engs=engsOf(v);
  const showPhotos=state.type==='all'||state.type==='photos';
  const showComposer=state.type==='all'||state.type==='comments';
  const me=getAppUser()?.name;
  const defaultBy = state.eng!=='all' ? state.eng : (engs.includes(me) ? me : (engs[0]||'Office'));
  const authors=[...new Set([...engs, ...engineerNames(), 'Office'])];
  return `<article class="visit-detail-card">
    <div class="visit-detail-head">
      <div class="visit-number-block"><small>Visit</small><b>${no}</b></div>
      <div class="visit-head-main">
        <h3>${engs.length ? engs.map(n=>`<button type="button" class="act-eng-tag" style="background:${colour(n)}" data-act="eng" data-val="${escHtml(n)}" title="Show only ${escHtml(n)}">${escHtml(n)}</button>`).join('') : 'No engineer assigned'}</h3>
        <p class="visit-notes">${escHtml(v.notes||'No notes for this visit')}</p>
      </div>
      <div class="visit-head-meta"><b>${escHtml(dateOf(v))}</b>${v.completed?'<span class="act-done">✓ Done</span>':''}</div>
    </div>
    <div class="visit-detail-body">
      ${handover.length ? handoverBox(handover,v.id) : ''}
      <div class="visit-section-title">Comments <span class="count">${comments.length}</span></div>
      <div class="visit-comments">
        ${comments.length ? comments.map(c=>commentRow(c,v.id)).join('') : `<div class="detail-empty" style="padding:12px">No comments${state.eng!=='all'?` from ${escHtml(state.eng)}`:''} on this visit yet.</div>`}
      </div>
      ${showComposer ? composer(v.id,authors,defaultBy) : ''}
      ${showPhotos ? photosBlock(v) : ''}
    </div>
  </article>`;
}

function handoverBox(list,visitId){
  return `<div class="visit-handover">
    <div class="visit-handover-title">Handover for the next engineer / visit</div>
    ${list.map(h=>`<div class="act-handover-row">
      <div><div class="visit-handover-text">${escHtml(h.text||'')}</div><div class="visit-handover-by">${escHtml(h.by||'Office')} · ${escHtml(h.time||'')}</div></div>
      <button type="button" class="act-del" data-act="del-comment" data-visit="${visitId}" data-idx="${h._i}" data-stamp="${escHtml(h.time||'')}" title="Delete this handover note">✕</button>
    </div>`).join('')}
  </div>`;
}

function commentRow(c,visitId){
  const who=c.by||'Office';
  return `<div class="visit-comment">
    <div class="visit-eng-avatar" style="background:${colour(who)};color:#fff">${escHtml(initials(who))}</div>
    <div class="comment-who"><b>${escHtml(who)}</b><span>${escHtml(c.time||'')}</span></div>
    <div class="comment-text">${escHtml(c.text||'')}</div>
    <button type="button" class="act-del" data-act="del-comment" data-visit="${visitId}" data-idx="${c._i}" data-stamp="${escHtml(c.time||'')}" title="Delete this comment">✕</button>
  </div>`;
}

function composer(visitId,authors,defaultBy){
  return `<div class="visit-comment-form">
    <select class="dfp-comment-by" data-by="${visitId}" title="Who is writing this comment">
      ${authors.map(n=>`<option value="${escHtml(n)}"${n===defaultBy?' selected':''}>${escHtml(n)}</option>`).join('')}
    </select>
    <textarea class="dfp-comment-input" data-input="${visitId}" rows="3" placeholder="Write the full comment — what was found, what the next engineer must check, materials needed. (Ctrl+Enter to post)"></textarea>
    <button type="button" class="btn btn-acc dfp-add-comment" data-act="add-comment" data-visit="${visitId}">Add comment</button>
  </div>`;
}

function photosBlock(v){
  const photos=photosOf(v);
  return `<div class="visit-section-title">Photos <span class="count">${photos.length}</span></div>
    <div class="visit-photos">
      ${photos.length ? photos.map(photoTile).join('') : '<div class="detail-empty" style="grid-column:1/-1;padding:12px">No photos on this visit yet.</div>'}
    </div>
    <div class="visit-photo-add">
      <input type="file" data-photos="${v.id}" accept="image/*" multiple>
      <span>Choose one or several photos — added to this visit straight away.</span>
    </div>`;
}

function photoTile(p){
  const src=ctx.signed[p.storage_path];
  const preview = src
    ? `<a href="${src}" target="_blank"><img src="${src}" alt="${escHtml(p.name||'Photo')}" class="visit-photo-preview" style="width:100%;height:100%;object-fit:cover;border-radius:inherit"></a>`
    : '<div class="visit-photo-preview">▧</div>';
  return `<div class="visit-photo" title="${escHtml(p.name||'')}">${preview}<div class="visit-photo-info"><b>${escHtml(p.name||'Photo')}</b><span>${escHtml(p.uploaded_by_name||'')}</span></div></div>`;
}

function feedView(){
  const rows=[];
  ctx.visits.forEach((v,i)=>{
    if(!visitMatchesEng(v)) return;
    visibleComments(v).forEach(c=>rows.push({v,no:i+1,c}));
  });
  if(!rows.length) return '<div class="detail-empty">No comments match these filters.</div>';
  rows.sort((a,b)=>(a.v.visit_date||'').localeCompare(b.v.visit_date||'') || a.c._i-b.c._i);
  if(state.sort==='newest') rows.reverse();
  return `<div class="act-feed">${rows.map(({v,no,c})=>{
    const who=c.by||'Office';
    return `<div class="act-feed-item${isHandover(c)?' is-handover':''}">
      <div class="act-feed-meta"><span class="act-feed-visit">Visit ${no}</span><span>${escHtml(dateOf(v))}</span>${isHandover(c)?'<span class="act-feed-kind">Handover</span>':''}</div>
      <div class="act-feed-who"><span class="visit-eng-avatar" style="background:${colour(who)};color:#fff">${escHtml(initials(who))}</span><b>${escHtml(who)}</b><span>${escHtml(c.time||'')}</span>
        <button type="button" class="act-del" data-act="del-comment" data-visit="${v.id}" data-idx="${c._i}" data-stamp="${escHtml(c.time||'')}" title="Delete">✕</button></div>
      <div class="comment-text">${escHtml(c.text||'')}</div>
    </div>`;
  }).join('')}</div>`;
}

async function fetchVisit(visitId){
  const rows=await _sb(`job_visits?id=eq.${encodeURIComponent(visitId)}&limit=1`);
  return rows && rows[0];
}

const patchVisit=(visitId,body)=>_sb(`job_visits?id=eq.${encodeURIComponent(visitId)}`,{method:'PATCH',body,prefer:'return=minimal'});

async function reload(){
  const [visits,photos]=await Promise.all([
    _sb(`job_visits?jobid=eq.${encodeURIComponent(ctx.jobId)}&order=visit_date.asc,created.asc`),
    _sb(`attachments?jobid=eq.${encodeURIComponent(ctx.jobId)}&visit_id=not.is.null`),
  ]);
  const signed={};
  await Promise.all((photos||[]).map(async p=>{ if(p.storage_path) signed[p.storage_path]=await signedUrl(p.storage_path,3600); }));
  ctx={jobId:ctx.jobId, visits:visits||[], photos:photos||[], signed};
  render();
}

async function postComment(visitId,text,by){
  const visit=await fetchVisit(visitId);
  if(!visit){ toast('Visit not found — refresh the page','error'); return; }
  await patchVisit(visitId,{comments:[...commentsOf(visit), {by, time:stamp(), text}]});
  toast('Comment added','success',2000);
  await reload();
}

async function addComment(visitId){
  const text=(document.querySelector(`textarea[data-input="${visitId}"]`)?.value||'').trim();
  if(!text) return;
  const by=document.querySelector(`select[data-by="${visitId}"]`)?.value||'Office';
  await postComment(visitId,text,by);
}

async function deleteComment(visitId,idx,stampText){
  if(!confirm('Delete this comment?')) return;
  const visit=await fetchVisit(visitId);
  const comments=commentsOf(visit||{});
  if(!comments[idx] || (comments[idx].time||'')!==stampText){
    toast('That comment has changed — refreshed, try again','warn');
    await reload();
    return;
  }
  comments.splice(idx,1);
  await patchVisit(visitId,{comments});
  toast('Comment deleted','success',2000);
  await reload();
}

async function setVisitDone(visitId,done){
  await patchVisit(visitId,{
    completed:done,
    completed_at: done ? new Date().toISOString() : null,
    completed_by: done ? (getAppUser()?.name||'Office') : null,
  });
  toast(done?'Visit marked done':'Visit reopened','success',2000);
  await reload();
}

document.addEventListener('click', async e=>{
  const t=e.target.closest('[data-act]');
  if(!t || !t.closest('#dfpDetailActivity')) return;
  const act=t.dataset.act;
  if(act==='view'){ state.view=t.dataset.val; render(); return; }
  if(act==='eng'){ state.eng = (state.eng===t.dataset.val && t.dataset.val!=='all') ? 'all' : t.dataset.val; render(); return; }
  if(act==='type'){ state.type=t.dataset.val; render(); return; }
  if(act==='more-eng'){ showAllEng=!showAllEng; render(); return; }
  if(act==='add-comment'){ await addComment(t.dataset.visit); return; }
  if(act==='del-comment'){ await deleteComment(t.dataset.visit, Number(t.dataset.idx), t.dataset.stamp); return; }
  if(act==='task-toggle'){ await setVisitDone(t.dataset.visit, t.dataset.done==='1'); }
});

document.addEventListener('input', e=>{
  const s=e.target.closest?.('[data-act="search"]');
  if(!s || !s.closest('#dfpDetailActivity')) return;
  const pos=s.selectionStart;
  state.q=s.value.trim();
  render();
  const again=document.querySelector('#dfpDetailActivity [data-act="search"]');
  if(again){ again.focus(); again.setSelectionRange(pos,pos); }
});

document.addEventListener('change', async e=>{
  const t=e.target;
  if(t.matches?.('[data-act="sort"]') && t.closest('#dfpDetailActivity')){ state.sort=t.value; render(); return; }
  if(t.matches?.('input[data-photos]') && t.closest('#dfpDetailActivity') && t.files.length){
    const files=[...t.files];
    const failed=await uploadVisitPhotos(ctx.jobId, t.dataset.photos, files);
    t.value='';
    if(failed) toast(`${failed} of ${files.length} photo(s) failed to upload`,'warn',6000);
    else toast(`${files.length} photo(s) added to the visit`,'success');
    await reload();
  }
});

document.addEventListener('keydown', e=>{
  const ta=e.target.closest?.('textarea[data-input]');
  if(!ta || e.key!=='Enter' || !(e.ctrlKey||e.metaKey) || !ta.closest('#dfpDetailActivity')) return;
  e.preventDefault();
  addComment(ta.dataset.input);
});

export function renderActivity(jobId, visits, photos, signed){
  ctx={jobId, visits, photos, signed};
  state.eng='all';
  state.type='all';
  state.q='';
  render();
}
