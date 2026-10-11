/**
 * Authentication and Profile Service.
 * Verifies Supabase authentication sessions and loads organization-scoped user profiles.
 * Never trusts client-supplied identifiers or roles.
 */

import type { UserProfile, Role } from '../types'
import { getSupabaseClient } from './supabase'
import {
  AuthenticationError,
  AuthorizationError,
  DatabaseError,
  NotFoundError,
  ValidationError,
} from './errors'
import { dbToUserProfile, type DbProfileRow } from './mappers'

export interface AuthService {
  getCurrentUserProfile(): Promise<UserProfile>
  getProfileById(userId: string): Promise<UserProfile>
  requireRole(user: UserProfile, allowedRoles: Role[]): void
  canPerformOperations(user: UserProfile): boolean
  canAdministerRoles(user: UserProfile): boolean
}

/**
 * Loads the currently authenticated user's profile from Supabase Auth + profiles table.
 * Throws ConfigurationError if Supabase is not configured (demo mode).
 * Throws AuthenticationError if no active auth session exists.
 * Throws NotFoundError if the profile record does not exist.
 * Throws DatabaseError on query failure.
 */
export async function getCurrentUserProfile(): Promise<UserProfile> {
  const client = getSupabaseClient()

  // 1. Verify authenticated user identity via Supabase Auth
  const { data: authData, error: authError } = await client.auth.getUser()

  if (authError || !authData?.user) {
    throw new AuthenticationError(
      authError ? `Failed to verify user session: ${authError.message}` : 'No active authenticated user session.'
    )
  }

  const authUser = authData.user

  // 2. Fetch the corresponding profile strictly using the verified auth.uid()
  const { data: profileRow, error: profileError } = await client
    .from('profiles')
    .select('id, org_id, name, email, role')
    .eq('id', authUser.id)
    .single()

  if (profileError) {
    if (profileError.code === 'PGRST116') {
      throw new NotFoundError('UserProfile', authUser.id)
    }
    throw new DatabaseError(`Database error loading user profile: ${profileError.message}`, profileError)
  }

  if (!profileRow) {
    throw new NotFoundError('UserProfile', authUser.id)
  }

  // 3. Map to domain contract with email fallback from auth user
  return dbToUserProfile(profileRow as DbProfileRow, authUser.email)
}

/**
 * Fetch a profile by explicit user ID within the database.
 * Relies on database RLS to ensure the caller can only read profiles in their org.
 */
export async function getProfileById(userId: string): Promise<UserProfile> {
  if (!userId || typeof userId !== 'string') {
    throw new ValidationError('A valid userId is required.')
  }

  const client = getSupabaseClient()
  const { data: profileRow, error } = await client
    .from('profiles')
    .select('id, org_id, name, email, role')
    .eq('id', userId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      throw new NotFoundError('UserProfile', userId)
    }
    throw new DatabaseError(`Database error loading profile: ${error.message}`, error)
  }

  return dbToUserProfile(profileRow as DbProfileRow)
}

/**
 * Validates that the user has one of the allowed roles.
 * Throws AuthorizationError if unauthorized.
 */
export function requireRole(user: UserProfile, allowedRoles: Role[]): void {
  if (!user || !user.role) {
    throw new AuthorizationError('Missing user or user role for authorization check.')
  }

  if (!allowedRoles.includes(user.role)) {
    throw new AuthorizationError(
      `Role '${user.role}' is not authorized. Required: ${allowedRoles.join(', ')}.`
    )
  }
}

/**
 * Operational writes (disruptions, deliveries, vehicle changes, plans) are permitted
 * only for administrators and dispatchers. Viewers are read-only.
 */
export function canPerformOperations(user: UserProfile): boolean {
  return user.role === 'admin' || user.role === 'dispatcher'
}

/**
 * Role management and profile modifications are restricted exclusively to administrators.
 * Dispatchers cannot administer roles.
 */
export function canAdministerRoles(user: UserProfile): boolean {
  return user.role === 'admin'
}
