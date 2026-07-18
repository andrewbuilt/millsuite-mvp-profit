import { createClient } from '@supabase/supabase-js';
const sb=createClient('https://maqccclmigrbdjnotjty.supabase.co','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1hcWNjY2xtaWdyYmRqbm90anR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDYzMTA3MiwiZXhwIjoyMDkwMjA3MDcyfQ.crSfxwqG7_CNmgyBRVRFzdsryo9LlX6tBT4rPICgILo');
for(const t of ['project_outcomes','project_month_allocations','estimate_lines']){
  const {data,error}=await sb.from(t).select('*').limit(1);
  if(error){console.log(`## ${t}: ${error.message}`);continue;}
  console.log(`## ${t} cols:`, data&&data[0]?Object.keys(data[0]).join(', '):'(empty)');
  if(data&&data[0])console.log('   sample:',JSON.stringify(data[0]).slice(0,500));
}
