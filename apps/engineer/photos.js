// Photo Management — the Before/After photo system (paired slots with a
// standard-grid fallback), the standard multi-file upload path, and the
// shared image pipeline (compression, EXIF read, GPS-aware footer stamp)
// both paths use. Extracted from main.js verbatim (Phase 5 of the
// architecture migration, Employee App module 6) — no behaviour changes.
//
// currentJob/currentUser/_uploadHD are all reassigned elsewhere in
// main.js (JOB DETAIL's openJob()/setQuality(), AUTH's login/logout), so
// this module reads them through exported getters — same pattern as
// setWeather() in geo-weather.js. _baMode is the mirror case: it's
// reassigned here but read externally by renderJobDetail() (JOB DETAIL,
// still in main.js) to set button/input state, so it's read back out
// through the exported getBaMode().
//
// _renderPhotoGrid() is called directly from renderJobDetail() right
// after the modal body is built — that one external call is why this
// module needs no callback into JOB DETAIL: the coupling is one-directional
// (JOB DETAIL → photos), unlike the Office App's Jobs/Invoices tangle.

import { sb, sbStorage, toast, openJob, getCurrentJob, getCurrentUser, getUploadHD } from './main.js';
import { SB_URL, SB_KEY } from '@core';

let _baMode        = false;  // true = before/after mode active
let _baPendingSlot = null;   // which slot number triggered the file picker
let _baPendingRole = null;   // 'before' or 'after'

export function getBaMode(){ return _baMode; }

export function _setPhotoMode(isBA, btn){
  _baMode = isBA;
  // Update toggle buttons
  document.querySelectorAll('.ba-mode-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  // Show/hide standard upload button
  const stdBtn = document.getElementById('std-upload-btn');
  if(stdBtn) stdBtn.style.display = isBA ? 'none' : 'block';
  // Update stamp notice text
  const notice = document.getElementById('stamp-notice-txt');
  if(notice) notice.innerHTML = isBA
    ? '📸 Photos auto-stamped with address, sequence &amp; Before/After label.'
    : '📸 Photos auto-stamped with address and your name.';
  // Re-render grid
  const currentJob=getCurrentJob();
  if(currentJob) _renderPhotoGrid(currentJob._latestAtts||[]);
  if(navigator.vibrate) navigator.vibrate(20);
}

// Main grid renderer — called after renderJobDetail and after each upload
export function _renderPhotoGrid(atts){
  const area = document.getElementById('ba-photo-area');
  if(!area) return;
  const photos = atts.filter(a=>a.type==='photo');

  if(!_baMode){
    // ── Standard grid (3-col, same as before) ──────────────────
    if(!photos.length){ area.innerHTML=''; return; }
    area.innerHTML = `<div class="photo-grid">${
      photos.map(a=>`<div class="photo-wrap">
        <img src="${a.url}" class="photo-img" onclick="window.open('${a.url}','_blank')" loading="lazy">
      </div>`).join('')
    }</div>`;
    return;
  }

  // ── Before / After grid ────────────────────────────────────
  // Group photos by photo_slot. Photos without a slot get slot 0 (ungrouped).
  // Slots are numbered 1, 2, 3…
  const slotMap = {}; // slot -> {before, after}
  const unslotted = [];

  photos.forEach(a=>{
    if(a.photo_slot && a.photo_role){
      const s = a.photo_slot;
      if(!slotMap[s]) slotMap[s] = {slot:s, before:null, after:null};
      slotMap[s][a.photo_role] = a;
    } else {
      unslotted.push(a);
    }
  });

  // Determine next slot number for new pairs
  const existingSlots = Object.keys(slotMap).map(Number).sort((a,b)=>a-b);
  const nextSlot = existingSlots.length ? existingSlots[existingSlots.length-1]+1 : 1;

  let html = '<div class="ba-grid">';

  // Render existing slots
  existingSlots.forEach(slot=>{
    const pair = slotMap[slot];
    html += _baPairHTML(slot, pair.before, pair.after);
  });

  // Always show one empty pair for adding a new B/A set
  html += _baPairHTML(nextSlot, null, null);

  // Unslotted photos (taken before mode was switched on) shown below
  if(unslotted.length){
    html += `<div style="font-size:10px;font-weight:800;color:var(--txt3);text-transform:uppercase;letter-spacing:.8px;margin:8px 0 5px">Earlier Photos</div>
    <div class="photo-grid">${
      unslotted.map(a=>`<div class="photo-wrap">
        <img src="${a.url}" class="photo-img" onclick="window.open('${a.url}','_blank')" loading="lazy">
      </div>`).join('')
    }</div>`;
  }

  html += '</div>';
  area.innerHTML = html;
}

function _baPairHTML(slot, before, after){
  const _slot = (role, att) => {
    const hasPhoto = !!att;
    const label = role === 'before' ? '⬅ Before' : 'After ➡';
    const img = hasPhoto
      ? `<img src="${att.url}" class="photo-img" onclick="window.open('${att.url}','_blank')" loading="lazy">
         <button class="ba-del-btn" onclick="_deleteBAPhoto('${att.id}','${att.storage_path||''}',event)" title="Delete">✕</button>`
      : `<button class="ba-add-btn" onclick="_triggerBAUpload(${slot},'${role}')">
           <div class="ba-plus">+</div>
           <span style="font-size:10px">${role==='before'?'Add Before':'Add After'}</span>
         </button>`;
    return `<div class="ba-slot role-${role} ${hasPhoto?'has-photo':''}">
      <div class="ba-slot-label">${label}</div>
      ${img}
    </div>`;
  };

  return `<div class="ba-pair">
    <div class="ba-pair-num">Photo ${slot}</div>
    ${_slot('before', before)}
    ${_slot('after',  after)}
  </div>`;
}

export function _triggerBAUpload(slot, role){
  _baPendingSlot = slot;
  _baPendingRole = role;
  const input = document.getElementById(role==='before'?'photo-input-before':'photo-input-after');
  if(input){ input.value=''; input.click(); }
}

export async function _handleBAUpload(input, role){
  const files = Array.from(input.files);
  const currentJob=getCurrentJob(), currentUser=getCurrentUser();
  if(!files.length || !currentJob) return;
  input.value='';
  const slot = _baPendingSlot;
  if(!slot){ toast('⚠️ No slot selected — tap a + button first','error'); return; }

  const seqLabel = `Photo ${slot} — ${role.charAt(0).toUpperCase()+role.slice(1)}`;
  toast(`⬆️ Processing ${seqLabel}…`,'info');

  try{
    let file = files[0]; // B/A is always 1 photo at a time per slot
    // EXIF
    const exif  = await _readExif(file);
    let captureTime = null;
    if(exif.dateTimeOriginal){
      try{
        const[dp,tp]=exif.dateTimeOriginal.split(' ');
        const[y,mo,d]=dp.split(':');
        captureTime=new Date(`${y}-${mo}-${d}T${tp}`);
        if(isNaN(captureTime)) captureTime=null;
      }catch(e){}
    }
    const stampTime = captureTime || new Date();
    // Compress (max 1200px width, quality 0.8)
    if(!getUploadHD()) file = await _compressImage(file,1200,0.8);
    // Stamp — pass the sequence label so it appears in the footer
    file = await _stampPhoto(file, currentJob.address||'', currentUser.name, stampTime, seqLabel);
    // Upload
    const ext  = file.name.split('.').pop()?.toLowerCase()||'jpg';
    const path = `jobs/${currentJob.id}/${Date.now()}-${Math.random().toString(36).slice(2,6)}.${ext}`;
    const url  = await sbStorage(path,file);
    // Save with slot + role metadata
    await sb('attachments',{method:'POST',body:{
      id:`att-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      jobid:currentJob.id, name:file.name, type:'photo',
      mime:file.type||'image/jpeg',
      storage_path:path, url,
      uploaded_by_name:currentUser.name,
      created:Date.now(),
      photo_slot:slot,
      photo_role:role
    }});
    toast(`✅ ${seqLabel} uploaded`,'success');
    // Reload job detail to refresh grid
    openJob(currentJob.id);
  }catch(e){
    toast(`❌ Upload failed: ${(e.message||'').slice(0,60)}`,'error');
  }
  _baPendingSlot = null;
  _baPendingRole = null;
}

export async function _deleteBAPhoto(attId, storagePath, e){
  e.stopPropagation();
  if(!confirm('Delete this photo?')) return;
  try{
    await sb(`attachments?id=eq.${attId}`,{method:'DELETE'});
    if(storagePath){
      fetch(`${SB_URL}/storage/v1/object/deepflow/${storagePath}`,{
        method:'DELETE', headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY}
      }).catch(()=>{});
    }
    toast('Photo deleted','warn');
    openJob(getCurrentJob().id);
  }catch(err){
    toast('Delete failed','error');
  }
}

// ══════════════════════════════════════════════════════════════
//  PHOTO UPLOAD — compress / HD / EXIF stamp
// ══════════════════════════════════════════════════════════════
export async function handleUpload(input,type){
  const files=Array.from(input.files);
  const currentJob=getCurrentJob(), currentUser=getCurrentUser();
  if(!files.length||!currentJob)return;
  input.value='';
  let ok=0;
  for(let i=0;i<files.length;i++){
    let file=files[i];
    toast(`⬆️ ${type==='photo'?'Processing':'Uploading'} ${i+1}/${files.length}…`,'info');
    try{
      if(type==='photo'){
        const exif=await _readExif(file);
        let captureTime=null;
        if(exif.dateTimeOriginal){
          try{
            const[dp,tp]=exif.dateTimeOriginal.split(' ');
            const[y,mo,d]=dp.split(':');
            captureTime=new Date(`${y}-${mo}-${d}T${tp}`);
            if(isNaN(captureTime))captureTime=null;
          }catch(e){}
        }
        // Compress unless HD mode (max 1200px width, quality 0.8)
        if(!getUploadHD()){file=await _compressImage(file,1200,0.8);}
        // Always stamp: use EXIF time if available, otherwise use current time
        const stampTime = captureTime || new Date();
        file=await _stampPhoto(file, currentJob.address||'', currentUser.name, stampTime);
      }
      const ext=file.name.split('.').pop()?.toLowerCase()||'jpg';
      // FIX 14: Path format is jobs/{jobId}/{timestamp}-{random}.{ext} — same as
      // _handleBAUpload. The only difference between standard and B/A photos is
      // the photo_slot and photo_role metadata fields on the attachment record,
      // NOT the storage path. Keep both functions using this same path format.
      const path=`jobs/${currentJob.id}/${Date.now()}-${Math.random().toString(36).slice(2,6)}.${ext}`;
      const url=await sbStorage(path,file);
      await sb('attachments',{method:'POST',body:{
        id:`att-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
        jobid:currentJob.id,name:file.name,type,
        mime:file.type||'application/octet-stream',
        storage_path:path,url,uploaded_by_name:currentUser.name,created:Date.now()
      }});
      ok++;
    }catch(e){toast(`❌ File ${i+1} failed: ${(e.message||'').slice(0,50)}`,'error');}
  }
  if(ok>0){
    toast(`✅ ${ok} ${type==='photo'?'photo':'doc'}${ok>1?'s':''} uploaded`,'success');
    openJob(currentJob.id);
  }
}

// Compress image to maxW/maxH at quality q
function _compressImage(file,maxW,q){
  return new Promise(resolve=>{
    const img=new Image();
    const u=URL.createObjectURL(file);
    img.onload=()=>{
      URL.revokeObjectURL(u);
      let{naturalWidth:w,naturalHeight:h}=img;
      const maxH=maxW; // square cap — both dimensions capped at maxW (e.g. 1200)
      if(w<=maxW&&h<=maxH){resolve(file);return;} // truly small image — no compression needed
      const scale=Math.min(maxW/w,maxH/h);
      const W=Math.round(w*scale),H=Math.round(h*scale);
      const c=document.createElement('canvas');c.width=W;c.height=H;
      c.getContext('2d').drawImage(img,0,0,W,H);
      c.toBlob(b=>{
        if(!b){resolve(file);return;}
        resolve(new File([b],file.name.replace(/\.(jpe?g|png|webp|heic)/i,'.jpg'),{type:'image/jpeg'}));
      },'image/jpeg',q);
    };
    img.onerror=()=>{
      URL.revokeObjectURL(u);
      if(/\.(heic|heif)$/i.test(file.name)) toast('ℹ️ HEIC photo — uploading original (no compression)','info',3000);
      resolve(file);
    };
    img.src=u;
  });
}

// EXIF reader
function _readExif(file){
  return new Promise(resolve=>{
    const r=new FileReader();
    r.onload=e=>{
      try{
        const buf=e.target.result;
        const v=new DataView(buf);
        if(v.getUint16(0)!==0xFFD8){resolve({});return;}
        let off=2;
        while(off<buf.byteLength-4){
          const mk=v.getUint16(off);off+=2;
          const sl=v.getUint16(off);
          if(mk===0xFFE1){resolve(_parseExif(v,off+2));return;}
          if((mk&0xFF00)!==0xFF00)break;
          off+=sl;
        }
      }catch(e){}
      resolve({});
    };
    r.onerror=()=>resolve({});
    r.readAsArrayBuffer(file.slice(0,131072));
  });
}

function _parseExif(v,s){
  try{
    const big=v.getUint16(s)===0x4D4D;
    const g16=o=>v.getUint16(s+o,!big);
    const g32=o=>v.getUint32(s+o,!big);
    const io=g32(4),cn=g16(io),ex={};
    for(let i=0;i<cn&&i<100;i++){
      const e=io+2+i*12,tag=g16(e),type=g16(e+2),val=g32(e+8);
      if(tag===0x9003&&type===2){
        let str='';for(let c=0;c<20&&(s+val+c)<v.byteLength;c++){const ch=v.getUint8(s+val+c);if(ch===0)break;str+=String.fromCharCode(ch);}
        ex.dateTimeOriginal=str.trim();
      }
      if(tag===0x8825){
        try{
          const gc=g16(val);let la,lr,lna,lnr;
          for(let g=0;g<gc&&g<20;g++){
            const ge=val+2+g*12,gt=g16(ge),gv=g32(ge+8);
            const rat=o=>{const n=v.getUint32(s+o,!big),d=v.getUint32(s+o+4,!big);return d?n/d:0;};
            if(gt===1)lr=String.fromCharCode(v.getUint8(s+gv));
            if(gt===2)la=[rat(gv),rat(gv+8),rat(gv+16)];
            if(gt===3)lnr=String.fromCharCode(v.getUint8(s+gv));
            if(gt===4)lna=[rat(gv),rat(gv+8),rat(gv+16)];
          }
          if(la&&lna){
            let lat=la[0]+la[1]/60+la[2]/3600,lng=lna[0]+lna[1]/60+lna[2]/3600;
            if(lr==='S')lat=-lat;if(lnr==='W')lng=-lng;
            ex.gpsLat=lat;ex.gpsLng=lng;
          }
        }catch(e){}
      }
    }
    return ex;
  }catch(e){return{};}
}

// Photo stamp — single line footer, 30% bg, only on EXIF capture time
function _stampPhoto(file,jobAddress,engineerName,captureTime,seqLabel){
  return new Promise(resolve=>{
    const img=new Image();
    const u=URL.createObjectURL(file);
    img.onload=()=>{
      URL.revokeObjectURL(u);
      const W=img.naturalWidth,H=img.naturalHeight;
      const c=document.createElement('canvas');c.width=W;c.height=H;
      const ctx=c.getContext('2d');

      // 1. Draw original photo
      ctx.drawImage(img,0,0);

      // ── Compact lower-left corner stamp ──
      // Small pill, 8% white bg, small text, doesn't obscure the photo

      const m = W * 0.03;
      // Stamp dimensions — max 35% of image width, height scales with width
      const stampW = Math.min(W * 0.52, 520);
      const fBase  = Math.max(14, Math.round(W * 0.022)); // base font size
      const lineH  = fBase * 1.5;
      const pad    = fBase * 0.7;
      const lines  = [];
      if(jobAddress) lines.push((jobAddress.length>38 ? jobAddress.slice(0,36)+'…' : jobAddress));
      const ts = captureTime.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})
                +' '+captureTime.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
      lines.push(ts + '  ·  ' + engineerName + (seqLabel?' · '+seqLabel:''));

      const stampH = pad*2 + lines.length * lineH;
      const stampX = m;
      const stampY = H - stampH - m;
      const rr     = Math.min(fBase*0.6, 10);

      // 8% semi-transparent dark background
      ctx.save();
      ctx.beginPath();
      if(ctx.roundRect){ ctx.roundRect(stampX, stampY, stampW, stampH, rr); }
      else {
        ctx.moveTo(stampX+rr,stampY);ctx.lineTo(stampX+stampW-rr,stampY);
        ctx.quadraticCurveTo(stampX+stampW,stampY,stampX+stampW,stampY+rr);
        ctx.lineTo(stampX+stampW,stampY+stampH-rr);
        ctx.quadraticCurveTo(stampX+stampW,stampY+stampH,stampX+stampW-rr,stampY+stampH);
        ctx.lineTo(stampX+rr,stampY+stampH);
        ctx.quadraticCurveTo(stampX,stampY+stampH,stampX,stampY+stampH-rr);
        ctx.lineTo(stampX,stampY+rr);
        ctx.quadraticCurveTo(stampX,stampY,stampX+rr,stampY);
        ctx.closePath();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.09)';
      ctx.fill();
      // Thin white border
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = Math.max(1, W*0.001);
      ctx.stroke();
      ctx.restore();

      // Left accent line
      ctx.save();
      ctx.fillStyle = '#4f8fff';
      ctx.beginPath();
      if(ctx.roundRect) ctx.roundRect(stampX+pad*0.3, stampY+pad*0.6, Math.max(2,W*0.004), stampH-pad*1.2, 2);
      ctx.fill();
      ctx.restore();

      // Text
      ctx.save();
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      const textX = stampX + pad*0.3 + W*0.004 + pad*0.5;
      lines.forEach((line,i)=>{
        if(i===0){
          ctx.font = `700 ${fBase}px Arial,sans-serif`;
          ctx.fillStyle = 'rgba(255,255,255,0.97)';
        } else {
          ctx.font = `400 ${Math.round(fBase*0.82)}px Arial,sans-serif`;
          ctx.fillStyle = 'rgba(255,255,255,0.80)';
        }
        ctx.fillText(line, textX, stampY + pad + i*lineH);
      });
      ctx.restore();

      c.toBlob(b=>{
        if(!b){resolve(file);return;}
        resolve(new File([b],file.name.replace(/\.(jpe?g|png|webp|heic|heif)$/i,'')+'_stamped.jpg',{type:'image/jpeg'}));
      },'image/jpeg',getUploadHD()?0.95:0.90);
    };
    img.onerror=()=>{URL.revokeObjectURL(u);resolve(file);};
    img.src=u;
  });
}
