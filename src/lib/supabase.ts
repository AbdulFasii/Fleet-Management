import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const metaEnv = (typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}) as Record<string, string | undefined>
const nodeEnv = (typeof process !== 'undefined' && process.env ? process.env : {}) as Record<string, string | undefined>

const supabaseUrl = (metaEnv.VITE_SUPABASE_URL || nodeEnv.VITE_SUPABASE_URL) as string | undefined
const supabaseAnonKey = (metaEnv.VITE_SUPABASE_ANON_KEY || nodeEnv.VITE_SUPABASE_ANON_KEY) as string | undefined
export const SUPABASE_BUCKET =
  ((metaEnv.VITE_SUPABASE_BUCKET || nodeEnv.VITE_SUPABASE_BUCKET) as string | undefined) || 'game-images'

export function isCloudImagesConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey && supabaseUrl.trim() !== '' && supabaseAnonKey.trim() !== '')
}

let _client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient | null {
  if (!isCloudImagesConfigured()) return null
  if (!_client && supabaseUrl && supabaseAnonKey) {
    _client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  }
  return _client
}
