/**
 * OpenRouter Client with Strict Free-Only Model Policy and Automatic Failover.
 *
 * Implements:
 * 1. Strict Free-Only Model Verification: only catalog-verified zero-priced models.
 * 2. Automatic Failover across three independent account keys.
 * 3. Intelligent error classification (credit exhaustion, rate limits, auth failures, transient errors).
 * 4. Bounded retries: each eligible key attempted at most once per logical request.
 * 5. Safe structured logging without secret leakage.
 */

import {
  OpenRouterKeyManager,
  type FailureCategory,
  type KeySlotId,
} from './openrouterKeyManager'
import { extractJsonFromText } from './aiProvider'

export const DEFAULT_FREE_MODEL = 'apodex/apodex-1.1-mini:free'

export const DEFAULT_FREE_MODEL_ALLOWLIST = [
  'apodex/apodex-1.1-mini:free',
  'openrouter/free',
]

export const VERIFIED_FREE_MODEL_IDS = new Set(DEFAULT_FREE_MODEL_ALLOWLIST)

/**
 * Parses comma-separated allowlist of approved free models.
 */
export function parseFreeModelAllowlist(rawList?: string): string[] {
  if (!rawList || !rawList.trim()) {
    return [...DEFAULT_FREE_MODEL_ALLOWLIST]
  }
  const parts = rawList
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.length > 0 ? parts : [...DEFAULT_FREE_MODEL_ALLOWLIST]
}

/**
 * Strictly verifies whether a model ID is an approved free model.
 * Requirements:
 * 1. Model must be a non-empty string.
 * 2. Model must be explicitly included in the approved free-model allowlist.
 * 3. Model must be one of the model IDs whose zero prompt/completion pricing was
 *    verified from the OpenRouter model catalog.
 */
export function isApprovedFreeModel(model: string, allowlist: string[]): boolean {
  if (!model || typeof model !== 'string') return false
  const trimmed = model.trim()

  if (!allowlist.includes(trimmed)) return false
  if (!VERIFIED_FREE_MODEL_IDS.has(trimmed)) return false

  return true
}

export function getApprovedFreeModelSequence(model: string, allowlist: string[]): string[] {
  const seen = new Set<string>()
  const candidates = [model, ...allowlist].map((m) => m.trim()).filter(Boolean)
  return candidates.filter((candidate) => {
    if (seen.has(candidate)) return false
    seen.add(candidate)
    return isApprovedFreeModel(candidate, allowlist)
  })
}

export interface ClassifiedFailure {
  category: FailureCategory
  retryAfterMs?: number
  message: string
}

/**
 * Classifies an HTTP response or fetch error from OpenRouter.
 */
export function classifyOpenRouterResponse(
  status: number,
  bodyText: string,
  headers?: Headers | Record<string, string | null | undefined>
): ClassifiedFailure {
  const lowerBody = (bodyText || '').toLowerCase()

  const modelUnavailableKeywords = [
    'no endpoints found',
    'model not found',
    'no endpoint found',
    'no eligible endpoint',
    'no eligible inference endpoint',
    'model is unavailable',
    'unsupported model',
    'invalid model',
    'does not support feature',
    'unsupported parameter',
  ]
  const isModelUnavailable = modelUnavailableKeywords.some((kw) => lowerBody.includes(kw))

  if (status === 404 || (status === 400 && isModelUnavailable) || (status === 422 && isModelUnavailable)) {
    return {
      category: 'model_unavailable',
      message: `The configured free OpenRouter model is unavailable for this request (${status}).`,
    }
  }

  // Check for billing / credit exhaustion indicators in message regardless of status
  const creditKeywords = [
    'insufficient credits',
    'credit limit',
    'out of credits',
    'quota exceeded',
    'balance is too low',
    'billing restriction',
    'payment required',
    'credits exhausted',
    'requires credits',
  ]
  const isCreditRelated = creditKeywords.some((kw) => lowerBody.includes(kw))

  // 1. HTTP 402: Payment Required / Credit Exhaustion
  if (status === 402 || (status === 403 && isCreditRelated)) {
    return {
      category: 'credit_exhausted',
      message: 'OpenRouter account has exhausted credits or has a billing restriction.',
    }
  }

  // 2. HTTP 401: Unauthorized (Bad Key / Revoked)
  if (status === 401) {
    return {
      category: 'auth_failed',
      message: 'OpenRouter API key is invalid or unauthorized.',
    }
  }

  // 3. HTTP 403: Forbidden
  if (status === 403) {
    return {
      category: 'auth_failed',
      message: 'OpenRouter access forbidden. Check account permissions or API key validity.',
    }
  }

  // 4. HTTP 429: Rate Limited
  if (status === 429) {
    let retryAfterMs = 30_000 // default 30 seconds

    if (headers) {
      let retryHeader: string | null | undefined = null
      if (typeof (headers as Headers).get === 'function') {
        retryHeader = (headers as Headers).get('retry-after')
      } else {
        const h = headers as Record<string, string | null | undefined>
        retryHeader = h['retry-after'] || h['Retry-After']
      }

      if (retryHeader) {
        const sec = parseInt(retryHeader, 10)
        if (!isNaN(sec) && sec > 0) {
          retryAfterMs = sec * 1000
        } else {
          const dateMs = Date.parse(retryHeader)
          if (!isNaN(dateMs) && dateMs > Date.now()) {
            retryAfterMs = dateMs - Date.now()
          }
        }
      }
    }

    return {
      category: 'rate_limited',
      retryAfterMs,
      message: `OpenRouter rate limit reached. Retry after ${Math.round(retryAfterMs / 1000)}s.`,
    }
  }

  // 5. HTTP 400 or 422: Invalid Request (bad schema, invalid parameters, unsupported prompt)
  // Not a key problem; must not rotate keys or mark healthy keys unhealthy.
  if (status === 400 || status === 422) {
    return {
      category: 'invalid_request',
      message: `OpenRouter rejected request (${status}): ${bodyText || 'Bad Request'}`,
    }
  }

  // 6. Upstream Server Errors (HTTP 500, 502, 503, 504)
  if (status >= 500) {
    return {
      category: 'transient',
      retryAfterMs: 5_000,
      message: `OpenRouter upstream server error (${status}).`,
    }
  }

  // If credit related keyword was found in any other status code
  if (isCreditRelated) {
    return {
      category: 'credit_exhausted',
      message: 'OpenRouter account has exhausted credits or has a billing restriction.',
    }
  }

  return {
    category: 'unknown',
    retryAfterMs: 5_000,
    message: `OpenRouter returned unexpected status ${status}: ${bodyText}`,
  }
}

export interface ExecuteOpenRouterParams {
  systemPrompt: string
  userPrompt: string
  model: string
  allowlist?: string[]
  keyManager: OpenRouterKeyManager
  endpoint?: string
  timeoutMs?: number
  fetchFn?: typeof fetch
  paidFallbackEnabled?: boolean
}

export class OpenRouterModelUnavailableError extends Error {
  constructor(
    message: string,
    public readonly unavailableModels: string[]
  ) {
    super(message)
    this.name = 'OpenRouterModelUnavailableError'
  }
}

/**
 * Executes an AI interpretation request with OpenRouter using strictly free models
 * and automatic failover across configured key slots.
 */
export async function executeOpenRouterRequestWithFailover(
  params: ExecuteOpenRouterParams
): Promise<Record<string, unknown>> {
  const {
    systemPrompt,
    userPrompt,
    model,
    allowlist = DEFAULT_FREE_MODEL_ALLOWLIST,
    keyManager,
    endpoint = 'https://openrouter.ai/api/v1/chat/completions',
    timeoutMs = 15_000,
    paidFallbackEnabled = false,
  } = params

  const fetchImpl = params.fetchFn || globalThis.fetch

  // 1. Strict Free-Only Enforcement Safeguard
  if (paidFallbackEnabled) {
    throw new Error(
      'Security Policy Violation: OPENROUTER_PAID_FALLBACK_ENABLED is prohibited. Only free models may be used.'
    )
  }

  const approvedModels = getApprovedFreeModelSequence(model, allowlist)

  if (!isApprovedFreeModel(model, allowlist)) {
    throw new Error(
      `Free-Only Policy Violation: Model "${model}" is not an approved verified free model. Only zero-priced models in the verified free allowlist are permitted.`
    )
  }

  if (approvedModels.length === 0) {
    throw new Error('No approved verified free OpenRouter model is configured.')
  }

  // 2. Configuration verification
  const configuredCount = keyManager.getConfiguredCount()
  if (configuredCount === 0) {
    throw new Error(
      'AI interpreter not configured. Please set OPENROUTER_API_KEY_1 (or OPENROUTER_API_KEY_2 / OPENROUTER_API_KEY_3) in .env.'
    )
  }

  const unavailableModels: string[] = []
  let lastClassifiedFailure: ClassifiedFailure | null = null

  // 3. Model and key failover loops. Model-level failures advance to the next
  // approved free model without burning through every configured account key.
  for (const activeModel of approvedModels) {
    const attemptedSlotIds = new Set<KeySlotId>()

    while (attemptedSlotIds.size < configuredCount) {
      const slot = keyManager.getNextEligibleSlot(attemptedSlotIds)

      if (!slot) {
        // No more healthy/eligible slots available right now
        break
      }

      attemptedSlotIds.add(slot.id)

      // Observability: Log request initiation with safe slot identifier (NEVER the key)
      console.info(`[OpenRouter] Request initiated for model "${activeModel}" using slot "${slot.id}".`)

      const controller = new AbortController()
      const timerId = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const payload = {
          model: activeModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
        }

        const res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${slot.key}`,
            'HTTP-Referer': 'https://reroute.local',
            'X-Title': 'ReRoute AI Disruption Interpreter',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })

        clearTimeout(timerId)

        if (res.ok) {
          keyManager.recordSuccess(slot.id)
          console.info(`[OpenRouter] Request succeeded on slot "${slot.id}" with model "${activeModel}".`)

          const data = (await res.json()) as {
            choices?: Array<{ message?: { content?: string } }>
          }

          const rawContent = data.choices?.[0]?.message?.content
          if (!rawContent) {
            throw new Error('OpenRouter returned an empty choices content.')
          }

          return extractJsonFromText(rawContent)
        }

        // Non-OK HTTP response: read error body and classify
        const errBodyText = await res.text().catch(() => '')
        const classified = classifyOpenRouterResponse(res.status, errBodyText, res.headers)
        lastClassifiedFailure = classified

        console.warn(
          `[OpenRouter] Slot "${slot.id}" failed with category: ${classified.category}. Status: ${res.status}.`
        )

        // Model/request-specific errors: Do NOT disable key or retry next key
        if (classified.category === 'model_unavailable') {
          keyManager.recordFailure(slot.id, classified)
          unavailableModels.push(activeModel)
          console.warn(`[OpenRouter] Model "${activeModel}" unavailable. Trying next approved free model if configured.`)
          break
        }

        if (classified.category === 'invalid_request') {
          throw new Error(keyManager.sanitize(classified.message))
        }

        // Key-specific or provider failure: record failure and proceed to failover
        keyManager.recordFailure(slot.id, classified)
        console.info(`[OpenRouter] Failover: attempting next eligible key slot...`)
      } catch (err: unknown) {
        clearTimeout(timerId)

        // If already a request/model error, bubble it up or move to next model.
        if (lastClassifiedFailure?.category === 'invalid_request') {
          throw err
        }
        if (lastClassifiedFailure?.category === 'model_unavailable') {
          break
        }

        if ((err as { name?: string }).name === 'AbortError') {
          const timeoutFailure: ClassifiedFailure = {
            category: 'transient',
            retryAfterMs: 5_000,
            message: `Request timed out after ${timeoutMs}ms.`,
          }
          lastClassifiedFailure = timeoutFailure
          keyManager.recordFailure(slot.id, timeoutFailure)
          console.warn(`[OpenRouter] Slot "${slot.id}" timed out. Attempting next slot...`)
        } else if (
          err instanceof Error &&
          (err.message.includes('Free-Only') || err.message.includes('Security Policy'))
        ) {
          throw err
        } else {
          const errorMsg = (err as Error).message || 'Network fetch failure'
          const networkFailure: ClassifiedFailure = {
            category: 'transient',
            retryAfterMs: 5_000,
            message: errorMsg,
          }
          lastClassifiedFailure = networkFailure
          keyManager.recordFailure(slot.id, networkFailure)
          console.warn(`[OpenRouter] Slot "${slot.id}" encountered network error. Attempting next slot...`)
        }
      }
    }

    if (lastClassifiedFailure?.category !== 'model_unavailable') {
      break
    }
  }

  // 4. All eligible keys exhausted: return actionable, sanitized failure
  const publicStatus = keyManager.getPublicStatus()

  if (
    unavailableModels.length > 0 &&
    unavailableModels.length === approvedModels.length &&
    publicStatus.healthyCount > 0
  ) {
    throw new OpenRouterModelUnavailableError(
      'No approved free OpenRouter model is currently available. Please try again later or update OPENROUTER_FREE_MODEL_ALLOWLIST with verified zero-priced models.',
      unavailableModels
    )
  }

  console.error(`[OpenRouter] All eligible keys exhausted. Status: ${publicStatus.allExhaustedReason}`)

  let finalErrorMessage = 'All configured OpenRouter account keys are currently unavailable.'
  if (publicStatus.allExhaustedReason === 'all_keys_credit_exhausted') {
    finalErrorMessage =
      'All configured OpenRouter account keys have exhausted credits or encountered billing restrictions.'
  } else if (publicStatus.allExhaustedReason === 'all_keys_rate_limited') {
    finalErrorMessage =
      'All configured OpenRouter account keys are temporarily rate-limited. Please retry shortly.'
  } else if (publicStatus.allExhaustedReason === 'all_keys_auth_failed') {
    finalErrorMessage =
      'All configured OpenRouter account keys failed authentication. Please verify your keys in .env.'
  } else if (publicStatus.allExhaustedReason === 'all_keys_unavailable') {
    finalErrorMessage =
      'All configured OpenRouter account keys are currently unavailable.'
  } else if (lastClassifiedFailure?.message) {
    finalErrorMessage = `OpenRouter failover exhausted: ${keyManager.sanitize(lastClassifiedFailure.message)}`
  }

  throw new Error(finalErrorMessage)
}
