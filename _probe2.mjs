import { createClient } from '@supabase/supabase-js';
const url='https://maqccclmigrbdjnotjty.supabase.co';
const key='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1hcWNjY2xtaWdyYmRqbm90anR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDYzMTA3MiwiZXhwIjoyMDkwMjA3MDcyfQ.crSfxwqG7_CNmgyBRVRFzdsryo9LlX6tBT4rPICgILo';
const sb=createClient(url,key);
const {data:orgs}=await sb.from('orgs').select('id,name,slug,owner_id,business_email,invoice_prefix,next_invoice_number,team_members,shop_rate,default_tax_pct,default_payment_terms_days');
console.log('=== ORGS ===');
for(const o of orgs){console.log(JSON.stringify({id:o.id,name:o.name,slug:o.slug,email:o.business_email,owner:o.owner_id,inv_prefix:o.invoice_prefix,next_inv:o.next_invoice_number,shop_rate:o.shop_rate,tax:o.default_tax_pct,terms:o.default_payment_terms_days,team_members:o.team_members}));}
const {data:users}=await sb.from('users').select('id,org_id,email,name,role,employee_type');
console.log('\n=== USERS ===');users.forEach(u=>console.log(JSON.stringify(u)));
const {data:deps}=await sb.from('departments').select('id,org_id,name,hours_per_day,default_crew_size,active,display_order');
console.log('\n=== DEPARTMENTS ===');deps.forEach(d=>console.log(JSON.stringify(d)));
console.log('\n=== COUNTS per table ===');
for(const t of ['projects','subprojects','clients','time_entries','client_invoices','client_invoice_line_items','department_allocations','capacity_overrides']){
  const {count}=await sb.from(t).select('*',{count:'exact',head:true});
  console.log(`  ${t}: ${count}`);
}
console.log('\n=== sample existing projects (stage values) ===');
const {data:pj}=await sb.from('projects').select('id,name,stage,org_id').limit(20);
pj.forEach(p=>console.log(JSON.stringify(p)));
console.log('\n=== distinct invoice statuses ===');
const {data:inv}=await sb.from('client_invoices').select('status').limit(50);
console.log([...new Set((inv||[]).map(i=>i.status))]);
