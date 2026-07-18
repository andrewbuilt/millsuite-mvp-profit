import { createClient } from '@supabase/supabase-js';
const url='https://maqccclmigrbdjnotjty.supabase.co';
const key='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1hcWNjY2xtaWdyYmRqbm90anR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDYzMTA3MiwiZXhwIjoyMDkwMjA3MDcyfQ.crSfxwqG7_CNmgyBRVRFzdsryo9LlX6tBT4rPICgILo';
const sb=createClient(url,key);
// list all public tables by probing information_schema via a view? try direct table on each candidate.
const candidates=['organizations','orgs','org','profiles','users','clients','contacts','leads','projects','lead_subprojects','subprojects','time_entries','client_invoices','client_invoice_line_items','client_invoice_payments','capacity_overrides','department_allocations','departments','estimate_lines','change_orders'];
for(const t of candidates){
  const {data,error}=await sb.from(t).select('*').limit(1);
  if(error){console.log(`\n## ${t}: MISSING (${error.message})`);continue;}
  const row=data&&data[0];
  console.log(`\n## ${t}: exists`);
  if(row)console.log('  cols:',Object.keys(row).join(', '));
  else console.log('  (empty — cols unknown from data)');
}
