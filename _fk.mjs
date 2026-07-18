import { createClient } from '@supabase/supabase-js';
const sb=createClient('https://maqccclmigrbdjnotjty.supabase.co','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1hcWNjY2xtaWdyYmRqbm90anR5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDYzMTA3MiwiZXhwIjoyMDkwMjA3MDcyfQ.crSfxwqG7_CNmgyBRVRFzdsryo9LlX6tBT4rPICgILo');
// Try inserting a time_entry with a non-users uuid inside a quick probe, then delete. Safe: use Built org.
const tid='7e000000-0000-0000-0000-0000000000ff';
const {error}=await sb.from('time_entries').insert({id:tid,org_id:'85b67e22-ebf4-4d78-94e8-3b1c73ca702f',user_id:'84e45323-df83-461d-b8b1-520e18cac2a3',project_id:'76ad35a7-a817-4f21-8f13-53ea10513865',employee_type:'builder',duration_minutes:1});
console.log('insert error:', error? error.message : 'NONE (user_id has no FK)');
if(!error){await sb.from('time_entries').delete().eq('id',tid);console.log('cleaned up probe row');}
