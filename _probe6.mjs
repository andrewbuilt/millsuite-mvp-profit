import { createClient } from '@supabase/supabase-js';
const sb=createClient('https://maqccclmigrbdjnotjty.supabase.co','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1hcWNjY2xtaWdyYmRqbm90anR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDYzMTA3MiwiZXhwIjoyMDkwMjA3MDcyfQ.crSfxwqG7_CNmgyBRVRFzdsryo9LlX6tBT4rPICgILo');
const ORG='85b67e22-ebf4-4d78-94e8-3b1c73ca702f';
const PROJ='76ad35a7-a817-4f21-8f13-53ea10513865';      // existing Built project
const SUB='895fc56e-426d-4428-b7c8-0ec3a37f5e89';        // existing Built subproject
async function probe(tbl,row){
  const {error}=await sb.from(tbl).insert(row);
  console.log(`${tbl}: ${error? 'ERROR '+error.message : 'OK'}`);
  if(!error) await sb.from(tbl).delete().eq('id',row.id);
}
await probe('project_outcomes',{id:'d00c0000-0000-0000-0000-0000000000ff',org_id:ORG,project_id:PROJ,estimated_hours:100,estimated_materials:5000,estimated_price:20000,actual_hours:102,actual_labor_cost:8364,actual_materials:5100,actual_revenue:20000,actual_margin:6536,actual_margin_pct:32.7,hours_variance:2,hours_variance_pct:2,material_variance:100,material_variance_pct:2,shop_rate_at_completion:82,utilization_at_completion:78,headcount_at_completion:10,change_order_count:0,change_order_revenue:0,completed_at:'2026-06-01T16:00:00-07:00'});
await probe('estimate_lines',{id:'e1000000-0000-0000-0000-0000000000ff',subproject_id:SUB,sort_order:0,description:'probe',quantity:1,unit:'lot',dept_hour_overrides:{eng:1,cnc:2,assembly:3,finish:2,install:1}});
await probe('project_month_allocations',{id:'ab000000-0000-0000-0000-0000000000ff',org_id:ORG,project_id:PROJ,month_date:'2026-07-01',hours_allocated:100,department_hours:{},display_order:0,source:'manual'});
