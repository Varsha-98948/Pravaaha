import { createClient } from '@supabase/supabase-js'
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
import { ConfigurationError } from './errors'

export const isDemoMode = !url || !key
export const supabase = isDemoMode ? null : createClient(url!, key!)

export function getSupabaseClient() {
  if (isDemoMode || !supabase) {
    throw new ConfigurationError('Supabase client is not configured. Running in demo mode.')
  }
  return supabase
}

