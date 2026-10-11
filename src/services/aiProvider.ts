/**
 * AI Provider Integration and Disruption Interpreter Backend.
 *
 * Provides structured natural-language disruption interpretation for:
 * - Google Gemini (default)
 * - OpenAI / Groq / OpenAI-compatible
 * - Anthropic Claude
 *
 * Operates purely with standard fetch and environment variables.
 * Never exposes credentials to frontend code.
 */

import type {
  DisruptionEvent,
  InterpretedDisruption,
  RoadClosureEvent,
  UrgentDeliveryEvent,
  VehicleFailureEvent,
} from '../types'
import { validateInterpretedDisruption } from './validation'

export type AiProviderType = 'gemini' | 'openai' | 'groq' | 'anthropic'

export interface AiConfig {
  provider: AiProviderType
  apiKey: string
  model: string
  endpoint?: string
  timeoutMs?: number
}

export interface LocationInfo {
  id: string
  name: string
}

export interface VehicleInfo {
  id: string
  name: string
}

export interface InterpretParams {
  text: string
  knownLocations: LocationInfo[] | string[]
  knownVehicles?: VehicleInfo[] | string[]
  currentTime?: number
  config?: AiConfig | null
  fetchFn?: typeof fetch
}

export interface AiStatusResult {
  configured: boolean
  provider: AiProviderType | null
  model: string | null
  missingConfig: string[]
  error?: string
}

function getSystemEnv(): Record<string, string | undefined> {
  const g = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }
  return (typeof g.process !== 'undefined' && g.process.env) ? g.process.env : {}
}

/**
 * Resolves AI provider configuration from environment variables.
 * Safe to call with any env dictionary (e.g. process.env in Node/Vite server).
 */
export function resolveAiConfig(
  env: Record<string, string | undefined> = getSystemEnv()
): { config: AiConfig | null; status: AiStatusResult } {
  // Provider selection: explicit or auto-detected
  const explicitProvider = (env.AI_PROVIDER || '').trim().toLowerCase() as AiProviderType

  let provider: AiProviderType | null = null
  let apiKey: string = ''
  let model: string = ''
  let endpoint: string = env.AI_API_ENDPOINT || ''

  if (explicitProvider && ['gemini', 'openai', 'groq', 'anthropic'].includes(explicitProvider)) {
    provider = explicitProvider
  }

  // Check keys
  const geminiKey = env.GEMINI_API_KEY || (provider === 'gemini' ? env.AI_API_KEY : '')
  const openaiKey = env.OPENAI_API_KEY || (provider === 'openai' ? env.AI_API_KEY : '')
  const groqKey = env.GROQ_API_KEY || (provider === 'groq' ? env.AI_API_KEY : '')
  const anthropicKey = env.ANTHROPIC_API_KEY || (provider === 'anthropic' ? env.AI_API_KEY : '')
  const genericKey = env.AI_API_KEY || ''

  if (!provider) {
    if (geminiKey) provider = 'gemini'
    else if (openaiKey) provider = 'openai'
    else if (groqKey) provider = 'groq'
    else if (anthropicKey) provider = 'anthropic'
    else if (genericKey) provider = 'gemini' // default to gemini if generic key provided
  }

  if (provider === 'gemini') {
    apiKey = (geminiKey || genericKey).trim()
    model = (env.GEMINI_MODEL || env.AI_MODEL || 'gemini-1.5-flash').trim()
  } else if (provider === 'openai') {
    apiKey = (openaiKey || genericKey).trim()
    model = (env.OPENAI_MODEL || env.AI_MODEL || 'gpt-4o-mini').trim()
    if (!endpoint) endpoint = 'https://api.openai.com/v1/chat/completions'
  } else if (provider === 'groq') {
    apiKey = (groqKey || genericKey).trim()
    model = (env.GROQ_MODEL || env.AI_MODEL || 'llama-3.3-70b-versatile').trim()
    if (!endpoint) endpoint = 'https://api.groq.com/openai/v1/chat/completions'
  } else if (provider === 'anthropic') {
    apiKey = (anthropicKey || genericKey).trim()
    model = (env.ANTHROPIC_MODEL || env.AI_MODEL || 'claude-3-5-haiku-20241022').trim()
    if (!endpoint) endpoint = 'https://api.anthropic.com/v1/messages'
  }

  if (!provider || !apiKey) {
    const missing: string[] = []
    if (!provider && !apiKey) {
      missing.push('AI_API_KEY (or GEMINI_API_KEY / OPENAI_API_KEY)')
    } else if (!apiKey && provider) {
      missing.push(`${(provider as string).toUpperCase()}_API_KEY or AI_API_KEY`)
    }

    return {
      config: null,
      status: {
        configured: false,
        provider: provider || null,
        model: model || null,
        missingConfig: missing,
      },
    }
  }

  const timeoutMs = env.AI_TIMEOUT_MS ? parseInt(env.AI_TIMEOUT_MS, 10) : 15000

  const resolvedConfig: AiConfig = {
    provider,
    apiKey,
    model,
    endpoint: endpoint || undefined,
    timeoutMs,
  }

  return {
    config: resolvedConfig,
    status: {
      configured: true,
      provider,
      model,
      missingConfig: [],
    },
  }
}

/**
 * Normalizes location list into { id, name } pairs.
 */
function normalizeLocations(locs: LocationInfo[] | string[]): LocationInfo[] {
  return locs.map((l) => (typeof l === 'string' ? { id: l, name: l } : l))
}

/**
 * Normalizes vehicle list into { id, name } pairs.
 */
function normalizeVehicles(vehs: VehicleInfo[] | string[] | undefined): VehicleInfo[] {
  if (!vehs) return []
  return vehs.map((v) => (typeof v === 'string' ? { id: v, name: v } : v))
}

/**
 * Builds system prompt and context for disruption parsing.
 */
export function buildAiPrompt(params: {
  text: string
  knownLocations: LocationInfo[]
  knownVehicles: VehicleInfo[]
  currentTime: number
}): { systemPrompt: string; userPrompt: string } {
  const { text, knownLocations, knownVehicles, currentTime } = params

  const locListStr = knownLocations
    .map((l) => `- ID: "${l.id}", Name: "${l.name}"`)
    .join('\n')

  const vehListStr = knownVehicles
    .map((v) => `- ID: "${v.id}", Name: "${v.name}"`)
    .join('\n')

  const systemPrompt = `You are the Pravaaha ReRoute AI Disruption Interpreter for an urban logistics delivery network.
Your mission is to interpret natural-language dispatcher messages into structured disruption events adhering strictly to the system's schema.

=== TIME MODEL ===
- Simulation clock: Minute 0 is 08:00 AM (Day Start).
- Examples:
  * 08:00 AM = 0 minutes
  * 09:00 AM = 60 minutes
  * 09:30 AM = 90 minutes
  * 10:00 AM = 120 minutes
  * 04:00 PM (16:00) = 480 minutes
- Current simulation time is minute ${currentTime}.
- If a time is relative (e.g. "immediately", "right now", "for the next 2 hours"), calculate relative to ${currentTime}.

=== KNOWN ENTITIES IN SCENARIO ===
Known Locations:
${locListStr || 'No locations provided'}

Known Vehicles:
${vehListStr || 'No vehicles provided'}

=== SUPPORTED DISRUPTION TYPES ===
The application strictly supports ONLY these 3 disruption event types:

1. "road_closure"
   Format:
   {
     "type": "road_closure",
     "id": "dis-rc-<from>-<to>-<at>",
     "at": <simulation_minutes_number>,
     "from": "<known_location_id>",
     "to": "<known_location_id>"
   }
   Rules:
   - "from" and "to" MUST be distinct known location IDs from the Known Locations list above.
   - If either location is not recognized in the Known Locations list, DO NOT invent an ID. Mark it as an unknown location.

2. "vehicle_failure"
   Format:
   {
     "type": "vehicle_failure",
     "id": "dis-vf-<vehicleId>-<at>",
     "at": <simulation_minutes_number>,
     "vehicleId": "<known_vehicle_id>",
     "locationId": "<known_location_id_or_omit>"
   }
   Rules:
   - "vehicleId" MUST be a known vehicle ID from the Known Vehicles list above.
   - If a vehicle like "V03" or "Truck 3" is mentioned, resolve it to the exact known ID (e.g., "v3").
   - If unknown, record it in unknownVehicles.

3. "urgent_delivery"
   Format:
   {
     "type": "urgent_delivery",
     "id": "dis-urg-<locationId>-<at>",
     "at": <simulation_minutes_number>,
     "delivery": {
       "id": "d-urgent-<random_or_timestamp>",
       "locationId": "<known_location_id>",
       "size": <positive_number>,
       "serviceMin": <positive_number>,
       "window": { "start": <start_min>, "end": <end_min> },
       "priority": "urgent"
     }
   }
   Rules:
   - "locationId" MUST be a known location ID.
   - If delivery size is not explicitly stated, use default 10 and record "size" in inferredFields.
   - If service duration is not explicitly stated, use default 10 and record "serviceMin" in inferredFields.
   - If window start is not stated, use current time ${currentTime} or arrival start.
   - If window end is specified like "arrive before 4 PM", convert 4 PM to 480 minutes.

=== UNSUPPORTED EVENTS & AMBIGUITY ===
- If the report is about traffic delay, speed reduction, or travel time increases (e.g., "travel time increased by 25 mins"), this is an UNSUPPORTED event type.
  Set event: null, eventType: "unsupported", needsClarification: true, and explain in preview and missing that travel time adjustments are unsupported.
- If essential details are missing (e.g., "a van broke down" without specifying which van, or "road is closed" without from/to), set event: null, needsClarification: true, and formulate a clear clarificationQuestion.
- If the text mentions unknown entities (e.g., locations or vehicles not in the known list like "Hinjewadi", "Wakad", "V99"), list them in unknownLocations or unknownVehicles, set event: null, and request clarification.
- NEVER invent imaginary locations or vehicles.

=== OUTPUT FORMAT ===
You must respond with ONLY a valid, single JSON object (no markdown, no extra commentary):
{
  "eventType": "road_closure" | "vehicle_failure" | "urgent_delivery" | "unsupported" | null,
  "event": <DisruptionEvent_object_or_null>,
  "preview": "<concise_human_readable_summary_of_the_incident_or_issue>",
  "missing": ["<list_of_any_missing_information_or_unsupported_reasons>"],
  "unknownLocations": ["<list_of_unrecognized_location_names>"],
  "unknownVehicles": ["<list_of_unrecognized_vehicle_names>"],
  "needsClarification": <boolean>,
  "clarificationQuestion": "<specific_question_to_ask_dispatcher_if_clarification_needed_or_null>",
  "explicitFields": ["<list_of_fields_explicitly_present_in_message>"],
  "inferredFields": ["<list_of_fields_inferred_with_defaults>"]
}`

  const userPrompt = `Dispatcher report: "${text}"`

  return { systemPrompt, userPrompt }
}

/**
 * Extracts and parses JSON from raw LLM output text.
 */
export function extractJsonFromText(rawText: string): Record<string, unknown> {
  const trimmed = rawText.trim()

  // 1. Direct parse attempt
  try {
    return JSON.parse(trimmed)
  } catch {
    // Continue to markdown extraction
  }

  // 2. Extract code fence ```json ... ``` or ``` ... ```
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (codeBlockMatch && codeBlockMatch[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim())
    } catch {
      // Continue to bracket search
    }
  }

  // 3. Find first '{' and last '}'
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      // Failed
    }
  }

  throw new Error('AI output was not valid JSON.')
}

/**
 * Calls the configured AI provider and returns raw parsed interpretation.
 */
export async function callAiProvider(
  params: {
    systemPrompt: string
    userPrompt: string
    config: AiConfig
    fetchFn?: typeof fetch
  }
): Promise<Record<string, unknown>> {
  const { systemPrompt, userPrompt, config } = params
  const fetchImpl = params.fetchFn || globalThis.fetch

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs || 15000)

  try {
    if (config.provider === 'gemini') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`

      const payload = {
        contents: [
          {
            parts: [
              {
                text: `${systemPrompt}\n\n---\n${userPrompt}`,
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      }

      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error('Authentication failed with Gemini API. Please check your API key.')
        }
        if (res.status === 429) {
          throw new Error('Gemini API rate limit reached. Please retry in a few moments.')
        }
        const errText = await res.text().catch(() => '')
        throw new Error(`Gemini API error (${res.status}): ${errText || res.statusText}`)
      }

      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      }

      const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text
      if (!candidateText) {
        throw new Error('Gemini returned an empty response.')
      }

      return extractJsonFromText(candidateText)
    }

    if (config.provider === 'openai' || config.provider === 'groq') {
      const endpoint = config.endpoint || 'https://api.openai.com/v1/chat/completions'

      const payload = {
        model: config.model,
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
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error(`Authentication failed with ${config.provider.toUpperCase()} API. Please check your API key.`)
        }
        if (res.status === 429) {
          throw new Error(`${config.provider.toUpperCase()} API rate limit reached. Please retry in a few moments.`)
        }
        const errText = await res.text().catch(() => '')
        throw new Error(`${config.provider.toUpperCase()} API error (${res.status}): ${errText || res.statusText}`)
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }

      const content = data.choices?.[0]?.message?.content
      if (!content) {
        throw new Error(`${config.provider.toUpperCase()} returned an empty response.`)
      }

      return extractJsonFromText(content)
    }

    if (config.provider === 'anthropic') {
      const endpoint = config.endpoint || 'https://api.anthropic.com/v1/messages'

      const payload = {
        model: config.model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.1,
      }

      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error('Authentication failed with Anthropic API. Please check your API key.')
        }
        if (res.status === 429) {
          throw new Error('Anthropic API rate limit reached. Please retry in a few moments.')
        }
        const errText = await res.text().catch(() => '')
        throw new Error(`Anthropic API error (${res.status}): ${errText || res.statusText}`)
      }

      const data = (await res.json()) as {
        content?: Array<{ text?: string }>
      }

      const content = data.content?.[0]?.text
      if (!content) {
        throw new Error('Anthropic returned an empty response.')
      }

      return extractJsonFromText(content)
    }

    throw new Error(`Unsupported AI provider: ${config.provider}`)
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'AbortError') {
      throw new Error(`AI request timed out after ${config.timeoutMs || 15000}ms.`)
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Main AI disruption interpretation entrypoint.
 * Interprets natural language, validates schema, checks scenarios, and produces
 * a safe, preview-only InterpretedDisruption.
 */
export async function interpretDisruptionWithAi(
  params: InterpretParams
): Promise<InterpretedDisruption> {
  const {
    text,
    knownLocations: rawLocations,
    knownVehicles: rawVehicles,
    currentTime = 0,
    config,
    fetchFn,
  } = params

  if (typeof text !== 'string' || text.trim() === '') {
    return {
      rawText: text || '',
      event: null,
      missing: ['Incident report text cannot be empty.'],
      unknownLocations: [],
      unknownVehicles: [],
      preview: 'Empty incident report.',
      confirmation: 'pending',
      source: 'placeholder',
      needsClarification: true,
      clarificationQuestion: 'Please provide details of the disruption.',
    }
  }

  // 1. Check configuration
  if (!config || !config.apiKey) {
    return {
      rawText: text,
      event: null,
      missing: [
        'AI interpreter not configured. Please set AI_API_KEY (or GEMINI_API_KEY / OPENAI_API_KEY) in .env.',
      ],
      unknownLocations: [],
      unknownVehicles: [],
      preview: 'No AI integration is configured, so this text was not interpreted. Use the quick events below.',
      confirmation: 'pending',
      source: 'placeholder',
    }
  }

  const knownLocations = normalizeLocations(rawLocations)
  const knownVehicles = normalizeVehicles(rawVehicles)
  const knownLocationIds = knownLocations.map((l) => l.id)
  const knownVehicleIds = knownVehicles.map((v) => v.id)

  // 2. Build prompt
  const { systemPrompt, userPrompt } = buildAiPrompt({
    text,
    knownLocations,
    knownVehicles,
    currentTime,
  })

  // 3. Call AI provider
  let rawAiOutput: Record<string, unknown>
  try {
    rawAiOutput = await callAiProvider({
      systemPrompt,
      userPrompt,
      config,
      fetchFn,
    })
  } catch (err: unknown) {
    const errorMsg = (err as Error).message || 'Failed to communicate with AI provider.'
    return {
      rawText: text,
      event: null,
      missing: [errorMsg],
      unknownLocations: [],
      unknownVehicles: [],
      preview: `AI Interpreter Error: ${errorMsg}`,
      confirmation: 'pending',
      source: 'ai',
      error: errorMsg,
    }
  }

  // 4. Extract fields from parsed JSON
  const preview =
    typeof rawAiOutput.preview === 'string' && rawAiOutput.preview.trim() !== ''
      ? rawAiOutput.preview
      : `Interpreted incident report: "${text}"`

  const missing: string[] = Array.isArray(rawAiOutput.missing)
    ? rawAiOutput.missing.map(String)
    : []

  const unknownLocations: string[] = Array.isArray(rawAiOutput.unknownLocations)
    ? rawAiOutput.unknownLocations.map(String)
    : []

  const unknownVehicles: string[] = Array.isArray(rawAiOutput.unknownVehicles)
    ? rawAiOutput.unknownVehicles.map(String)
    : []

  const needsClarification = Boolean(rawAiOutput.needsClarification)
  const clarificationQuestion =
    typeof rawAiOutput.clarificationQuestion === 'string'
      ? rawAiOutput.clarificationQuestion
      : undefined

  const explicitFields = Array.isArray(rawAiOutput.explicitFields)
    ? rawAiOutput.explicitFields.map(String)
    : []

  const inferredFields = Array.isArray(rawAiOutput.inferredFields)
    ? rawAiOutput.inferredFields.map(String)
    : []

  // Candidate event
  let candidateEvent: DisruptionEvent | null = null
  if (
    rawAiOutput.event &&
    typeof rawAiOutput.event === 'object' &&
    !needsClarification &&
    unknownLocations.length === 0 &&
    unknownVehicles.length === 0
  ) {
    candidateEvent = rawAiOutput.event as DisruptionEvent
  }

  // 5. Structure validation and entity boundary check
  const constructed: InterpretedDisruption = {
    rawText: text,
    event: candidateEvent,
    missing,
    unknownLocations,
    unknownVehicles,
    preview,
    confirmation: 'pending',
    source: 'ai',
    needsClarification,
    clarificationQuestion,
    explicitFields,
    inferredFields,
  }

  const validated = validateInterpretedDisruption(
    constructed,
    knownLocationIds,
    knownVehicleIds
  )

  // Ensure preview and confirmation state are strictly preserved
  return {
    ...validated,
    preview: validated.preview || preview,
    confirmation: 'pending',
    source: 'ai',
    unknownVehicles,
    needsClarification: needsClarification || validated.event === null && Boolean(clarificationQuestion),
    clarificationQuestion,
    explicitFields,
    inferredFields,
  }
}
