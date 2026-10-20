import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  '';

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl !== 'https://your-project-ref.supabase.co' &&
  !supabaseUrl.includes('your-project')
);

// Fallback dummy URL to prevent createClient throwing an invalid URL error when unconfigured
const clientUrl = isSupabaseConfigured ? supabaseUrl : 'https://placeholder.supabase.co';
const clientKey = isSupabaseConfigured ? supabaseAnonKey : 'placeholder-anon-key';

export const supabase: SupabaseClient = createClient(clientUrl, clientKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

export async function checkSupabaseConnection(): Promise<{
  connected: boolean;
  latencyMs?: number;
  error?: string;
}> {
  if (!isSupabaseConfigured) {
    return {
      connected: false,
      error: 'Supabase credentials not configured in .env (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)',
    };
  }

  const start = performance.now();
  try {
    const { error } = await supabase.from('branches').select('id').limit(1);
    const latencyMs = Math.round(performance.now() - start);

    if (error) {
      return { connected: false, error: error.message, latencyMs };
    }
    return { connected: true, latencyMs };
  } catch (err) {
    return {
      connected: false,
      error: err instanceof Error ? err.message : 'Unknown connection error',
    };
  }
}
