// Guide — the in-app help screen: a static walkthrough of every feature
// plus a list of the third-party APIs the app calls. Extracted from
// main.js verbatim (Phase 5 of the architecture migration, Employee App
// module 5) — no behaviour changes. Pure DOM string building, zero
// shared state.

export function renderGuide(){
  const el=document.getElementById('guide-body');if(!el)return;
  const sections=[
    {icon:'📱',title:'How to Use This App',steps:[
      {n:1,t:'<strong>Today</strong> — your jobs, colour-coded by status. Tap any job to open.'},
      {n:2,t:'<strong>Upcoming</strong> — jobs in the next 7 days, grouped by date.'},
      {n:3,t:'<strong>Done</strong> — your last 60 completed jobs.'},
      {n:4,t:'<strong>Map</strong> — terrain map with job pins and driving route.'},
      {n:5,t:'<strong>Stats</strong> — personal dashboard with weather forecast.'},
      {n:6,t:'<strong>+</strong> button — report a new job or site issue to the office.'},
    ],tip:'Pull down on the Today screen to refresh jobs. Auto-refreshes every 45 seconds.'},
    {icon:'🎨',title:'Job Colour Codes',steps:[
      {n:1,t:'<span style="color:#f5a623">■</span> <strong>Amber</strong> — Pending (not started)'},
      {n:2,t:'<span style="color:#4f8fff">■</span> <strong>Blue</strong> — In Progress'},
      {n:3,t:'<span style="color:#22c55e">■</span> <strong>Green</strong> — Completed'},
      {n:4,t:'<span style="color:#f04444">■</span> <strong>Red</strong> — Emergency'},
      {n:5,t:'<span style="color:#f97316">■</span> <strong>Orange</strong> — No Access'},
    ]},
    {icon:'📷',title:'Photos & Auto-Stamp',steps:[
      {n:1,t:'Open job → Photos → <strong>Take Photo or Upload</strong>.'},
      {n:2,t:'Photos with EXIF capture time are stamped: job address · capture time · your name — single footer bar.'},
      {n:3,t:'GPS is validated — if photo was taken >5km from the job, address is omitted from stamp.'},
      {n:4,t:'No EXIF metadata = no stamp (no guessing).'},
      {n:5,t:'Choose <strong>Compressed</strong> for fast uploads or <strong>HD</strong> for full quality.'},
    ],tip:'Upload later in the evening — stamp shows original capture time from your phone camera.'},
    {icon:'⚡',title:'Quick Issue Notes',steps:[
      {n:1,t:'Open job → Notes → tap <strong>⚡ Quick Issues</strong>.'},
      {n:2,t:'Choose category: Electrical, Gas, Fire Alarm, Plumbing, General.'},
      {n:3,t:'Tick all issues found on site.'},
      {n:4,t:'Tap <strong>Add Selected Notes</strong> — lines are appended to your notes.'},
    ],tip:'Over 80 pre-written professional issue descriptions across 5 categories.'},
    {icon:'💬',title:'WhatsApp Integration',steps:[
      {n:1,t:'Every phone number has a WhatsApp button — tap to open a chat instantly.'},
      {n:2,t:'<strong>Share Job</strong> button sends job summary (address, trade, time) to any WhatsApp contact.'},
      {n:3,t:'<strong>Share Notes</strong> sends your job notes via WhatsApp.'},
      {n:4,t:'<strong>+ New Job</strong> sends a WhatsApp notification to the office automatically.'},
    ]},
    {icon:'📤',title:'Overtime & Leave',steps:[
      {n:1,t:'Go to <strong>Requests</strong> tab.'},
      {n:2,t:'Tap <strong>Request Overtime</strong> or <strong>Request Time Off</strong>.'},
      {n:3,t:'Office approves/rejects — you see the update and reply here.'},
    ]},
    {icon:'🔔',title:'Notifications',steps:[
      {n:1,t:'Allow notifications when prompted — you\'ll be asked once.'},
      {n:2,t:'Get an alert when a new job is assigned to you today.'},
      {n:3,t:'Tap the notification to open the job directly.'},
    ]},
  ];
  el.innerHTML=sections.map((s,i)=>`<div class="guide-section">
    <div class="guide-hd" onclick="toggleGuide(${i})" id="ghd-${i}"><div class="guide-hd-title"><span>${s.icon}</span> ${s.title}</div><span class="guide-chevron">▾</span></div>
    <div class="guide-body" id="gbody-${i}">
      ${s.steps.map(st=>`<div class="guide-step"><div class="guide-step-num">${st.n}</div><div class="guide-step-text">${st.t}</div></div>`).join('')}
      ${s.tip?`<div class="guide-tip">${s.tip}</div>`:''}
    </div>
  </div>`).join('');
  // API cards
  const apiEl=document.getElementById('guide-api-cards');if(!apiEl)return;
  const apis=[
    {icon:'🗺',title:'OpenTopoMap Terrain',status:'active',desc:'Terrain map tiles showing roads, elevation and landscape. Falls back to OpenStreetMap if unavailable. Free, no account.'},
    {icon:'📮',title:'Postcodes.io',status:'active',desc:'Instant UK postcode → coordinates. Primary geocoder, no rate limit, no account needed.'},
    {icon:'🛣',title:'OSRM Route Planning',status:'active',desc:'Driving route between today\'s jobs with total time and distance. Free, open source.'},
    {icon:'🌤',title:'Open-Meteo Weather',status:'active',desc:'Today\'s temperature, wind and rain shown on your dashboard. Updates with your real GPS. Free, no key.'},
    {icon:'🏠',title:'Land Registry',status:'active',desc:'Property type lookup by postcode shown in job details. Free UK government API.'},
    {icon:'📸',title:'EXIF + Photo Stamp',status:'active',desc:'Reads capture time from photo metadata. Stamps with address + time + engineer name in a footer bar. GPS verified.'},
    {icon:'📦',title:'Image Compression',status:'active',desc:'Compresses photos to ~1920px before upload for fast transfers. Toggle to HD for full resolution when needed.'},
    {icon:'💬',title:'WhatsApp Integration',status:'active',desc:'Tap-to-WA on every contact. Share job summaries and notes. + button notifies office via WhatsApp instantly.'},
    {icon:'🔔',title:'Push Notifications',status:'active',desc:'Browser notifications for new jobs. Fires when jobs are refreshed. Tap to open job directly.'},
    {icon:'📍',title:'Nominatim Fallback',status:'active',desc:'Full address geocoding when no postcode. OpenStreetMap\'s geocoder, 300ms rate limit.'},
  ];
  apiEl.innerHTML=apis.map(a=>`<div class="api-card">
    <div class="api-card-hd"><div class="api-icon">${a.icon}</div><div class="api-title">${a.title}</div><div class="api-status api-${a.status}">${a.status==='active'?'Active':'Soon'}</div></div>
    <div class="api-desc">${a.desc}</div>
  </div>`).join('');
}

export function toggleGuide(i){
  const hd=document.getElementById(`ghd-${i}`),body=document.getElementById(`gbody-${i}`);
  const open=body.classList.toggle('open');hd.classList.toggle('open',open);
}
