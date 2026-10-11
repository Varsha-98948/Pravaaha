import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ConfigurationError } from './errors'

const rawUrl = (import.meta.env?.VITE_SUPABASE_URL as string | undefined)?.trim()
const rawKey = (import.meta.env?.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

export const isDemoMode = !rawUrl || !rawKey || rawUrl === '' || rawKey === ''

function initSupabaseClient(): SupabaseClient | null {
  if (isDemoMode) {
    return null
  }
  try {
    return createClient(rawUrl!, rawKey!)
  } catch (err) {
    console.warn('[Supabase] Initialization failed:', err)
    return null
  }
}

export const supabase: SupabaseClient | null = initSupabaseClient()

export function getSupabaseClient(): SupabaseClient {
  if (isDemoMode || !supabase) {
    throw new ConfigurationError('Supabase client is not configured. Running in demo mode.')
  }
  return supabase
}

export type SupabaseConnectivityStatus =
  | 'ok'
  | 'unconfigured'
  | 'network_error'
  | 'auth_error'
  | 'missing_table'
  | 'permission_denied'
  | 'error'

export interface SupabaseConnectivityResult {
  configured: boolean
  connected: boolean
  databaseAccess: boolean
  status: SupabaseConnectivityStatus
  table: string
  httpStatus?: number
  code?: string
  message: string
  details?: Record<string, unknown>
}

/**
 * Harmless connectivity and schema access check against an existing table
 * defined in migrations 001 and 002 (defaults to 'organizations').
 *
 * Strict read-only: performs a single SELECT id LIMIT 1.
 * Never inserts, updates, or deletes data.
 *
 * Distinguishes:
 * 1. Unconfigured client (demo mode)
 * 2. Network connectivity failure (host unreachable, DNS failure, fetch error)
 * 3. Network connected, but authentication error (invalid API key / JWT)
 * 4. Network connected, but missing table in schema cache (PGRST205 / 42P01)
 * 5. Network connected, but permission / RLS restriction (403 / 42501)
 * 6. Successful database access (HTTP 200, query executed without error)
 */
export async function checkSupabaseConnectivity(
  tableName: string = 'organizations',
  clientOverride?: SupabaseClient | null
): Promise<SupabaseConnectivityResult> {
  const client = clientOverride !== undefined ? clientOverride : supabase

  if (!client) {
    return {
      configured: false,
      connected: false,
      databaseAccess: false,
      status: 'unconfigured',
      table: tableName,
      message: 'Supabase client is not configured. Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.',
    }
  }

  try {
    const { data, error, status } = await client
      .from(tableName)
      .select('id')
      .limit(1)

    if (error) {
      const errorCode = error.code || ''
      const errorMessage = error.message || ''

      // 1. Missing table in schema (e.g. migration not applied)
      if (
        status === 404 ||
        errorCode === 'PGRST205' ||
        errorCode === '42P01' ||
        errorMessage.includes('schema cache') ||
        errorMessage.includes('does not exist')
      ) {
        return {
          configured: true,
          connected: true, // Network connectivity succeeded!
          databaseAccess: false, // Table missing from database schema
          status: 'missing_table',
          table: tableName,
          httpStatus: status,
          code: errorCode,
          message: `Table 'public.${tableName}' does not exist in schema cache: ${errorMessage}`,
        }
      }

      // 2. Authentication error (invalid anon key, bad JWT)
      if (
        status === 401 ||
        errorCode === 'PGRST301' ||
        errorMessage.toLowerCase().includes('jwt') ||
        errorMessage.toLowerCase().includes('api key')
      ) {
        return {
          configured: true,
          connected: true, // Network connectivity succeeded!
          databaseAccess: false,
          status: 'auth_error',
          table: tableName,
          httpStatus: status,
          code: errorCode,
          message: `Supabase authentication error: ${errorMessage}`,
        }
      }

      // 3. Permission or RLS restriction
      if (
        status === 403 ||
        errorCode === '42501' ||
        errorMessage.toLowerCase().includes('permission') ||
        errorMessage.toLowerCase().includes('policy')
      ) {
        return {
          configured: true,
          connected: true, // Network connectivity succeeded!
          databaseAccess: false,
          status: 'permission_denied',
          table: tableName,
          httpStatus: status,
          code: errorCode,
          message: `Database permission / RLS restriction on '${tableName}': ${errorMessage}`,
        }
      }

      // Other database error
      return {
        configured: true,
        connected: true, // Network connectivity succeeded!
        databaseAccess: false,
        status: 'error',
        table: tableName,
        httpStatus: status,
        code: errorCode,
        message: `Database error querying '${tableName}': ${errorMessage}`,
      }
    }

    // Success: harmless read returned status 200 without error
    return {
      configured: true,
      connected: true,
      databaseAccess: true,
      status: 'ok',
      table: tableName,
      httpStatus: status,
      message: `Successfully connected to Supabase and queried table '${tableName}'.`,
      details: {
        rowCount: Array.isArray(data) ? data.length : 0,
      },
    }
  } catch (err: unknown) {
    const errObj = err as Error
    return {
      configured: true,
      connected: false, // Network connectivity failed!
      databaseAccess: false,
      status: 'network_error',
      table: tableName,
      message: `Network connectivity failed when reaching Supabase: ${errObj?.message || 'Unknown network error'}`,
    }
  }
}


