import { createClient } from '@supabase/supabase-js';
const sb=createClient('https://maqccclmigrbdjnotjty.supabase.co','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1hcWNjY2xtaWdyYmRqbm90anR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDYzMTA3MiwiZXhwIjoyMDkwMjA3MDcyfQ.crSfxwqG7_CNmgyBRVRFzdsryo9LlX6tBT4rPICgILo');
const ORG='85b67e22-ebf4-4d78-94e8-3b1c73ca702f';
const {data:deps}=await sb.from('departments').select('id,name,hours_per_day,default_crew_size,active,display_order').eq('org_id',ORG).order('display_order');
console.log('=== BUILT DEPARTMENTS ===');deps.forEach(d=>console.log(JSON.stringify(d)));
for(const t of ['projects','subprojects','clients','time_entries','client_invoices','department_allocations','capacity_overrides']){
  const {count}=await sb.from(t).select('*',{count:'exact',head:true}).eq('org_id',ORG);
  console.log(`count ${t} (Built): ${count}`);
}
const {data:pj}=await sb.from('projects').select('id,name,stage,client_name').eq('org_id',ORG);
console.log('=== BUILT PROJECTS ===');(pj||[]).forEach(p=>console.log(JSON.stringify(p)));
// distinct stages & statuses across ALL orgs to learn allowed values
const {data:allpj}=await sb.from('projects').select('stage');
console.log('distinct stages (all orgs):',[...new Set((allpj||[]).map(x=>x.stage))]);
const {data:allinv}=await sb.from('client_invoices').select('status');
console.log('distinct invoice statuses (all orgs):',[...new Set((allinv||[]).map(x=>x.status))]);
