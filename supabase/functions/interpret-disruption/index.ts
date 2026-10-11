/**
 * Supabase Edge Function: interpret-disruption
 *
 * Provides natural-language disruption interpretation for serverless Supabase deployments.
 * Reads AI_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY from Supabase Function secrets.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const verifiedFreeModels = new Set([
  'apodex/apodex-1.1-mini:free',
  'openrouter/free',
])

function parseAllowlist(raw?: string): string[] {
  const values = (raw || 'apodex/apodex-1.1-mini:free,openrouter/free')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return values.filter((value, index) => values.indexOf(value) === index)
}

function isApprovedFreeModel(model: string, allowlist: string[]): boolean {
  return allowlist.includes(model) && verifiedFreeModels.has(model)
}

function isModelUnavailable(status: number, body: string): boolean {
  const lower = body.toLowerCase()
  return status === 404 || lower.includes('no endpoints found') || lower.includes('model not found') || lower.includes('unsupported model') || lower.includes('does not support feature')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const env = Deno.env.toObject()
    const openrouterKeys = [
      env.OPENROUTER_API_KEY_1,
      env.OPENROUTER_API_KEY_2,
      env.OPENROUTER_API_KEY_3,
      env.OPENROUTER_API_KEY,
    ].filter(Boolean) as string[]

    const apiKey = openrouterKeys[0] || env.AI_API_KEY || env.GEMINI_API_KEY || env.OPENAI_API_KEY || ''
    const provider = env.AI_PROVIDER || (openrouterKeys.length > 0 ? 'openrouter' : (env.OPENAI_API_KEY ? 'openai' : 'gemini'))
    const model = env.AI_MODEL || env.OPENROUTER_FREE_MODEL || (provider === 'openrouter' ? 'apodex/apodex-1.1-mini:free' : (provider === 'openai' ? 'gpt-4o-mini' : 'gemini-1.5-flash'))

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          rawText: '',
          event: null,
          missing: ['AI interpreter not configured in Edge Function environment.'],
          unknownLocations: [],
          preview: 'No AI integration is configured on the backend Edge Function.',
          confirmation: 'pending',
          source: 'placeholder',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    const { text, knownLocations = [], knownVehicles = [], currentTime = 0 } = await req.json()

    // OpenRouter Free Model API call with key failover
    if (provider === 'openrouter') {
      const allowlist = parseAllowlist(env.OPENROUTER_FREE_MODEL_ALLOWLIST)
      const modelSequence = [model, ...allowlist]
        .map((value) => value.trim())
        .filter((value, index, values) => values.indexOf(value) === index)
        .filter((value) => isApprovedFreeModel(value, allowlist))

      if (env.OPENROUTER_PAID_FALLBACK_ENABLED === 'true' || !isApprovedFreeModel(model, allowlist)) {
        return new Response(
          JSON.stringify({
            rawText: '',
            event: null,
            missing: ['The AI model configuration is not approved for free-only use.'],
            unknownLocations: [],
            unknownVehicles: [],
            preview: 'AI Interpreter Error: The AI model configuration is not approved for free-only use.',
            confirmation: 'pending',
            source: 'ai',
            error: 'The AI model configuration is not approved for free-only use.',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }

      const systemPrompt = `You are the Pravaaha ReRoute AI Disruption Interpreter. Convert natural language into a single JSON object.
Simulation minute 0 is 08:00 AM. Current simulation minute is ${currentTime}.
Supported event types: "road_closure" (needs distinct known from & to), "vehicle_failure" (needs known vehicleId), "urgent_delivery" (needs known locationId, size, serviceMin, window start/end).
Known Locations: ${JSON.stringify(knownLocations)}
Known Vehicles: ${JSON.stringify(knownVehicles)}
If unknown locations or unsupported events (like traffic slowdowns), set event: null, needsClarification: true.
Output JSON format: { eventType, event, preview, missing: [], unknownLocations: [], unknownVehicles: [], needsClarification: boolean, clarificationQuestion: string | null }`

      let lastError: Error | null = null
      let parsedResult: any = null

      for (const currentModel of modelSequence) {
        let currentModelUnavailable = false

        for (const currentKey of openrouterKeys.length > 0 ? openrouterKeys : [apiKey]) {
          try {
            const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${currentKey}`,
                'HTTP-Referer': 'https://reroute.local',
                'X-Title': 'ReRoute AI Disruption Interpreter',
              },
              body: JSON.stringify({
                model: currentModel,
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: `Dispatcher report: "${text}"` },
                ],
                response_format: { type: 'json_object' },
                temperature: 0.1,
              }),
            })

            if (!res.ok) {
              const errorBody = await res.text().catch(() => '')
              if (isModelUnavailable(res.status, errorBody)) {
                currentModelUnavailable = true
                lastError = new Error('The configured free AI model is currently unavailable.')
                break
              }
              throw new Error(`OpenRouter returned status ${res.status}: ${res.statusText}`)
            }

            const data = await res.json()
            const candidateText = data.choices?.[0]?.message?.content || '{}'
            parsedResult = JSON.parse(candidateText)
            break
          } catch (err: unknown) {
            lastError = err as Error
          }
        }

        if (parsedResult) {
          break
        }
        if (!currentModelUnavailable) break
      }

      if (!parsedResult) {
        throw lastError || new Error('All OpenRouter keys failed.')
      }

      return new Response(
        JSON.stringify({
          rawText: text,
          event: parsedResult.event || null,
          missing: parsedResult.missing || [],
          unknownLocations: parsedResult.unknownLocations || [],
          unknownVehicles: parsedResult.unknownVehicles || [],
          preview: parsedResult.preview || 'Interpreted disruption report.',
          confirmation: 'pending',
          source: 'ai',
          needsClarification: Boolean(parsedResult.needsClarification),
          clarificationQuestion: parsedResult.clarificationQuestion || undefined,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // Gemini API call
    if (provider === 'gemini') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
      const systemPrompt = `You are the Pravaaha ReRoute AI Disruption Interpreter. Convert natural language into a single JSON object.
Simulation minute 0 is 08:00 AM. Current simulation minute is ${currentTime}.
Supported event types: "road_closure" (needs distinct known from & to), "vehicle_failure" (needs known vehicleId), "urgent_delivery" (needs known locationId, size, serviceMin, window start/end).
Known Locations: ${JSON.stringify(knownLocations)}
Known Vehicles: ${JSON.stringify(knownVehicles)}
If unknown locations or unsupported events (like traffic slowdowns), set event: null, needsClarification: true.
Output JSON format: { eventType, event, preview, missing: [], unknownLocations: [], unknownVehicles: [], needsClarification: boolean, clarificationQuestion: string | null }`

      const payload = {
        contents: [{ parts: [{ text: `${systemPrompt}\n\nDispatcher report: "${text}"` }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        throw new Error(`Gemini API returned ${res.status}: ${res.statusText}`)
      }

      const data = await res.json()
      const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
      const parsed = JSON.parse(candidateText)

      return new Response(
        JSON.stringify({
          rawText: text,
          event: parsed.event || null,
          missing: parsed.missing || [],
          unknownLocations: parsed.unknownLocations || [],
          unknownVehicles: parsed.unknownVehicles || [],
          preview: parsed.preview || 'Interpreted disruption report.',
          confirmation: 'pending',
          source: 'ai',
          needsClarification: Boolean(parsed.needsClarification),
          clarificationQuestion: parsed.clarificationQuestion || undefined,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    return new Response(
      JSON.stringify({ error: `Provider ${provider} not supported on Edge Function.` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  } catch (err: unknown) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
