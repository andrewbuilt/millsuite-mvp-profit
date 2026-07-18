import { createClient } from '@supabase/supabase-js';
const sb=createClient('https://maqccclmigrbdjnotjty.supabase.co','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1hcWNjY2xtaWdyYmRqbm90anR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDYzMTA3MiwiZXhwIjoyMDkwMjA3MDcyfQ.crSfxwqG7_CNmgyBRVRFzdsryo9LlX6tBT4rPICgILo');
const ORG='85b67e22-ebf4-4d78-94e8-3b1c73ca702f';
const {data:inv}=await sb.from('client_invoices').select('invoice_number,status,total,project_id').eq('org_id',ORG);
console.log('Built invoices:',JSON.stringify(inv));
const {data:emp}=await sb.from('time_entries').select('employee_type').limit(200);
console.log('distinct employee_type used:',[...new Set((emp||[]).map(x=>x.employee_type))]);
const {data:sp}=await sb.from('subprojects').select('id,name,org_id,project_id,estimated_hours,estimated_price,price,labor_hours').eq('org_id',ORG);
console.log('Built subprojects:',JSON.stringify(sp));
