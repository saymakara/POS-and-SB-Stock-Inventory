import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { monitoredFetch } from '../utils/perfMonitor';

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
      eventsPerSecond: 25,
    },
  },
  global: {
    // (31 Oct 2026) times each request for Settings → System Health (nothing is sent anywhere)
    fetch: monitoredFetch,
    headers: {
      'x-client-info': 'pos-sb-inventory-fast/2.0',
    },
  },
});

// Pre-warm DNS + TLS handshake to the Supabase origin immediately on module load for faster ms ping
if (isSupabaseConfigured && typeof document !== 'undefined') {
  try {
    const origin = new URL(clientUrl).origin;
    const dnsLink = document.createElement('link');
    dnsLink.rel = 'dns-prefetch';
    dnsLink.href = origin;
    document.head.appendChild(dnsLink);

    const preconnectLink = document.createElement('link');
    preconnectLink.rel = 'preconnect';
    preconnectLink.href = origin;
    preconnectLink.crossOrigin = 'anonymous';
    document.head.appendChild(preconnectLink);
  } catch {
    // ignore URL parse errors
  }
}

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
    const { error } = await supabase.from('branches').select('id', { head: true, count: 'estimated' }).limit(1);
    const latencyMs = Math.max(1, Math.round(performance.now() - start));

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
