/**
 * OpenRouter Key Management and Rotation Service.
 *
 * Manages three independent API key slots corresponding to three separate
 * OpenRouter accounts. Provides concurrency-safe round-robin selection,
 * failure classification, cooldown management, and safe observability.
 *
 * Secret API keys are strictly kept on the backend and never exposed
 * to the client bundle or logs.
 */

export type KeySlotId = 'key-1' | 'key-2' | 'key-3'

export type KeyHealthStatus =
  | 'healthy'
  | 'cooling_down'
  | 'rate_limited'
  | 'credit_exhausted'
  | 'auth_failed'
  | 'unconfigured'

export type FailureCategory =
  | 'credit_exhausted'
  | 'rate_limited'
  | 'auth_failed'
  | 'transient'
  | 'invalid_request'
  | 'unknown'

export interface KeySlotState {
  id: KeySlotId
  envVar: string
  key: string
  configured: boolean
  status: KeyHealthStatus
  cooldownUntil: number | null
  lastSuccessAt: number | null
  lastFailureAt: number | null
  lastFailureCategory: FailureCategory | null
  consecutiveFailures: number
  totalRequests: number
  totalSuccesses: number
}

export interface KeySlotPublicInfo {
  id: KeySlotId
  envVar: string
  configured: boolean
  status: KeyHealthStatus
  cooldownUntil: number | null
  lastSuccessAt: number | null
  lastFailureAt: number | null
  lastFailureCategory: FailureCategory | null
  consecutiveFailures: number
  totalRequests: number
  totalSuccesses: number
}

export interface FailureDetails {
  category: FailureCategory
  retryAfterMs?: number
  message?: string
}

export interface PublicKeyManagerStatus {
  configuredCount: number
  healthyCount: number
  allExhaustedReason: string | null
  slots: KeySlotPublicInfo[]
}

const SLOT_ENV_VARS: Record<KeySlotId, string[]> = {
  'key-1': ['OPENROUTER_API_KEY_1', 'OPENROUTER_API_KEY'],
  'key-2': ['OPENROUTER_API_KEY_2'],
  'key-3': ['OPENROUTER_API_KEY_3'],
}

/**
 * Mask an API key string for safe diagnostics (never displays the full secret).
 */
export function maskApiKey(key: string): string {
  if (!key) return ''
  const trimmed = key.trim()
  if (trimmed.length <= 8) return '[REDACTED]'
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`
}

export class OpenRouterKeyManager {
  private slots: Map<KeySlotId, KeySlotState> = new Map()
  private rotationIndex = 0

  constructor(env: Record<string, string | undefined> = {}) {
    this.initFromEnv(env)
  }

  /**
   * Initializes or updates key slots from environment variables.
   */
  public initFromEnv(env: Record<string, string | undefined>): void {
    const slotIds: KeySlotId[] = ['key-1', 'key-2', 'key-3']

    for (const slotId of slotIds) {
      let keyVal = ''
      const candidates = SLOT_ENV_VARS[slotId]

      for (const envVar of candidates) {
        const val = env[envVar]?.trim()
        if (val) {
          keyVal = val
          break
        }
      }

      // Slot 1 fallback: check AI_API_KEY if AI_PROVIDER is openrouter
      if (!keyVal && slotId === 'key-1' && env.AI_PROVIDER?.trim().toLowerCase() === 'openrouter') {
        const genericKey = env.AI_API_KEY?.trim()
        if (genericKey) keyVal = genericKey
      }

      const configured = Boolean(keyVal && keyVal.length > 0)

      const existing = this.slots.get(slotId)
      if (existing) {
        // If key changed, update it and reset status
        if (existing.key !== keyVal) {
          existing.key = keyVal
          existing.configured = configured
          existing.status = configured ? 'healthy' : 'unconfigured'
          existing.cooldownUntil = null
          existing.consecutiveFailures = 0
          existing.lastFailureCategory = null
        }
      } else {
        this.slots.set(slotId, {
          id: slotId,
          envVar: candidates[0],
          key: keyVal,
          configured,
          status: configured ? 'healthy' : 'unconfigured',
          cooldownUntil: null,
          lastSuccessAt: null,
          lastFailureAt: null,
          lastFailureCategory: null,
          consecutiveFailures: 0,
          totalRequests: 0,
          totalSuccesses: 0,
        })
      }
    }
  }

  /**
   * Checks whether a key is currently eligible to serve requests.
   * Automatically clears temporary cooldowns whose timer has expired.
   */
  private checkAndUpdateSlotHealth(slot: KeySlotState, now: number): boolean {
    if (!slot.configured) return false

    // Permanent disqualifications (until reload or administrative reset)
    if (slot.status === 'credit_exhausted' || slot.status === 'auth_failed') {
      return false
    }

    // Temporary cooldowns (rate limit or transient server failure)
    if (slot.status === 'rate_limited' || slot.status === 'cooling_down') {
      if (slot.cooldownUntil !== null && now >= slot.cooldownUntil) {
        // Cooldown has expired: recover to healthy
        slot.status = 'healthy'
        slot.cooldownUntil = null
        return true
      }
      return false
    }

    return slot.status === 'healthy'
  }

  /**
   * Returns the count of configured key slots.
   */
  public getConfiguredCount(): number {
    let count = 0
    for (const slot of this.slots.values()) {
      if (slot.configured) count++
    }
    return count
  }

  /**
   * Concurrency-safe round-robin selection among healthy/eligible keys.
   *
   * @param excludeSlotIds Optional set of slot IDs already attempted in the current request.
   */
  public getNextEligibleSlot(excludeSlotIds: Set<KeySlotId> = new Set()): KeySlotState | null {
    const now = Date.now()
    const slotIds: KeySlotId[] = ['key-1', 'key-2', 'key-3']

    // Refresh health for all slots
    for (const id of slotIds) {
      const slot = this.slots.get(id)
      if (slot) this.checkAndUpdateSlotHealth(slot, now)
    }

    // Starting from rotationIndex, search for the next eligible slot in ring-buffer order
    for (let offset = 0; offset < slotIds.length; offset++) {
      const idx = (this.rotationIndex + offset) % slotIds.length
      const id = slotIds[idx]
      const slot = this.slots.get(id)
      if (!slot) continue
      if (excludeSlotIds.has(id)) continue

      if (this.checkAndUpdateSlotHealth(slot, now)) {
        // Advance rotation index for the subsequent call
        this.rotationIndex = (idx + 1) % slotIds.length
        return slot
      }
    }

    return null
  }

  /**
   * Records a successful request for the given key slot.
   */
  public recordSuccess(slotId: KeySlotId): void {
    const slot = this.slots.get(slotId)
    if (!slot) return

    slot.status = 'healthy'
    slot.cooldownUntil = null
    slot.consecutiveFailures = 0
    slot.lastSuccessAt = Date.now()
    slot.totalSuccesses++
    slot.totalRequests++
  }

  /**
   * Records a failure for the given key slot according to its failure category.
   */
  public recordFailure(slotId: KeySlotId, failure: FailureDetails): void {
    const slot = this.slots.get(slotId)
    if (!slot) return

    slot.totalRequests++
    slot.consecutiveFailures++
    slot.lastFailureAt = Date.now()
    slot.lastFailureCategory = failure.category

    const now = Date.now()

    switch (failure.category) {
      case 'credit_exhausted':
        // Confirmed account balance exhaustion or billing restriction.
        // Cannot auto-recover with a short timer; remains disabled until explicit reset/reconfig.
        slot.status = 'credit_exhausted'
        slot.cooldownUntil = null
        break

      case 'auth_failed':
        // Invalid, revoked, or unauthorized key. Permanent until credential replacement.
        slot.status = 'auth_failed'
        slot.cooldownUntil = null
        break

      case 'rate_limited': {
        // Rate limit reached (HTTP 429). Apply Retry-After or default 30s cooldown.
        const cooldownMs = failure.retryAfterMs && failure.retryAfterMs > 0 ? failure.retryAfterMs : 30_000
        slot.status = 'rate_limited'
        slot.cooldownUntil = now + cooldownMs
        break
      }

      case 'transient': {
        // Temporary 5xx or network timeout. Apply short cooldown (5s).
        const cooldownMs = failure.retryAfterMs && failure.retryAfterMs > 0 ? failure.retryAfterMs : 5_000
        slot.status = 'cooling_down'
        slot.cooldownUntil = now + cooldownMs
        break
      }

      case 'invalid_request':
        // Request syntax/prompt/model error — NOT a key health problem.
        // Do not alter key health status.
        break

      default:
        // Unknown or unexpected failure — temporary cooldown.
        slot.status = 'cooling_down'
        slot.cooldownUntil = now + 5_000
        break
    }
  }

  /**
   * Resets a specific key slot back to healthy.
   */
  public resetSlot(slotId: KeySlotId): void {
    const slot = this.slots.get(slotId)
    if (!slot) return
    if (slot.configured) {
      slot.status = 'healthy'
      slot.cooldownUntil = null
      slot.consecutiveFailures = 0
      slot.lastFailureCategory = null
    }
  }

  /**
   * Resets all configured key slots back to healthy.
   */
  public resetAll(): void {
    for (const slot of this.slots.values()) {
      if (slot.configured) {
        slot.status = 'healthy'
        slot.cooldownUntil = null
        slot.consecutiveFailures = 0
        slot.lastFailureCategory = null
      }
    }
  }

  /**
   * Returns safe operational status metadata for health checks.
   * Never exposes raw secret keys.
   */
  public getPublicStatus(): PublicKeyManagerStatus {
    const now = Date.now()
    const slotList: KeySlotPublicInfo[] = []
    let configuredCount = 0
    let healthyCount = 0

    let creditExhaustedCount = 0
    let authFailedCount = 0
    let rateLimitedCount = 0

    const slotIds: KeySlotId[] = ['key-1', 'key-2', 'key-3']
    for (const id of slotIds) {
      const slot = this.slots.get(id)
      if (!slot) continue

      if (slot.configured) {
        configuredCount++
        if (this.checkAndUpdateSlotHealth(slot, now)) {
          healthyCount++
        } else {
          if (slot.status === 'credit_exhausted') creditExhaustedCount++
          else if (slot.status === 'auth_failed') authFailedCount++
          else if (slot.status === 'rate_limited') rateLimitedCount++
        }
      }

      slotList.push({
        id: slot.id,
        envVar: slot.envVar,
        configured: slot.configured,
        status: slot.status,
        cooldownUntil: slot.cooldownUntil,
        lastSuccessAt: slot.lastSuccessAt,
        lastFailureAt: slot.lastFailureAt,
        lastFailureCategory: slot.lastFailureCategory,
        consecutiveFailures: slot.consecutiveFailures,
        totalRequests: slot.totalRequests,
        totalSuccesses: slot.totalSuccesses,
      })
    }

    let allExhaustedReason: string | null = null
    if (configuredCount === 0) {
      allExhaustedReason = 'no_keys_configured'
    } else if (healthyCount === 0) {
      if (creditExhaustedCount === configuredCount) {
        allExhaustedReason = 'all_keys_credit_exhausted'
      } else if (authFailedCount === configuredCount) {
        allExhaustedReason = 'all_keys_auth_failed'
      } else if (rateLimitedCount === configuredCount) {
        allExhaustedReason = 'all_keys_rate_limited'
      } else {
        allExhaustedReason = 'all_keys_unavailable'
      }
    }

    return {
      configuredCount,
      healthyCount,
      allExhaustedReason,
      slots: slotList,
    }
  }

  /**
   * Sanitizes an error message or log string by replacing any configured API keys
   * or authorization headers with redacting markers.
   */
  public sanitize(text: string): string {
    if (!text) return ''
    let result = text

    // Redact Bearer tokens
    result = result.replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, 'Bearer [REDACTED]')

    // Redact known configured keys
    for (const slot of this.slots.values()) {
      if (slot.key && slot.key.length >= 6) {
        result = result.split(slot.key).join(`[REDACTED_${slot.id.toUpperCase()}]`)
      }
    }

    // Redact OpenRouter key patterns: sk-or-v1-...
    result = result.replace(/sk-or-v1-[a-zA-Z0-9]{16,}/gi, '[REDACTED_OPENROUTER_KEY]')

    return result
  }
}

// Global process-level singleton instance for persistent server lifecycle
let globalKeyManagerInstance: OpenRouterKeyManager | null = null

export function getGlobalOpenRouterKeyManager(
  env?: Record<string, string | undefined>
): OpenRouterKeyManager {
  if (!globalKeyManagerInstance) {
    const g = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }
    const sysEnv = (typeof g.process !== 'undefined' && g.process.env) ? g.process.env : {}
    globalKeyManagerInstance = new OpenRouterKeyManager(env || sysEnv)
  } else if (env) {
    globalKeyManagerInstance.initFromEnv(env)
  }
  return globalKeyManagerInstance
}
