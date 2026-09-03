// Jobs table: the Table/Planner view toggle, classic row drag-reorder, the
// column system (JOB_COLS drives header/rows/resize/show-hide/persistence),
// Excel-style column resize, and the scroll-list cross-date drag-to-reorder.
// Extracted from main.js verbatim (Phase 5e of the follow-up modularization
// pass — see the plan file for scope) — no behaviour changes.
//
// This module and main.js import from each other, same as every other
// extracted module: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import { renderPlanner } from './planner-board.js';
import {
  _calPaneVisible, selJobs, _jobRowData, _sb, dGet, dPut, toast,
  renderJobs, _invalidateJobCache, clearSel,
} from './main.js';

// ════════════════════════════════════════════════════════════════
//  JOBS VIEW — TABLE vs ENGINEER COLUMNS
// ════════════════════════════════════════════════════════════════
let jobsView='table';
export function setJobsView(v){
  jobsView=v;
  const engView=document.getElementById('eng-view');
  const listPane=document.getElementById('jobs-list-pane');
  const calPane=document.getElementById('jobs-cal-pane');
  // The visible Jobs table / Engineer Planner toggle. (btn-view-eng/
  // btn-view-list below were referenced here but never existed anywhere
  // in the page — dead code from before this toggle had a real button;
  // left as harmless no-ops via the null guards rather than removed, in
  // case something else still expects them.)
  const jViewTable=document.getElementById('j-view-btn-table');
  const jViewPlanner=document.getElementById('j-view-btn-planner');
  const btnEng=document.getElementById('btn-view-eng');
  const btnList=document.getElementById('btn-view-list');
  if(v==='engineer'){
    if(engView) engView.style.display='flex';
    if(listPane) listPane.style.display='none';
    if(calPane) calPane.style.display='none';
    if(jViewTable) jViewTable.classList.remove('active');
    if(jViewPlanner) jViewPlanner.classList.add('active');
    if(btnEng){ btnEng.classList.add('btn-acc'); btnEng.classList.remove('btn-ghost'); btnEng.style.display='none'; }
    if(btnList) btnList.style.display='';
    renderPlanner();
  } else {
    if(engView) engView.style.display='none';
    if(listPane) listPane.style.display='flex';
    if(calPane && _calPaneVisible) calPane.classList.remove('cal-hidden');
    if(jViewTable) jViewTable.classList.add('active');
    if(jViewPlanner) jViewPlanner.classList.remove('active');
    if(btnEng){ btnEng.classList.remove('btn-acc'); btnEng.classList.add('btn-ghost'); btnEng.style.display=''; }
    if(btnList) btnList.style.display='none';
    renderJobs();
  }
}


// ════════════════════════════════════════════════════════════════
//  DRAG & DROP JOB REORDERING
// ════════════════════════════════════════════════════════════════
let _dragSrc=null;

export function initDragDrop(){
  const tbody=document.getElementById('jtbody');
  if(!tbody) return;
  tbody.addEventListener('dragstart',e=>{
    const row=e.target.closest('tr[data-id]');
    if(!row) return;
    _dragSrc=row;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed='move';
  });
  tbody.addEventListener('dragover',e=>{
    e.preventDefault();
    const row=e.target.closest('tr[data-id]');
    if(!row||row===_dragSrc) return;
    document.querySelectorAll('#jtbody tr').forEach(r=>r.classList.remove('drag-over'));
    row.classList.add('drag-over');
  });
  tbody.addEventListener('dragleave',e=>{
    const row=e.target.closest('tr[data-id]');
    if(row) row.classList.remove('drag-over');
  });
  tbody.addEventListener('drop',async e=>{
    e.preventDefault();
    document.querySelectorAll('#jtbody tr').forEach(r=>r.classList.remove('dragging','drag-over'));
    const target=e.target.closest('tr[data-id]');
    if(!target||target===_dragSrc||!_dragSrc) return;
    const srcId=_dragSrc.dataset.id;
    const tgtId=target.dataset.id;
    const src=await dGet('jobs',srcId);
    const tgt=await dGet('jobs',tgtId);
    if(!src||!tgt) return;
    const tmpTs=src.created;
    src.created=tgt.created;
    tgt.created=tmpTs;
    await dPut('jobs',src);
    await dPut('jobs',tgt);
    _dragSrc=null;
    renderJobs();
  });
  tbody.addEventListener('dragend',()=>{
    document.querySelectorAll('#jtbody tr').forEach(r=>r.classList.remove('dragging','drag-over'));
    _dragSrc=null;
  });
}

// ════ Column config — which columns show, and their widths ════
// ════════════════════════════════════════════════════════════
//  COLUMN SYSTEM — single source of truth
//  JOB_COLS drives: header, rows, resize, show/hide, persistence
// ════════════════════════════════════════════════════════════
const JOB_COLS = [
  // PERCENTAGE-BASED layout — auto-fits any screen size with zero manual adjustment.
  // The 20px drag handle + 4px stripe are fixed; remaining width split by pct below.
  // Address has flex:true so it absorbs rounding remainders and hidden-col space.
  {key:'jobnum',   label:'Job #',       pct:5,  minPct:3,  protect:true},
  {key:'address',  label:'Address',     pct:22, minPct:12, flex:true, protect:true},
  {key:'desc',     label:'Description', pct:18, minPct:8},
  {key:'access',   label:'Access',      pct:10, minPct:5},
  {key:'time',     label:'Time',        pct:7,  minPct:4},
  {key:'eng',      label:'Engineer',    pct:8,  minPct:5},
  {key:'price',    label:'Amount',      pct:6,  minPct:4},
  {key:'referrer', label:'Referrer',    pct:9,  minPct:5},
  {key:'sel',      label:'Status',      pct:9,  minPct:7,  fixed:true},
  {key:'actions',  label:'',            pct:6,  minPct:5,  fixed:true},
];

// Persist hidden cols + column percentages
let _hiddenCols=[];

(function _loadColState(){
  try{
    const raw = JSON.parse(localStorage.getItem('df_hidden_cols')||'[]');
    // Strip any protected columns that may have been hidden in a previous buggy session
    _hiddenCols = raw.filter(k => {
      const col = JOB_COLS.find(c => c.key === k);
      return col && !col.protect; // never hide protected columns
    });
  }catch(e){ _hiddenCols = []; }
  try{
    // Version-guard: if the saved pct count doesn't match JOB_COLS count,
    // discard them — they're from a different column layout and will misalign.
    // Also discard old px-based saves (values > 100 are clearly px not %)
    // Force-clear on version bump to apply new action column width
    const COL_VERSION = 'v4'; // bump this when JOB_COLS changes
    const savedVer = localStorage.getItem('df_col_ver');
    if(savedVer !== COL_VERSION){
      localStorage.removeItem('df_col_pcts');
      localStorage.removeItem('df_col_widths');
      localStorage.setItem('df_col_ver', COL_VERSION);
    } else {
      const saved = JSON.parse(localStorage.getItem('df_col_pcts')||'null');
      if(saved && Array.isArray(saved) && saved.length === JOB_COLS.length
         && saved.every(v => v === null || (v > 0 && v <= 100))){
        saved.forEach((p,i)=>{ if(p && JOB_COLS[i]) JOB_COLS[i].pct = p; });
      } else if(saved){
        localStorage.removeItem('df_col_pcts');
        localStorage.removeItem('df_col_widths');
      }
    }
  }catch(e){ console.warn('[DeepFlow]', e); }
})();

function _saveColState(){
  localStorage.setItem('df_hidden_cols', JSON.stringify(_hiddenCols));
  localStorage.setItem('df_col_pcts',    JSON.stringify(JOB_COLS.map(c=>c.pct||null)));
}

// Build the CSS grid template string from current JOB_COLS pct values.
// prefix = header prefix ('20px 4px' for header, '18px 16px 3px' for rows)
// Hidden columns collapse to 0px — their percentage is redistributed proportionally
// to visible columns so the total always fills 100%.
export function getColTemplate(prefix){
  prefix = prefix || '20px 4px';
  const visible = JOB_COLS.filter(c => !_hiddenCols.includes(c.key));
  const hasFlex = visible.some(c => c.flex);

  // Calculate total pct of visible non-flex columns
  const visibleNonFlexPct = visible.filter(c => !c.flex).reduce((s, c) => s + (c.pct || 0), 0);
  const hiddenNonFlexPct = JOB_COLS.filter(c => _hiddenCols.includes(c.key) && !c.flex).reduce((s, c) => s + (c.pct || 0), 0);

  // Scale factor: if columns are hidden, scale up remaining non-flex columns proportionally
  // so they still fill the intended percentage of the remaining space
  const scale = (visibleNonFlexPct > 0 && hiddenNonFlexPct > 0) ? (visibleNonFlexPct + hiddenNonFlexPct) / visibleNonFlexPct : 1;

  let html = prefix + ' ';
  JOB_COLS.forEach(c => {
    if(_hiddenCols.includes(c.key)){ html += '0px '; return; }
    if(c.flex && hasFlex){
      // Flex column: minmax with minPct% lower bound, 1fr upper bound — absorbs hidden space
      html += 'minmax(40px, 1fr) ';
    }else{
      // Scale the pct proportionally if columns were hidden, then cap with minmax
      const scaledPct = Math.round(((c.pct || 0) * scale) * 10) / 10;
      const finalPct = Math.max(c.minPct || 3, scaledPct);
      html += 'minmax(40px, ' + finalPct + '%) ';
    }
  });
  return html.trim();
}

// Rebuild the sticky header from scratch so it always matches JOB_COLS exactly
export function renderJobsHeader(){
  const hd = document.getElementById('jobs-col-hd');
  if(!hd) return;
  // Header prefix: 34px (drag+sel combined) + 3px (stripe) = 37px, same as row prefix
  const t = getColTemplate('34px 3px');
  hd.style.gridTemplateColumns = t;

  // Drag+sel combined placeholder + stripe placeholder
  let html = '<div></div><div></div>';

  JOB_COLS.forEach((c, i) => {
    const hidden = _hiddenCols.includes(c.key);
    const isFixed = c.fixed;
    const resizeHandle = !isFixed
      ? `<div class="col-resize-handle" data-resize-col="${i}" title="Drag to resize"></div>`
      : '';
    const extraStyle = c.key==='actions'
      ? 'display:flex;align-items:center;gap:4px;'
      : c.key==='price' ? 'justify-content:flex-end;' : '';

    const colMenu = c.key==='actions'
      ? `<button onclick="showColMenu(event)" title="Show/hide columns"
           style="margin-left:auto;background:var(--s2);border:1px solid var(--border);border-radius:4px;padding:2px 6px;font-size:10px;cursor:pointer;color:var(--txt2);white-space:nowrap">⊞ Cols</button>`
      : '';

    html += `<div data-hd-col="${c.key}" style="position:relative;font-size:9px;font-weight:800;color:var(--txt3);
      text-transform:uppercase;letter-spacing:.8px;padding:6px 7px;display:${hidden?'none':'flex'};
      align-items:center;overflow:hidden;${extraStyle}">
      ${c.label}${colMenu}${resizeHandle}
    </div>`;
  });

  hd.innerHTML = html;
  // Re-attach resize mousedown after rebuilding
  _bindResizeHandles();
}

// Apply template + visibility to all rows without rebuilding header
// Header uses '20px 4px' prefix (drag placeholder + stripe placeholder)
// Rows use '18px 16px 3px' prefix (drag handle + sel-check + stripe)
export function applyColTemplate(){
  const hdT = getColTemplate('34px 3px');   // header: drag+sel combined (34px) + stripe (3px) = 37px
  const rowT = getColTemplate('18px 16px 3px'); // rows: drag (18px) + sel-check (16px) + stripe (3px) = 37px

  // Header
  const hd = document.getElementById('jobs-col-hd');
  if(hd){
    hd.style.gridTemplateColumns = hdT;
    hd.querySelectorAll('[data-hd-col]').forEach(cell=>{
      cell.style.display = _hiddenCols.includes(cell.dataset.hdCol) ? 'none' : 'flex';
    });
  }
  // Rows — use data-col attributes for robust cell lookup
  document.querySelectorAll('.jsr3').forEach(row=>{
    row.style.gridTemplateColumns = rowT;
    row.querySelectorAll('[data-col]').forEach(cell=>{
      cell.style.display = _hiddenCols.includes(cell.dataset.col) ? 'none' : '';
    });
  });
}

// Show/hide column toggle
export function toggleCol(key, show){
  // Never hide protected columns (address, status)
  const col = JOB_COLS.find(c=>c.key===key);
  if(col?.protect) return;
  if(show) _hiddenCols = _hiddenCols.filter(k=>k!==key);
  else if(!_hiddenCols.includes(key)) _hiddenCols.push(key);
  _saveColState();
  applyColTemplate();
  const hd = document.getElementById('jobs-col-hd');
  if(hd) hd.querySelectorAll('[data-hd-col]').forEach(cell=>{
    cell.style.display = _hiddenCols.includes(cell.dataset.hdCol) ? 'none' : 'flex';
  });
}

export function showColMenu(e){
  e.stopPropagation();
  const existing = document.getElementById('col-menu');
  if(existing){ existing.remove(); return; }
  const menu = document.createElement('div');
  menu.id = 'col-menu';
  menu.style.cssText = 'position:fixed;z-index:6000;background:var(--s1);border:1px solid var(--border2);border-radius:10px;box-shadow:var(--sh2);padding:8px 0;min-width:190px;animation:mIn .1s ease';
  menu.innerHTML = '<div style="padding:6px 14px 4px;font-size:9px;font-weight:800;color:var(--txt3);text-transform:uppercase;letter-spacing:1px">Show / Hide Columns</div>'
    // Only show non-fixed, non-protected columns in the picker
    + JOB_COLS.filter(c=>!c.fixed && !c.protect).map(c=>`
    <label style="display:flex;align-items:center;gap:8px;padding:6px 14px;cursor:pointer;font-size:12px;color:var(--txt2)" onmouseenter="this.style.background='var(--s2)'" onmouseleave="this.style.background=''">
      <input type="checkbox" ${_hiddenCols.includes(c.key)?'':'checked'} onchange="toggleCol('${c.key}',this.checked)" style="cursor:pointer;accent-color:var(--acc)">
      ${c.label}
    </label>`).join('')
    + `<div style="border-top:1px solid var(--border);margin:4px 0;padding:4px 14px">
      <button onclick="resetColWidths()" style="font-size:11px;color:var(--txt3);background:none;border:none;cursor:pointer;padding:0">↺ Reset widths</button>
    </div>`;
  const r = e.target.getBoundingClientRect();
  menu.style.left = Math.max(4, r.right - 200)+'px';
  menu.style.top  = (r.bottom + 4)+'px';
  document.body.appendChild(menu);
  // Close on click outside, NOT on clicks inside the menu (so checkboxes work)
  setTimeout(()=>{
    const closeMenu = (ev)=>{
      if(!menu.contains(ev.target)){
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    document.addEventListener('click', closeMenu);
  },50);
}

// Wrapper called from the "⊞ Choose Columns" ☰ dropdown item
export function toggleColPicker(){
  // Find the ☰ menu button as the anchor (since we're calling from the dropdown)
  const menuBtn = document.querySelector('#jobs-more-menu > button');
  if(menuBtn){
    showColMenu({target: menuBtn, stopPropagation: ()=>{}, clientX: 0, clientY: 0});
  }
}

export function resetColWidths(){
  // Reset each column's pct back to its original default
  const DEFAULTS = {jobnum:5,address:22,desc:18,access:10,time:7,eng:8,price:6,referrer:10,sel:10,actions:4};
  JOB_COLS.forEach(c=>{ c.pct = DEFAULTS[c.key] || c.pct; c.flex = (c.key==='address'); });
  _hiddenCols = [];
  localStorage.removeItem('df_col_pcts');
  _saveColState();
  renderJobsHeader();
  applyColTemplate();
  document.getElementById('col-menu')?.remove();
}

// ════ Column resize — Excel-style overlay ════
// FIX: Old system called applyColTemplate() on every mousemove, causing:
//   1. Full DOM reflow on every pixel — janky, cursor gets ahead of the column edge
//   2. The flex (address) column absorbed space changes mid-drag, so the handle
//      visual position jumped — dragging right made the column go left (reverse bug)
//   3. Reading JOB_COLS[colIdx].w on mousedown gave the stored w, not the rendered
//      pixel width — flex columns report w=null so startW was wrong from the start
//
// New approach: show a fixed vertical drag-line during drag (zero DOM reflow),
// read the REAL rendered pixel width from getBoundingClientRect on mousedown,
// apply the final width in ONE shot on mouseup. Exactly how Excel/Sheets does it.

let _colResizing = null, _colResizeStartX = 0, _colResizeStartW = 0;
let _resizeLine = null;

function _getResizeLine(){
  if(!_resizeLine){
    _resizeLine = document.createElement('div');
    _resizeLine.style.cssText = [
      'position:fixed','top:0','bottom:0','width:2px',
      'background:var(--acc)','opacity:.8','z-index:9999',
      'pointer-events:none','display:none',
      'box-shadow:0 0 6px rgba(245,166,35,.5)'
    ].join(';');
    document.body.appendChild(_resizeLine);
  }
  return _resizeLine;
}

function _bindResizeHandles(){
  const hd = document.getElementById('jobs-col-hd');
  if(!hd) return;
  hd.querySelectorAll('[data-resize-col]').forEach(handle=>{
    handle.onmousedown = e => {
      e.preventDefault(); e.stopPropagation();
      const colIdx = parseInt(handle.dataset.resizeCol);
      if(isNaN(colIdx) || !JOB_COLS[colIdx]) return;

      // Read ACTUAL rendered width in px from the header cell
      const headerCell = handle.closest('[data-hd-col]');
      const currentW = headerCell
        ? headerCell.getBoundingClientRect().width
        : 100;

      // Also read total grid width so we can convert px delta → pct delta on mouseup
      const gridW = hd.getBoundingClientRect().width - 24; // subtract drag+stripe

      _colResizing    = colIdx;
      _colResizeStartX = e.clientX;
      _colResizeStartW = currentW;
      _colResizeGridW  = gridW; // store for mouseup conversion

      const line = _getResizeLine();
      line.style.left    = e.clientX + 'px';
      line.style.display = 'block';

      document.body.style.cursor     = 'col-resize';
      document.body.style.userSelect = 'none';
      handle.classList.add('active');
    };
  });
}

let _colResizeGridW = 0; // total grid width captured on mousedown

document.addEventListener('mousemove', e=>{
  if(_colResizing === null) return;
  // Move ONLY the overlay line — no DOM reflow at all during drag
  const col     = JOB_COLS[_colResizing];
  const minPx   = _colResizeGridW > 0
    ? _colResizeGridW * ((col.minPct||3) / 100)
    : 40;
  const clampedX = Math.max(_colResizeStartX - _colResizeStartW + minPx, e.clientX);
  _getResizeLine().style.left = clampedX + 'px';
});

document.addEventListener('mouseup', e=>{
  if(_colResizing === null) return;

  const col   = JOB_COLS[_colResizing];
  const dxPx  = e.clientX - _colResizeStartX;
  const newPx = Math.max(
    (_colResizeGridW * (col.minPct||3) / 100),
    _colResizeStartW + dxPx
  );
  // Convert new pixel width back to percentage of total grid width
  const newPct = _colResizeGridW > 0
    ? Math.round((newPx / _colResizeGridW) * 100 * 10) / 10  // 1 decimal place
    : col.pct;

  col.pct  = Math.max(col.minPct || 3, newPct);
  col.flex = false; // lock flex column to fixed % if user resizes it

  _getResizeLine().style.display = 'none';
  _colResizing = null;
  document.body.style.cursor     = '';
  document.body.style.userSelect = '';

  document.querySelectorAll('[data-resize-col]').forEach(h=>{
    h.classList.remove('active');
    h.style.background = '';
    h.style.width      = '';
  });

  applyColTemplate();
  _saveColState();
});



// ════ Row drag — cross-date reorder ════
let _slDragSrc=null;
let _dragIndicator=null;
let _dragOverDate=null;

function _getDateGroup(el){
  const rows=el.closest('.jsg-rows');
  return rows?rows.dataset.date:null;
}

export function initScrollListDrag(){
  const scroll=document.getElementById('jobs-list-scroll');
  if(!scroll) return;
  if(scroll._dragInited) return;
  scroll._dragInited=true;

  if(!_dragIndicator){
    _dragIndicator=document.createElement('div');
    _dragIndicator.style.cssText='position:fixed;left:0;right:0;height:2px;background:var(--acc);border-radius:1px;pointer-events:none;display:none;z-index:9999;box-shadow:0 0 8px rgba(245,166,35,.6)';
    document.body.appendChild(_dragIndicator);
  }

  // Auto-scroll zones
  let _scrollZoneUp=null,_scrollZoneDown=null,_scrollInterval=null,_scrollSpeed=0;
  function _ensureScrollZones(){
    if(_scrollZoneUp)return;
    _scrollZoneUp=document.createElement('div');_scrollZoneUp.className='jsr-scroll-zone up';
    _scrollZoneDown=document.createElement('div');_scrollZoneDown.className='jsr-scroll-zone down';
    document.body.appendChild(_scrollZoneUp);document.body.appendChild(_scrollZoneDown);
  }
  function _startAutoScroll(direction,speed){
    _stopAutoScroll();
    _scrollInterval=setInterval(()=>{
      const pane=document.getElementById('jobs-list-pane');
      if(pane)pane.scrollTop+=direction*speed;
    },16);
  }
  function _stopAutoScroll(){if(_scrollInterval){clearInterval(_scrollInterval);_scrollInterval=null;}}
  function _updateScrollZones(cy){
    _ensureScrollZones();
    const pane=document.getElementById('jobs-list-pane');
    if(!pane)return;
    const rect=pane.getBoundingClientRect();
    const zone=60;
    if(cy<rect.top+zone&&cy>rect.top){
      _scrollZoneUp.classList.add('active');_scrollZoneDown.classList.remove('active');
      const speed=Math.max(3,Math.round((rect.top+zone-cy)/4));
      if(_scrollSpeed!==-speed){_scrollSpeed=-speed;_startAutoScroll(-1,speed);}
    }else if(cy>rect.bottom-zone&&cy<rect.bottom){
      _scrollZoneUp.classList.remove('active');_scrollZoneDown.classList.add('active');
      const speed=Math.max(3,Math.round((cy-(rect.bottom-zone))/4));
      if(_scrollSpeed!==speed){_scrollSpeed=speed;_startAutoScroll(1,speed);}
    }else{
      _scrollZoneUp.classList.remove('active');_scrollZoneDown.classList.remove('active');
      _stopAutoScroll();_scrollSpeed=0;
    }
  }

  // Stored drop targets — set during dragover, read at drop time.
  let _dropTargetRow=null,_dropTargetDate=null,_insertAfter=false,_rafPending=false,_lastHovered=null;

  function _clearDragState(){
    document.querySelectorAll('.jsr3.dragging,.jsr3.drag-over').forEach(r=>r.classList.remove('dragging','drag-over'));
    document.querySelectorAll('.jsg-hd[data-drag-target]').forEach(h=>{h.style.background='';h.style.border='';delete h.dataset.dragTarget;});
    if(_dragIndicator)_dragIndicator.style.display='none';
    _dropTargetRow=null;_dropTargetDate=null;_insertAfter=false;_lastHovered=null;_rafPending=false;
    _stopAutoScroll();_scrollSpeed=0;
    if(_scrollZoneUp)_scrollZoneUp.classList.remove('active');
    if(_scrollZoneDown)_scrollZoneDown.classList.remove('active');
  }

  scroll.addEventListener('dragstart',e=>{
    if(!e.target.closest('.jsr-drag-handle')){e.preventDefault();return;}
    const row=e.target.closest('.jsr3[data-id]');
    if(!row)return;
    _slDragSrc=row;
    _clearDragState();
    setTimeout(()=>row.classList.add('dragging'),0);
    e.dataTransfer.effectAllowed='move';
    e.dataTransfer.setData('text/plain',row.dataset.id);

    // Multi-drag: if this row is selected along with others, drag them all
    const selCount=selJobs.size;
    const isMulti=selCount>1&&selJobs.has(row.dataset.id);
    try{
      const jobNum=row.querySelector('.jsr3-jobnum')?.textContent||'Job';
      const ghost=document.createElement('div');
      ghost.className='jsr3-ghost';
      ghost.textContent=isMulti?'↕ Moving '+selCount+' jobs':'↕ '+jobNum;
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost,0,0);
      setTimeout(()=>ghost.remove(),0);
    }catch(_){}
  });

  scroll.addEventListener('dragover',e=>{
    e.preventDefault();
    e.dataTransfer.dropEffect='move';
    if(_rafPending)return;
    _rafPending=true;
    const cy=e.clientY,target=e.target;
    requestAnimationFrame(()=>{
      _rafPending=false;
      if(_lastHovered===target)return;
      _lastHovered=target;

      // Auto-scroll check
      _updateScrollZones(cy);

      const grpHd=target.closest('.jsg-hd[data-date-group]');
      const row=target.closest('.jsr3[data-id]');

      document.querySelectorAll('.jsr3.drag-over').forEach(r=>r.classList.remove('drag-over'));
      document.querySelectorAll('.jsg-hd[data-drag-target]').forEach(h=>{h.style.background='';h.style.border='';delete h.dataset.dragTarget;});
      if(_dragIndicator)_dragIndicator.style.display='none';

      if(grpHd){
        _dropTargetDate=grpHd.dataset.dateGroup;_dropTargetRow=null;
        grpHd.style.background='rgba(245,166,35,.2)';grpHd.style.border='1px dashed var(--acc)';grpHd.dataset.dragTarget='1';
      }else if(row&&row!==_slDragSrc){
        _dropTargetDate=null;_dropTargetRow=row;
        row.classList.add('drag-over');
        const rect=row.getBoundingClientRect();
        _insertAfter=cy>rect.top+rect.height/2;
        if(_dragIndicator){
          _dragIndicator.style.top=(_insertAfter?rect.bottom:rect.top)+'px';
          const pane=document.getElementById('jobs-list-scroll');
          const paneRect=pane?pane.getBoundingClientRect():{left:16,right:window.innerWidth-16};
          _dragIndicator.style.left=(paneRect.left+8)+'px';
          _dragIndicator.style.right=(window.innerWidth-paneRect.right+8)+'px';
          _dragIndicator.style.width='auto';_dragIndicator.style.display='block';
        }
      }
    });
  });

  scroll.addEventListener('dragleave',e=>{
    if(scroll.contains(e.relatedTarget))return;
    _clearDragState();
  });

  scroll.addEventListener('drop',async e=>{
    e.preventDefault();
    _stopAutoScroll();
    const srcId=_slDragSrc?.dataset.id;
    const isMultiDrag=selJobs.size>1&&selJobs.has(srcId);
    _slDragSrc=null;
    const dropDate=_dropTargetDate,dropRow=_dropTargetRow,insertAfter=_insertAfter;
    _clearDragState();
    if(!srcId)return;

    // Multi-drop: move all selected jobs
    if(isMultiDrag){
      const ids=[...selJobs];
      if(dropDate){
        ids.forEach(id=>{const j=_jobRowData[id];if(j){j.date=dropDate;j.modified=Date.now();}});
        toast('📅 Moved '+ids.length+' jobs to '+dropDate,'success',2000);
        renderJobs();
        Promise.all(ids.map(id=>_sb('jobs?id=eq.'+encodeURIComponent(id),{method:'PATCH',body:{date:dropDate,modified:Date.now()},prefer:'return=minimal'}))).catch(err=>{console.warn(err);_invalidateJobCache();renderJobs();});
        clearSel();return;
      }
      if(!dropRow)return;
      const tgtId=dropRow.dataset.id;
      if(!tgtId||tgtId===srcId){renderJobs();return;}
      const tgt=_jobRowData[tgtId];
      if(!tgt){renderJobs();return;}
      // Cross-day multi-drop
      const src=_jobRowData[srcId];
      if(src&&src.date!==tgt.date){
        ids.forEach(id=>{const j=_jobRowData[id];if(j){j.date=tgt.date;j.modified=Date.now();}});
        toast('📅 Moved '+ids.length+' jobs to '+tgt.date,'success',2000);
        renderJobs();
        Promise.all(ids.map(id=>_sb('jobs?id=eq.'+encodeURIComponent(id),{method:'PATCH',body:{date:tgt.date,modified:Date.now()},prefer:'return=minimal'}))).catch(err=>{console.warn(err);_invalidateJobCache();renderJobs();});
        clearSel();return;
      }
      // Same-day multi-reorder
      const fullGroup=Object.values(_jobRowData).filter(j=>j.date===tgt.date).sort((a,b)=>{
        const ao=a._sortOrder||0,bo=b._sortOrder||0;
        return(ao||bo)?ao-bo:(a.created||0)-(b.created||0);
      });
      const blockIds=ids.filter(id=>_jobRowData[id]&&_jobRowData[id].date===tgt.date);
      const otherIds=fullGroup.map(j=>j.id).filter(id=>!blockIds.includes(id));
      const tgtPos=otherIds.indexOf(tgtId);
      if(tgtPos===-1){renderJobs();return;}
      otherIds.splice(insertAfter?tgtPos+1:tgtPos,0,...blockIds);
      const saves=[];
      otherIds.forEach((id,i)=>{const j=_jobRowData[id];if(!j)return;const newOrd=(i+1)*1000;if(j._sortOrder===newOrd)return;j._sortOrder=newOrd;j.modified=Date.now();saves.push(_sb('jobs?id=eq.'+encodeURIComponent(id),{method:'PATCH',body:{sortorder:newOrd,modified:Date.now()},prefer:'return=minimal'}));});
      toast('↕ Reordered '+ids.length+' jobs','success',1500);
      renderJobs();Promise.all(saves).catch(err=>{console.warn(err);_invalidateJobCache();renderJobs();});
      clearSel();return;
    }

    // Single drop (original logic)
    const src=_jobRowData[srcId];
    if(!src){console.warn('[DeepFlow] drop: job not found',srcId);return;}
    const now=Date.now();
    if(dropDate&&dropDate!==src.date){
      src.date=dropDate;src.modified=now;_jobRowData[srcId]=src;
      toast('📅 Moved to '+dropDate,'success',2000);renderJobs();
      _sb('jobs?id=eq.'+encodeURIComponent(srcId),{method:'PATCH',body:{date:dropDate,modified:now},prefer:'return=minimal'})
        .catch(err=>{console.warn(err);_invalidateJobCache();renderJobs();});
      return;
    }
    if(!dropRow){renderJobs();return;}
    const tgtId=dropRow.dataset.id;
    if(!tgtId||tgtId===srcId){renderJobs();return;}
    const tgt=_jobRowData[tgtId];
    if(!tgt){console.warn('[DeepFlow] drop: tgt not found',tgtId);return;}
    if(src.date!==tgt.date){
      src.date=tgt.date;src.modified=now;_jobRowData[srcId]=src;
      toast('📅 Moved to '+tgt.date,'success',2000);renderJobs();
      _sb('jobs?id=eq.'+encodeURIComponent(srcId),{method:'PATCH',body:{date:tgt.date,modified:now},prefer:'return=minimal'})
        .catch(err=>{console.warn(err);_invalidateJobCache();renderJobs();});
      return;
    }
    const fullGroup=Object.values(_jobRowData).filter(j=>j.date===src.date).sort((a,b)=>{
      const ao=a._sortOrder||0,bo=b._sortOrder||0;
      return(ao||bo)?ao-bo:(a.created||0)-(b.created||0);
    });
    const fullIds=fullGroup.map(j=>j.id);
    const withoutSrc=fullIds.filter(id=>id!==srcId);
    const tgtPos=withoutSrc.indexOf(tgtId);
    if(tgtPos===-1){renderJobs();return;}
    withoutSrc.splice(insertAfter?tgtPos+1:tgtPos,0,srcId);
    const saves=[];
    withoutSrc.forEach((id,i)=>{const j=_jobRowData[id];if(!j)return;const newOrd=(i+1)*1000;if(j._sortOrder===newOrd)return;j._sortOrder=newOrd;j.modified=now;saves.push(_sb('jobs?id=eq.'+encodeURIComponent(id),{method:'PATCH',body:{sortorder:newOrd,modified:now},prefer:'return=minimal'}));});
    toast('↕ Order saved','success',800);renderJobs();
    Promise.all(saves).catch(err=>{console.warn(err);_invalidateJobCache();renderJobs();});
  });

  scroll.addEventListener('dragend',()=>{_stopAutoScroll();_clearDragState();_slDragSrc=null;});
  requestAnimationFrame(()=>{renderJobsHeader();applyColTemplate();});
}
