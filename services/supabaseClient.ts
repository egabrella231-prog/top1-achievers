
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://baudffalwkkqbktwcbgs.supabase.co';
const supabaseKey = 'sb_publishable_PO0uYQqoVOq8h629lEDfgw_6KQbyk04';

export const supabase = createClient(supabaseUrl, supabaseKey);
