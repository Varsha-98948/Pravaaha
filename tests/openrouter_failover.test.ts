/**
 * Automated Tests for OpenRouter Multi-Key Failover and Free-Only Policy.
 *
 * Covers 20 critical scenarios using mocked OpenRouter HTTP responses without
 * consuming real credits or making external paid requests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  OpenRouterKeyManager,
  maskApiKey,
} from '../src/services/openrouterKeyManager'
import {
  DEFAULT_FREE_MODEL,
  DEFAULT_FREE_MODEL_ALLOWLIST,
  isApprovedFreeModel,
  classifyOpenRouterResponse,
  executeOpenRouterRequestWithFailover,
} from '../src/services/openrouterClient'
import {
  resolveAiConfig,
  interpretDisruptionWithAi,
} from '../src/services/aiProvider'
import { locations, vehicles, originalPlan } from '../src/data/demo'
import { applyDisruption } from '../src/engine/disruptions'
import { replan } from '../src/engine/replan'
import type { DisruptionEvent } from '../src/types'

describe('OpenRouter Multi-Key Failover & Free-Only Policy', () => {
  const MOCK_SECRET_1 = 'sk-or-v1-test-key-alpha-1111111111'
  const MOCK_SECRET_2 = 'sk-or-v1-test-key-beta-2222222222'
  const MOCK_SECRET_3 = 'sk-or-v1-test-key-gamma-3333333333'

  const validRoadClosureJson = JSON.stringify({
    eventType: 'road_closure',
    event: {
      type: 'road_closure',
      id: 'dis-rc-depot-c1',
      at: 60,
      from: 'depot',
      to: 'c1',
    },
    preview: 'Road from Central Depot to Metro Market closed at 09:00',
    missing: [],
    unknownLocations: [],
    unknownVehicles: [],
    needsClarification: false,
    explicitFields: ['from', 'to', 'at'],
    inferredFields: [],
  })

  const successResponseBody = JSON.stringify({
    choices: [
      {
        message: {
          content: validRoadClosureJson,
        },
      },
    ],
  })

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  // Scenario 1: One configured free-model key succeeds
  it('1. One configured free-model key succeeds', async () => {
    const keyManager = new OpenRouterKeyManager({
      OPENROUTER_API_KEY_1: MOCK_SECRET_1,
    })

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => JSON.parse(successResponseBody),
    })

    const result = await executeOpenRouterRequestWithFailover({
      systemPrompt: 'System',
      userPrompt: 'Road from depot to c1 blocked',
      model: DEFAULT_FREE_MODEL,
      keyManager,
      fetchFn: mockFetch as unknown as typeof fetch,
    })

    expect(result.eventType).toBe('road_closure')
    const publicStatus = keyManager.getPublicStatus()
    expect(publicStatus.configuredCount).toBe(1)
    expect(publicStatus.healthyCount).toBe(1)
    expect(publicStatus.slots[0].totalSuccesses).toBe(1)
  })

  // Scenario 2: All three configured account keys are healthy
  it('2. All three configured account keys are healthy and rotate fairly', async () => {
    const keyManager = new OpenRouterKeyManager({
      OPENROUTER_API_KEY_1: MOCK_SECRET_1,
      OPENROUTER_API_KEY_2: MOCK_SECRET_2,
      OPENROUTER_API_KEY_3: MOCK_SECRET_3,
    })

    const status = keyManager.getPublicStatus()
    expect(status.configuredCount).toBe(3)
    expect(status.healthyCount).toBe(3)

    // Test fair round-robin selection
    const slotA = keyManager.getNextEligibleSlot()
    const slotB = keyManager.getNextEligibleSlot()
    const slotC = keyManager.getNextEligibleSlot()
    const slotD = keyManager.getNextEligibleSlot()

    expect(slotA?.id).toBe('key-1')
    expect(slotB?.id).toBe('key-2')
    expect(slotC?.id).toBe('key-3')
    expect(slotD?.id).toBe('key-1') // wraps around
  })

  // Scenario 3: The first account encounters confirmed credit exhaustion and the second succeeds
  it('3. The first account encounters confirmed credit exhaustion and the second succeeds', async () => {
    const keyManager = new OpenRouterKeyManager({
      OPENROUTER_API_KEY_1: MOCK_SECRET_1,
      OPENROUTER_API_KEY_2: MOCK_SECRET_2,
    })

    const mockFetch = vi
      .fn()
      // First call: Key 1 encounters credit exhaustion (HTTP 402)
      .mockResolvedValueOnce({
        ok: false,
        status: 402,
        headers: new Headers(),
        text: async () =>
          JSON.stringify({
            error: {
              message: 'User has insufficient credits or credit limit reached.',
              code: 402,
            },
          }),
      })
      // Second call: Key 2 succeeds (HTTP 200)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => JSON.parse(successResponseBody),
      })

    const result = await executeOpenRouterRequestWithFailover({
      systemPrompt: 'System',
      userPrompt: 'Test prompt',
      model: DEFAULT_FREE_MODEL,
      keyManager,
      fetchFn: mockFetch as unknown as typeof fetch,
    })

    expect(result.eventType).toBe('road_closure')
    expect(mockFetch).toHaveBeenCalledTimes(2)

    const publicStatus = keyManager.getPublicStatus()
    const slot1 = publicStatus.slots.find((s) => s.id === 'key-1')
    const slot2 = publicStatus.slots.find((s) => s.id === 'key-2')

    expect(slot1?.status).toBe('credit_exhausted')
    expect(slot2?.status).toBe('healthy')
    expect(slot2?.totalSuccesses).toBe(1)

    // Key 1 must not be selected again on subsequent request
    const nextSlot = keyManager.getNextEligibleSlot()
    expect(nextSlot?.id).toBe('key-2')
  })

  // Scenario 4: The first two accounts fail and the third succeeds
  it('4. The first two accounts fail and the third succeeds', async () => {
    const keyManager = new OpenRouterKeyManager({
      OPENROUTER_API_KEY_1: MOCK_SECRET_1,
      OPENROUTER_API_KEY_2: MOCK_SECRET_2,
      OPENROUTER_API_KEY_3: MOCK_SECRET_3,
    })

    const mockFetch = vi
      .fn()
      // Key 1: Credit exhaustion
      .mockResolvedValueOnce({
        ok: false,
        status: 402,
        headers: new Headers(),
        text: async () => 'Account balance is zero',
      })
      // Key 2: 401 Unauthorized
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers(),
        text: async () => 'Invalid API Key',
      })
      // Key 3: Success
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => JSON.parse(successResponseBody),
      })

    const result = await executeOpenRouterRequestWithFailover({
      systemPrompt: 'System',
      userPrompt: 'Test prompt',
      model: DEFAULT_FREE_MODEL,
      keyManager,
      fetchFn: mockFetch as unknown as typeof fetch,
    })

    expect(result.eventType).toBe('road_closure')
    expect(mockFetch).toHaveBeenCalledTimes(3)

    const publicStatus = keyManager.getPublicStatus()
    expect(publicStatus.slots[0].status).toBe('credit_exhausted')
    expect(publicStatus.slots[1].status).toBe('auth_failed')
    expect(publicStatus.slots[2].status).toBe('healthy')
  })

  // Scenario 5: All three accounts are unavailable (credit exhausted / billing restricted)
  it('5. All three accounts are billing-restricted/credit-exhausted', async () => {
    const keyManager = new OpenRouterKeyManager({
      OPENROUTER_API_KEY_1: MOCK_SECRET_1,
      OPENROUTER_API_KEY_2: MOCK_SECRET_2,
      OPENROUTER_API_KEY_3: MOCK_SECRET_3,
    })

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 402,
      headers: new Headers(),
      text: async () => 'Insufficient credits',
    })

    await expect(
      executeOpenRouterRequestWithFailover({
        systemPrompt: 'System',
        userPrompt: 'Test prompt',
        model: DEFAULT_FREE_MODEL,
        keyManager,
        fetchFn: mockFetch as unknown as typeof fetch,
      })
    ).rejects.toThrow(/exhausted credits or encountered billing restrictions/i)

    const publicStatus = keyManager.getPublicStatus()
    expect(publicStatus.healthyCount).toBe(0)
    expect(publicStatus.allExhaustedReason).toBe('all_keys_credit_exhausted')
  })

  // Scenario 6: One account is rate-limited and another succeeds
  it('6. One account is rate-limited (HTTP 429) and another succeeds', async () => {
    const keyManager = new OpenRouterKeyManager({
      OPENROUTER_API_KEY_1: MOCK_SECRET_1,
      OPENROUTER_API_KEY_2: MOCK_SECRET_2,
    })

    const headers = new Headers()
    headers.set('retry-after', '45')

    const mockFetch = vi
      .fn()
      // Key 1: 429 Rate limited with Retry-After 45s
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers,
        text: async () => 'Rate limit exceeded',
      })
      // Key 2: 200 OK
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => JSON.parse(successResponseBody),
      })

    const result = await executeOpenRouterRequestWithFailover({
      systemPrompt: 'System',
      userPrompt: 'Test prompt',
      model: DEFAULT_FREE_MODEL,
      keyManager,
      fetchFn: mockFetch as unknown as typeof fetch,
    })

    expect(result.eventType).toBe('road_closure')
    const publicStatus = keyManager.getPublicStatus()
    const slot1 = publicStatus.slots[0]
    expect(slot1.status).toBe('rate_limited')
    expect(slot1.cooldownUntil).not.toBeNull()
    expect(slot1.cooldownUntil! - Date.now()).toBeGreaterThan(30000)
  })

  // Scenario 7: All accounts are rate-limited
  it('7. All accounts are temporarily rate-limited', async () => {
    const keyManager = new OpenRouterKeyManager({
      OPENROUTER_API_KEY_1: MOCK_SECRET_1,
      OPENROUTER_API_KEY_2: MOCK_SECRET_2,
      OPENROUTER_API_KEY_3: MOCK_SECRET_3,
    })

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ 'retry-after': '30' }),
      text: async () => 'Too Many Requests',
    })

    await expect(
      executeOpenRouterRequestWithFailover({
        systemPrompt: 'System',
        userPrompt: 'Test prompt',
        model: DEFAULT_FREE_MODEL,
        keyManager,
        fetchFn: mockFetch as unknown as typeof fetch,
      })
    ).rejects.toThrow(/temporarily rate-limited/i)

    const publicStatus = keyManager.getPublicStatus()
    expect(publicStatus.allExhaustedReason).toBe('all_keys_rate_limited')
  })

  // Scenario 8: One key is invalid (401) and another succeeds
  it('8. One key is invalid (401/auth failure) and another succeeds', async () => {
    const keyManager = new OpenRouterKeyManager({
      OPENROUTER_API_KEY_1: 'invalid-key-slot-1',
      OPENROUTER_API_KEY_2: MOCK_SECRET_2,
    })

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers(),
        text: async () => 'Unauthorized: Invalid token',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => JSON.parse(successResponseBody),
      })

    const result = await executeOpenRouterRequestWithFailover({
      systemPrompt: 'System',
      userPrompt: 'Test prompt',
      model: DEFAULT_FREE_MODEL,
      keyManager,
      fetchFn: mockFetch as unknown as typeof fetch,
    })

    expect(result.eventType).toBe('road_closure')
    const publicStatus = keyManager.getPublicStatus()
    expect(publicStatus.slots[0].status).toBe('auth_failed')
    expect(publicStatus.slots[1].status).toBe('healthy')
  })

  // Scenario 9: A transient provider failure (500/503/timeout) follows the bounded retry policy
  it('9. Transient provider failure triggers bounded retry and succeeds on next key', async () => {
    const keyManager = new OpenRouterKeyManager({
      OPENROUTER_API_KEY_1: MOCK_SECRET_1,
      OPENROUTER_API_KEY_2: MOCK_SECRET_2,
    })

    const mockFetch = vi
      .fn()
      // Transient 503
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers(),
        text: async () => 'Service Unavailable',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => JSON.parse(successResponseBody),
      })

    const result = await executeOpenRouterRequestWithFailover({
      systemPrompt: 'System',
      userPrompt: 'Test prompt',
      model: DEFAULT_FREE_MODEL,
      keyManager,
      fetchFn: mockFetch as unknown as typeof fetch,
    })

    expect(result.eventType).toBe('road_closure')
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(keyManager.getPublicStatus().slots[0].status).toBe('cooling_down')
  })

  // Scenario 10: Invalid request payloads (e.g. 400 Bad Request) do not unnecessarily disable keys
  it('10. Invalid request payloads (400 Bad Request) do not disable or rotate healthy keys', async () => {
    const keyManager = new OpenRouterKeyManager({
      OPENROUTER_API_KEY_1: MOCK_SECRET_1,
      OPENROUTER_API_KEY_2: MOCK_SECRET_2,
    })

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers(),
      text: async () => 'Bad Request: Prompt token limit exceeded',
    })

    await expect(
      executeOpenRouterRequestWithFailover({
        systemPrompt: 'System',
        userPrompt: 'Oversized prompt',
        model: DEFAULT_FREE_MODEL,
        keyManager,
        fetchFn: mockFetch as unknown as typeof fetch,
      })
    ).rejects.toThrow(/rejected request \(400\)/i)

    // Crucial check: neither key was disabled or marked unhealthy!
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const publicStatus = keyManager.getPublicStatus()
    expect(publicStatus.slots[0].status).toBe('healthy')
    expect(publicStatus.slots[1].status).toBe('healthy')
  })

  it('10a. Model-level 404 does not disable healthy keys or retry the same model across every key', async () => {
    const keyManager = new OpenRouterKeyManager({
      OPENROUTER_API_KEY_1: MOCK_SECRET_1,
      OPENROUTER_API_KEY_2: MOCK_SECRET_2,
      OPENROUTER_API_KEY_3: MOCK_SECRET_3,
    })

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers(),
      text: async () =>
        JSON.stringify({
          error: {
            message: 'No endpoints found for apodex/apodex-1.1-mini:free.',
            code: 404,
          },
        }),
    })

    await expect(
      executeOpenRouterRequestWithFailover({
        systemPrompt: 'System',
        userPrompt: 'Test prompt',
        model: DEFAULT_FREE_MODEL,
        allowlist: [DEFAULT_FREE_MODEL],
        keyManager,
        fetchFn: mockFetch as unknown as typeof fetch,
      })
    ).rejects.toThrow(/No approved free OpenRouter model is currently available/i)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const publicStatus = keyManager.getPublicStatus()
    expect(publicStatus.healthyCount).toBe(3)
    expect(publicStatus.slots.every((slot) => slot.status === 'healthy')).toBe(true)
  })

  it('10b. Model-level 404 falls back to the next approved verified free model', async () => {
    const keyManager = new OpenRouterKeyManager({
      OPENROUTER_API_KEY_1: MOCK_SECRET_1,
      OPENROUTER_API_KEY_2: MOCK_SECRET_2,
      OPENROUTER_API_KEY_3: MOCK_SECRET_3,
    })

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
        text: async () => '{"error":{"message":"No endpoints found for apodex/apodex-1.1-mini:free.","code":404}}',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => JSON.parse(successResponseBody),
      })

    const result = await executeOpenRouterRequestWithFailover({
      systemPrompt: 'System',
      userPrompt: 'Test prompt',
      model: DEFAULT_FREE_MODEL,
      allowlist: [DEFAULT_FREE_MODEL, 'openrouter/free'],
      keyManager,
      fetchFn: mockFetch as unknown as typeof fetch,
    })

    expect(result.eventType).toBe('road_closure')
    expect(mockFetch).toHaveBeenCalledTimes(2)
    const firstPayload = JSON.parse(String(mockFetch.mock.calls[0][1]?.body))
    const secondPayload = JSON.parse(String(mockFetch.mock.calls[1][1]?.body))
    expect(firstPayload.model).toBe(DEFAULT_FREE_MODEL)
    expect(secondPayload.model).toBe('openrouter/free')
    expect(keyManager.getPublicStatus().healthyCount).toBe(3)
  })

  // Scenario 11: Empty key slots are skipped
  it('11. Empty key slots are skipped', async () => {
    const keyManager = new OpenRouterKeyManager({
      OPENROUTER_API_KEY_1: MOCK_SECRET_1,
      OPENROUTER_API_KEY_2: '   ', // whitespace only
      OPENROUTER_API_KEY_3: MOCK_SECRET_3,
    })

    const publicStatus = keyManager.getPublicStatus()
    expect(publicStatus.configuredCount).toBe(2)
    expect(publicStatus.slots.find((s) => s.id === 'key-2')?.configured).toBe(false)

    const slotA = keyManager.getNextEligibleSlot()
    const slotB = keyManager.getNextEligibleSlot()
    const slotC = keyManager.getNextEligibleSlot()

    expect(slotA?.id).toBe('key-1')
    expect(slotB?.id).toBe('key-3')
    expect(slotC?.id).toBe('key-1') // slot 2 was never selected
  })

  // Scenario 12: Unsupported or paid model identifiers are rejected
  it('12. Unsupported or paid model identifiers are rejected immediately without fetch', async () => {
    const keyManager = new OpenRouterKeyManager({
      OPENROUTER_API_KEY_1: MOCK_SECRET_1,
    })

    const mockFetch = vi.fn()

    // 1. Paid model like gpt-4o
    await expect(
      executeOpenRouterRequestWithFailover({
        systemPrompt: 'System',
        userPrompt: 'Test',
        model: 'openai/gpt-4o',
        keyManager,
        fetchFn: mockFetch as unknown as typeof fetch,
      })
    ).rejects.toThrow(/Free-Only Policy Violation/i)

    // 2. Paid model variant missing :free suffix
    await expect(
      executeOpenRouterRequestWithFailover({
        systemPrompt: 'System',
        userPrompt: 'Test',
        model: 'meta-llama/llama-3.3-70b-instruct',
        keyManager,
        fetchFn: mockFetch as unknown as typeof fetch,
      })
    ).rejects.toThrow(/Free-Only Policy Violation/i)

    expect(mockFetch).not.toHaveBeenCalled()
  })

  // Scenario 13: No unapproved model can be selected by fallback logic
  it('13. Models not on the approved allowlist are strictly rejected', () => {
    const allowlist = [DEFAULT_FREE_MODEL]

    expect(isApprovedFreeModel(DEFAULT_FREE_MODEL, allowlist)).toBe(true)
    expect(isApprovedFreeModel('unknown/model:free', allowlist)).toBe(false)
    expect(isApprovedFreeModel('anthropic/claude-3-5-sonnet:free', allowlist)).toBe(false)
    expect(isApprovedFreeModel('', allowlist)).toBe(false)
  })

  // Scenario 14: No paid fallback occurs when every free model fails
  it('14. Paid fallback cannot be enabled via configuration or parameters', () => {
    const env = {
      AI_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY_1: MOCK_SECRET_1,
      OPENROUTER_PAID_FALLBACK_ENABLED: 'true', // Attempting to turn on paid fallback
    }

    const { config, status } = resolveAiConfig(env)
    expect(config).toBeNull()
    expect(status.configured).toBe(false)
    expect(status.missingConfig[0]).toContain('Paid model fallbacks are strictly prohibited')
  })

  // Scenario 15: Missing or unverified free-model configuration fails safely
  it('15. Missing or unverified free-model configuration fails safely without throwing', async () => {
    const env = {
      AI_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY_1: MOCK_SECRET_1,
      OPENROUTER_FREE_MODEL: 'unverified-paid-model',
    }

    const { config, status } = resolveAiConfig(env)
    expect(config).toBeNull()
    expect(status.configured).toBe(false)
    expect(status.missingConfig[0]).toContain('not on the approved verified free-model allowlist')

    // AI interpreter execution with unconfigured config returns structured placeholder response
    const result = await interpretDisruptionWithAi({
      text: 'Road is closed',
      knownLocations: locations,
      config,
    })

    expect(result.event).toBeNull()
    expect(result.source).toBe('placeholder')
    expect(result.confirmation).toBe('pending')
    expect(result.preview).toContain('No AI integration is configured')
  })

  // Scenario 16: Concurrent requests do not corrupt key rotation state
  it('16. Concurrent requests do not corrupt key rotation state', async () => {
    const keyManager = new OpenRouterKeyManager({
      OPENROUTER_API_KEY_1: MOCK_SECRET_1,
      OPENROUTER_API_KEY_2: MOCK_SECRET_2,
      OPENROUTER_API_KEY_3: MOCK_SECRET_3,
    })

    const mockFetch = vi.fn().mockImplementation(async () => {
      // Simulate minor async network delay
      await new Promise((r) => setTimeout(r, 5))
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(successResponseBody),
      }
    })

    // Execute 30 concurrent requests
    const promises = Array.from({ length: 30 }, () =>
      executeOpenRouterRequestWithFailover({
        systemPrompt: 'System',
        userPrompt: 'Concurrent call',
        model: DEFAULT_FREE_MODEL,
        keyManager,
        fetchFn: mockFetch as unknown as typeof fetch,
      })
    )

    const results = await Promise.all(promises)
    expect(results).toHaveLength(30)
    expect(mockFetch).toHaveBeenCalledTimes(30)

    const publicStatus = keyManager.getPublicStatus()
    expect(publicStatus.healthyCount).toBe(3)
    const totalRecorded = publicStatus.slots.reduce((sum, s) => sum + s.totalSuccesses, 0)
    expect(totalRecorded).toBe(30)
  })

  // Scenario 17: No infinite retry loop occurs
  it('17. No infinite retry loop occurs and retries terminate at configured key count', async () => {
    const keyManager = new OpenRouterKeyManager({
      OPENROUTER_API_KEY_1: MOCK_SECRET_1,
      OPENROUTER_API_KEY_2: MOCK_SECRET_2,
    })

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers(),
      text: async () => 'Internal Server Error',
    })

    await expect(
      executeOpenRouterRequestWithFailover({
        systemPrompt: 'System',
        userPrompt: 'Test loop termination',
        model: DEFAULT_FREE_MODEL,
        keyManager,
        fetchFn: mockFetch as unknown as typeof fetch,
      })
    ).rejects.toThrow(/unavailable/i)

    // Must be called exactly 2 times (once per configured key slot)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  // Scenario 18: API keys never appear in logs or returned errors
  it('18. API keys never appear in logs or returned errors', async () => {
    const keyManager = new OpenRouterKeyManager({
      OPENROUTER_API_KEY_1: MOCK_SECRET_1,
    })

    const logSpy = vi.spyOn(console, 'log')
    const infoSpy = vi.spyOn(console, 'info')
    const warnSpy = vi.spyOn(console, 'warn')
    const errorSpy = vi.spyOn(console, 'error')

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      text: async () => `Invalid Bearer token ${MOCK_SECRET_1}`,
    })

    let caughtError: Error | null = null
    try {
      await executeOpenRouterRequestWithFailover({
        systemPrompt: 'System',
        userPrompt: 'Test sanitization',
        model: DEFAULT_FREE_MODEL,
        keyManager,
        fetchFn: mockFetch as unknown as typeof fetch,
      })
    } catch (e) {
      caughtError = e as Error
    }

    expect(caughtError).not.toBeNull()
    expect(caughtError?.message).not.toContain(MOCK_SECRET_1)

    // Inspect all logs
    const allLogged = [
      ...logSpy.mock.calls.flat(),
      ...infoSpy.mock.calls.flat(),
      ...warnSpy.mock.calls.flat(),
      ...errorSpy.mock.calls.flat(),
    ].join(' ')

    expect(allLogged).not.toContain(MOCK_SECRET_1)
    expect(maskApiKey(MOCK_SECRET_1)).not.toBe(MOCK_SECRET_1)
  })

  // Scenario 19: Existing AI interpreter output remains compatible with ReRoute
  it('19. Full AI interpreter flow produces valid InterpretedDisruption with pending confirmation', async () => {
    const keyManager = new OpenRouterKeyManager({
      OPENROUTER_API_KEY_1: MOCK_SECRET_1,
    })

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => JSON.parse(successResponseBody),
    })

    const { config } = resolveAiConfig({
      AI_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY_1: MOCK_SECRET_1,
      OPENROUTER_FREE_MODEL: DEFAULT_FREE_MODEL,
    })

    // Attach mock key manager
    config!.openrouter!.keyManager = keyManager

    const result = await interpretDisruptionWithAi({
      text: 'Road between depot and c1 closed at 09:00',
      knownLocations: locations,
      knownVehicles: vehicles,
      currentTime: 0,
      config,
      fetchFn: mockFetch as unknown as typeof fetch,
    })

    expect(result.source).toBe('ai')
    expect(result.confirmation).toBe('pending') // Enforces pending status
    expect(result.event).not.toBeNull()
    expect(result.event?.type).toBe('road_closure')
    if (result.event?.type === 'road_closure') {
      expect(result.event.from).toBe('depot')
      expect(result.event.to).toBe('c1')
      expect(result.event.at).toBe(60)
    }
  })

  // Scenario 20: Existing manual disruption workflows still function
  it('20. Existing manual disruption workflows continue functioning deterministically', () => {
    const manualEvent: DisruptionEvent = {
      type: 'road_closure',
      id: 'dis-manual-rc-depot-c1',
      at: 60,
      from: 'depot',
      to: 'c1',
    }

    const initialWorld = {
      vehicles,
      deliveries: [],
      matrix: { depot: { depot: 0, c1: 15 }, c1: { depot: 15, c1: 0 } },
      locations,
    }

    // 1. Apply manual disruption
    const updatedWorld = applyDisruption(initialWorld, manualEvent)
    expect(updatedWorld.activeClosures?.some((c) => c.from === 'depot' && c.to === 'c1')).toBe(true)

    // 2. Replan routes deterministically
    const replanned = replan(updatedWorld, originalPlan, manualEvent.at)
    expect(replanned).toBeDefined()
    expect(Array.isArray(replanned.routes)).toBe(true)
  })
})
