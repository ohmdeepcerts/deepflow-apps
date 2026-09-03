// WhatsApp message templating — the job-dispatch message builder and the
// generic {var} template filler used by the template-preview screen.
// Extracted from apps/office/main.js's buildJobWAMsg/_fillWaTpl verbatim
// (relocate, don't change) — `template`/`companyName` are now explicit
// parameters instead of closing over main.js's S.waJobTpl/S.coName, same
// pattern as officeVatRate(S).

export function fillTemplate(tpl, vars){
  return tpl.replace(/\{(\w+)\}/g, (m,k)=>vars[k]||m);
}

export function buildJobWhatsAppMessage(jobs, engName, template, companyName){
  const tpl = template || '';
  const jobLines = jobs.map((j,i)=>{
    const num = i+1;
    const ordinals=['1st','2nd','3rd','4th','5th','6th','7th','8th','9th','10th'];
    const ord = ordinals[i]||`${num}th`;
    // FIX 20: Access code and contact person are now on separate labelled lines.
    // Previously merged as "🔑 access · contact" which was ambiguous.
    const accessPart = j.access ? `\n🔑 *Access:* ${j.access}` : '';
    const contactPart = j.contact ? `\n👤 *Contact:* ${j.contact}` : '';
    return `*${ord} Job — ${j.timeSlot||'Time TBC'}*\n📍 *Address:* ${j.address}\n👤 *Referrer:* ${j.referrer||'—'}\n🔧 *Work:* ${j.description||'—'}${accessPart}${contactPart}\n📝 *Notes:* ${j.notes||'—'}`;
  }).join('\n\n─────────────────\n\n');

  if(tpl.includes('{jobs_list}')){
    return tpl
      .replace('{company_name}', companyName||'Your Company')
      .replace('{engineer_name}', engName)
      .replace('{jobs_list}', jobLines);
  }
  return `*${companyName||'Job Dispatch'}* 📋\n\nHi *${engName}*, here are your jobs for today:\n\n${jobLines}\n\n✅ Please confirm receipt.`;
}
