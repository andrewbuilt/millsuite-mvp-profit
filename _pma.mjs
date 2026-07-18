import { createClient } from '@supabase/supabase-js';
const sb=createClient('https://maqccclmigrbdjnotjty.supabase.co','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1hcWNjY2xtaWdyYmRqbm90anR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDYzMTA3MiwiZXhwIjoyMDkwMjA3MDcyfQ.crSfxwqG7_CNmgyBRVRFzdsryo9LlX6tBT4rPICgILo');
const ids=['9b000000-0000-0000-0000-000000000001','9b000000-0000-0000-0000-000000000002','9b000000-0000-0000-0000-000000000003'];
const {data}=await sb.from('project_month_allocations').select('id,project_id,month_date,hours_allocated,source').in('project_id',ids).order('month_date');
console.log('existing PMA rows for booked jobs:',JSON.stringify(data,null,0));
const {data:mine}=await sb.from('project_month_allocations').select('id').like('id','ab000000%');
console.log('my ab000000 rows present:',(mine||[]).length);
