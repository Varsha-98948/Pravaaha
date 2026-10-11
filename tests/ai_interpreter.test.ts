import { describe, it, expect, vi } from 'vitest'
import {
  buildAiPrompt,
  extractJsonFromText,
  interpretDisruptionWithAi,
  resolveAiConfig,
  type AiConfig,
} from '../src/services/aiProvider'
import {
  HttpDisruptionInterpreter,
  placeholderInterpreter,
} from '../src/services/disruptionInterpreter'
import { interpretIncidentPreview } from '../src/services/disruptionService'
import { originalPlan, vehicles, deliveries, matrix, locations } from '../src/data/demo'
import { applyDisruption } from '../src/engine/disruptions'
import { replan } from '../src/engine/replan'
import type { DeliveryPlan, DisruptionEvent } from '../src/types'

describe('AI Interpreter: 1. Missing API key or provider configuration', () => {
  it('detects unconfigured environment and returns actionable missing config list', () => {
    const { config, status } = resolveAiConfig({})
    expect(config).toBeNull()
    expect(status.configured).toBe(false)
    expect(status.missingConfig[0]).toContain('AI_API_KEY')
  })

  it('interpretDisruptionWithAi returns clear configuration error when no config is provided', async () => {
    const res = await interpretDisruptionWithAi({
      text: 'Van 2 broke down',
      knownLocations: locations,
      knownVehicles: vehicles,
      config: null,
    })

    expect(res.event).toBeNull()
    expect(res.source).toBe('placeholder')
    expect(res.confirmation).toBe('pending')
    expect(res.missing.some((m) => m.includes('AI interpreter not configured'))).toBe(true)
    expect(res.preview).toContain('No AI integration is configured')
  })
})

describe('AI Interpreter: 2. Correctly configured provider', () => {
  it('resolves explicit Gemini configuration', () => {
    const { config, status } = resolveAiConfig({
      AI_PROVIDER: 'gemini',
      AI_API_KEY: 'test-gemini-key',
      AI_MODEL: 'gemini-1.5-flash',
    })

    expect(config).not.toBeNull()
    expect(config?.provider).toBe('gemini')
    expect(config?.apiKey).toBe('test-gemini-key')
    expect(config?.model).toBe('gemini-1.5-flash')
    expect(status.configured).toBe(true)
  })

  it('auto-detects OpenAI configuration from OPENAI_API_KEY', () => {
    const { config, status } = resolveAiConfig({
      OPENAI_API_KEY: 'sk-test-key',
    })

    expect(config?.provider).toBe('openai')
    expect(config?.apiKey).toBe('sk-test-key')
    expect(config?.model).toBe('gpt-4o-mini')
    expect(status.configured).toBe(true)
  })

  it('auto-detects Groq configuration from GROQ_API_KEY', () => {
    const { config, status } = resolveAiConfig({
      GROQ_API_KEY: 'gsk-test-key',
    })

    expect(config?.provider).toBe('groq')
    expect(config?.apiKey).toBe('gsk-test-key')
    expect(status.configured).toBe(true)
  })
})

describe('AI Interpreter: 3. Successful interpretation of a road closure', () => {
  const dummyConfig: AiConfig = {
    provider: 'gemini',
    apiKey: 'mock-key',
    model: 'gemini-1.5-flash',
  }

  it('interprets road closure message with simulation minute timing', async () => {
    const mockGeminiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  eventType: 'road_closure',
                  event: {
                    type: 'road_closure',
                    id: 'dis-rc-depot-c2',
                    at: 60,
                    from: 'depot',
                    to: 'c2',
                  },
                  preview: 'Road closure between Central Depot and Harbor Grocers starting at 09:00',
                  missing: [],
                  unknownLocations: [],
                  unknownVehicles: [],
                  needsClarification: false,
                  explicitFields: ['from', 'to', 'at'],
                  inferredFields: [],
                }),
              },
            ],
          },
        },
      ],
    }

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockGeminiResponse,
    })

    const res = await interpretDisruptionWithAi({
      text: 'Road between Central Depot and Harbor Grocers is blocked at 09:00',
      knownLocations: locations,
      knownVehicles: vehicles,
      currentTime: 0,
      config: dummyConfig,
      fetchFn: mockFetch as unknown as typeof fetch,
    })

    expect(res.source).toBe('ai')
    expect(res.confirmation).toBe('pending')
    expect(res.event).not.toBeNull()
    expect(res.event?.type).toBe('road_closure')
    if (res.event?.type === 'road_closure') {
      expect(res.event.from).toBe('depot')
      expect(res.event.to).toBe('c2')
      expect(res.event.at).toBe(60)
    }
  })
})

describe('AI Interpreter: 4. Successful interpretation of a vehicle breakdown', () => {
  const dummyConfig: AiConfig = {
    provider: 'gemini',
    apiKey: 'mock-key',
    model: 'gemini-1.5-flash',
  }

  it('maps "Vehicle V03" / "Truck 3" to known vehicleId "v3" at 90 minutes', async () => {
    const mockGeminiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  eventType: 'vehicle_failure',
                  event: {
                    type: 'vehicle_failure',
                    id: 'dis-vf-v3-90',
                    at: 90,
                    vehicleId: 'v3',
                    locationId: 'c2',
                  },
                  preview: 'Vehicle Truck 3 (v3) failed near Harbor Grocers at 09:30',
                  missing: [],
                  unknownLocations: [],
                  unknownVehicles: [],
                  needsClarification: false,
                  explicitFields: ['vehicleId', 'locationId', 'at'],
                  inferredFields: [],
                }),
              },
            ],
          },
        },
      ],
    }

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockGeminiResponse,
    })

    const res = await interpretDisruptionWithAi({
      text: 'Vehicle V03 has broken down near Harbor Grocers at 09:30 and cannot complete deliveries',
      knownLocations: locations,
      knownVehicles: vehicles,
      currentTime: 0,
      config: dummyConfig,
      fetchFn: mockFetch as unknown as typeof fetch,
    })

    expect(res.event).not.toBeNull()
    expect(res.event?.type).toBe('vehicle_failure')
    if (res.event?.type === 'vehicle_failure') {
      expect(res.event.vehicleId).toBe('v3')
      expect(res.event.at).toBe(90)
    }
  })
})

describe('AI Interpreter: 5. Successful interpretation of an urgent delivery', () => {
  const dummyConfig: AiConfig = {
    provider: 'gemini',
    apiKey: 'mock-key',
    model: 'gemini-1.5-flash',
  }

  it('interprets urgent delivery with time window "before 4 PM" (480 minutes)', async () => {
    const mockGeminiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  eventType: 'urgent_delivery',
                  event: {
                    type: 'urgent_delivery',
                    id: 'dis-urg-c8',
                    at: 120,
                    delivery: {
                      id: 'd-urg-c8-1',
                      locationId: 'c8',
                      size: 8,
                      serviceMin: 10,
                      window: { start: 120, end: 480 },
                      priority: 'urgent',
                    },
                  },
                  preview: 'Urgent delivery inserted at Eastside Florist before 4 PM',
                  missing: [],
                  unknownLocations: [],
                  unknownVehicles: [],
                  needsClarification: false,
                  explicitFields: ['locationId', 'window.end'],
                  inferredFields: ['size', 'serviceMin', 'window.start'],
                }),
              },
            ],
          },
        },
      ],
    }

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockGeminiResponse,
    })

    const res = await interpretDisruptionWithAi({
      text: 'Add an urgent delivery to Eastside Florist that must arrive before 4 PM.',
      knownLocations: locations,
      knownVehicles: vehicles,
      currentTime: 120,
      config: dummyConfig,
      fetchFn: mockFetch as unknown as typeof fetch,
    })

    expect(res.event).not.toBeNull()
    expect(res.event?.type).toBe('urgent_delivery')
    if (res.event?.type === 'urgent_delivery') {
      expect(res.event.delivery.locationId).toBe('c8')
      expect(res.event.delivery.window.end).toBe(480)
      expect(res.event.delivery.priority).toBe('urgent')
    }
  })
})

describe('AI Interpreter: 6. Ambiguous or incomplete input', () => {
  const dummyConfig: AiConfig = {
    provider: 'gemini',
    apiKey: 'mock-key',
    model: 'gemini-1.5-flash',
  }

  it('flags ambiguous input and asks specific clarification question without creating invalid event', async () => {
    const mockGeminiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  eventType: null,
                  event: null,
                  preview: 'Ambiguous incident: one of the vehicles had a breakdown.',
                  missing: ['Vehicle ID or name missing'],
                  unknownLocations: [],
                  unknownVehicles: [],
                  needsClarification: true,
                  clarificationQuestion: 'Which vehicle broke down (Van 1, Van 2, or Truck 3)?',
                }),
              },
            ],
          },
        },
      ],
    }

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockGeminiResponse,
    })

    const res = await interpretDisruptionWithAi({
      text: 'A vehicle broke down somewhere',
      knownLocations: locations,
      knownVehicles: vehicles,
      config: dummyConfig,
      fetchFn: mockFetch as unknown as typeof fetch,
    })

    expect(res.event).toBeNull()
    expect(res.needsClarification).toBe(true)
    expect(res.clarificationQuestion).toContain('Which vehicle broke down')
  })
})

describe('AI Interpreter: 7. Unknown vehicle, delivery, or location', () => {
  const dummyConfig: AiConfig = {
    provider: 'gemini',
    apiKey: 'mock-key',
    model: 'gemini-1.5-flash',
  }

  it('rejects unknown location ("Hinjewadi") and does not invent location ID', async () => {
    const mockGeminiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  eventType: 'road_closure',
                  event: null,
                  preview: 'Road closure reported for Hinjewadi bridge, but Hinjewadi is not a known location.',
                  missing: ['Unknown location: Hinjewadi'],
                  unknownLocations: ['Hinjewadi'],
                  unknownVehicles: [],
                  needsClarification: true,
                  clarificationQuestion: 'Which known depot or customer location corresponds to the Hinjewadi bridge route?',
                }),
              },
            ],
          },
        },
      ],
    }

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockGeminiResponse,
    })

    const res = await interpretDisruptionWithAi({
      text: 'The bridge on the route to Hinjewadi is closed for the next two hours.',
      knownLocations: locations,
      knownVehicles: vehicles,
      config: dummyConfig,
      fetchFn: mockFetch as unknown as typeof fetch,
    })

    expect(res.event).toBeNull()
    expect(res.unknownLocations).toContain('Hinjewadi')
    expect(res.needsClarification).toBe(true)
  })

  it('deterministic validator strips hallucinated unknown location even if AI returns event object', async () => {
    const mockGeminiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  eventType: 'road_closure',
                  event: {
                    type: 'road_closure',
                    id: 'dis-rc-fake',
                    at: 60,
                    from: 'depot',
                    to: 'hinjewadi_hallucinated',
                  },
                  preview: 'Road closed to Hinjewadi',
                  missing: [],
                  unknownLocations: [],
                  unknownVehicles: [],
                  needsClarification: false,
                }),
              },
            ],
          },
        },
      ],
    }

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockGeminiResponse,
    })

    const res = await interpretDisruptionWithAi({
      text: 'Road to Hinjewadi closed',
      knownLocations: locations, // does NOT contain hinjewadi_hallucinated
      knownVehicles: vehicles,
      config: dummyConfig,
      fetchFn: mockFetch as unknown as typeof fetch,
    })

    // Strict validator must reject and nullify the event!
    expect(res.event).toBeNull()
    expect(res.unknownLocations).toContain('hinjewadi_hallucinated')
  })
})

describe('AI Interpreter: 8. Malformed or schema-invalid AI output', () => {
  const dummyConfig: AiConfig = {
    provider: 'gemini',
    apiKey: 'mock-key',
    model: 'gemini-1.5-flash',
  }

  it('handles non-JSON prose response gracefully without crashing', async () => {
    const mockGeminiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: 'I apologize, but as an AI assistant I cannot process this delivery request.',
              },
            ],
          },
        },
      ],
    }

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockGeminiResponse,
    })

    const res = await interpretDisruptionWithAi({
      text: 'Van 1 broke down',
      knownLocations: locations,
      knownVehicles: vehicles,
      config: dummyConfig,
      fetchFn: mockFetch as unknown as typeof fetch,
    })

    expect(res.event).toBeNull()
    expect(res.error).toBeDefined()
    expect(res.preview).toContain('AI Interpreter Error')
  })

  it('handles markdown wrapped JSON correctly', () => {
    const raw = '```json\n{"preview": "Markdown test", "missing": []}\n```'
    const parsed = extractJsonFromText(raw)
    expect(parsed.preview).toBe('Markdown test')
  })
})

describe('AI Interpreter: 9. Provider timeout, authentication failure, and rate limiting', () => {
  const dummyConfig: AiConfig = {
    provider: 'gemini',
    apiKey: 'mock-key',
    model: 'gemini-1.5-flash',
    timeoutMs: 100,
  }

  it('handles 401 Unauthorized without exposing secret key', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'API_KEY_INVALID',
    })

    const res = await interpretDisruptionWithAi({
      text: 'Van 1 broke down',
      knownLocations: locations,
      knownVehicles: vehicles,
      config: dummyConfig,
      fetchFn: mockFetch as unknown as typeof fetch,
    })

    expect(res.event).toBeNull()
    expect(res.error).toContain('Authentication failed')
    expect(res.error).not.toContain('mock-key') // Secret must not leak!
  })

  it('handles 429 Rate Limit gracefully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: async () => 'Quota exceeded',
    })

    const res = await interpretDisruptionWithAi({
      text: 'Van 1 broke down',
      knownLocations: locations,
      knownVehicles: vehicles,
      config: dummyConfig,
      fetchFn: mockFetch as unknown as typeof fetch,
    })

    expect(res.event).toBeNull()
    expect(res.error).toContain('rate limit')
  })

  it('handles request timeout gracefully', async () => {
    const mockFetch = vi.fn().mockImplementation((_url, opts) => {
      return new Promise((_, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    })

    const res = await interpretDisruptionWithAi({
      text: 'Van 1 broke down',
      knownLocations: locations,
      knownVehicles: vehicles,
      config: dummyConfig,
      fetchFn: mockFetch as unknown as typeof fetch,
    })

    expect(res.event).toBeNull()
    expect(res.error).toContain('timed out')
  })
})

describe('AI Interpreter: 10. Confirmation and cancellation behavior', () => {
  it('forces confirmation status to pending regardless of interpreter output', async () => {
    const mockInterpreter = {
      async interpret() {
        return {
          rawText: 'Van 2 broke down',
          event: {
            type: 'vehicle_failure' as const,
            id: 'dis-1',
            at: 90,
            vehicleId: 'v2',
          },
          missing: [],
          unknownLocations: [],
          preview: 'Preview',
          confirmation: 'confirmed' as const, // Attempted pre-confirmation
          source: 'ai' as const,
        }
      },
    }

    const preview = await interpretIncidentPreview(
      'Van 2 broke down',
      mockInterpreter,
      locations.map((l) => l.id),
      vehicles.map((v) => v.id)
    )

    expect(preview.confirmation).toBe('pending')
  })
})

describe('AI Interpreter: 11. Interpretation alone does not modify committed plans', () => {
  it('verifies original plan, deliveries, and vehicles are untouched after interpretation', async () => {
    const initialPlanJson = JSON.stringify(originalPlan)
    const initialVehiclesJson = JSON.stringify(vehicles)
    const initialDeliveriesJson = JSON.stringify(deliveries)

    const mockInterpreter = {
      async interpret() {
        return {
          rawText: 'Van 2 breakdown',
          event: {
            type: 'vehicle_failure' as const,
            id: 'vf-1',
            at: 90,
            vehicleId: 'v2',
          },
          missing: [],
          unknownLocations: [],
          preview: 'Van 2 failed',
          confirmation: 'pending' as const,
          source: 'ai' as const,
        }
      },
    }

    await interpretIncidentPreview(
      'Van 2 breakdown',
      mockInterpreter,
      locations.map((l) => l.id),
      vehicles.map((v) => v.id)
    )

    expect(JSON.stringify(originalPlan)).toBe(initialPlanJson)
    expect(JSON.stringify(vehicles)).toBe(initialVehiclesJson)
    expect(JSON.stringify(deliveries)).toBe(initialDeliveriesJson)
  })
})

describe('AI Interpreter: 12. Quick events continue to work independently of AI availability', () => {
  it('applies quick event and replans successfully even when AI is unconfigured', () => {
    const quickEvent: DisruptionEvent = {
      type: 'vehicle_failure',
      id: 'dis-v2-fail',
      at: 90,
      vehicleId: 'v2',
    }

    const updatedWorld = applyDisruption(
      { vehicles, deliveries, matrix, locations },
      quickEvent
    )
    const replanned = replan(updatedWorld, originalPlan, quickEvent.at)

    expect(replanned.routes.length).toBeGreaterThan(0)
    // Van 2 should not have active stops after breakdown
    const v2Route = replanned.routes.find((r) => r.vehicleId === 'v2')
    const postBreakdownStops = (v2Route?.stops || []).filter((s) => s.departure > 90)
    expect(postBreakdownStops.length).toBe(0)
  })

  it('placeholderInterpreter remains functional as fallback', async () => {
    const result = await placeholderInterpreter.interpret('Some text', [])
    expect(result.source).toBe('placeholder')
    expect(result.missing).toContain('AI interpreter not configured')
    expect(result.confirmation).toBe('pending')
  })
})
