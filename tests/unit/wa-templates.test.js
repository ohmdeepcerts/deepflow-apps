// WhatsApp message-template tests, written before extraction. Pins
// main.js's buildJobWAMsg/_fillWaTpl behavior exactly.
import { describe, it, expect } from 'vitest';
import { buildJobWhatsAppMessage, fillTemplate } from '../../packages/business/wa-templates.js';

describe('fillTemplate', () => {
  it('replaces every {var} placeholder with the matching value', () => {
    expect(fillTemplate('Hi {name}, your job is {status}.', { name: 'Bob', status: 'Done' }))
      .toBe('Hi Bob, your job is Done.');
  });

  it('leaves a placeholder with no matching var untouched', () => {
    expect(fillTemplate('Hi {name}, {unknown}', { name: 'Bob' })).toBe('Hi Bob, {unknown}');
  });

  it('replaces every occurrence of a repeated placeholder', () => {
    expect(fillTemplate('{x} and {x}', { x: 'A' })).toBe('A and A');
  });
});

describe('buildJobWhatsAppMessage', () => {
  const job1 = { timeSlot: '9-11am', address: '12 High St', referrer: 'Bob', description: 'EICR', access: 'Key box', contact: '07700900000', notes: 'ring bell' };
  const job2 = { timeSlot: '1-3pm', address: '5 Low Rd', referrer: 'Alice', description: 'PAT test' };

  it('with no custom template, builds the default dispatch message', () => {
    const msg = buildJobWhatsAppMessage([job1], 'Izhar', '', 'DeepFlow Ltd');
    expect(msg).toContain('*DeepFlow Ltd* 📋');
    expect(msg).toContain('Hi *Izhar*');
    expect(msg).toContain('*1st Job — 9-11am*');
    expect(msg).toContain('📍 *Address:* 12 High St');
    expect(msg).toContain('🔑 *Access:* Key box');
    expect(msg).toContain('👤 *Contact:* 07700900000');
    expect(msg).toContain('✅ Please confirm receipt.');
  });

  it('falls back to "Job Dispatch" as the header when no company name is set', () => {
    const msg = buildJobWhatsAppMessage([job1], 'Izhar', '', '');
    expect(msg).toContain('*Job Dispatch* 📋');
  });

  it('omits the Access/Contact lines entirely when a job has neither', () => {
    const msg = buildJobWhatsAppMessage([job2], 'Izhar', '', 'DeepFlow Ltd');
    expect(msg).not.toContain('🔑 *Access:*');
    expect(msg).not.toContain('👤 *Contact:*');
  });

  it('numbers multiple jobs with ordinals and separates them with a divider', () => {
    const msg = buildJobWhatsAppMessage([job1, job2], 'Izhar', '', 'DeepFlow Ltd');
    expect(msg).toContain('*1st Job — 9-11am*');
    expect(msg).toContain('*2nd Job — 1-3pm*');
    expect(msg).toContain('─────────────────');
  });

  it('past the 10th ordinal falls back to "Nth" numbering', () => {
    const jobs = Array.from({ length: 11 }, (_, i) => ({ ...job1, timeSlot: `slot${i}` }));
    const msg = buildJobWhatsAppMessage(jobs, 'Izhar', '', 'DeepFlow Ltd');
    expect(msg).toContain('*11th Job — slot10*');
  });

  it('with a custom template containing {jobs_list}, substitutes company/engineer/jobs into it instead of using the default format', () => {
    const tpl = 'Custom header for {company_name} / {engineer_name}:\n{jobs_list}\nEnd.';
    const msg = buildJobWhatsAppMessage([job1], 'Izhar', tpl, 'DeepFlow Ltd');
    expect(msg).toContain('Custom header for DeepFlow Ltd / Izhar:');
    expect(msg).toContain('*1st Job — 9-11am*');
    expect(msg).toContain('End.');
    expect(msg).not.toContain('✅ Please confirm receipt.');
  });

  it('a custom template without {jobs_list} is ignored — falls back to the default format', () => {
    const tpl = 'No placeholder here';
    const msg = buildJobWhatsAppMessage([job1], 'Izhar', tpl, 'DeepFlow Ltd');
    expect(msg).toContain('✅ Please confirm receipt.');
  });
});
