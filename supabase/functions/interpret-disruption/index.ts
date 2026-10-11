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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const env = Deno.env.toObject()
    const apiKey = env.AI_API_KEY || env.GEMINI_API_KEY || env.OPENAI_API_KEY || ''
    const provider = env.AI_PROVIDER || (env.OPENAI_API_KEY ? 'openai' : 'gemini')
    const model = env.AI_MODEL || (provider === 'openai' ? 'gpt-4o-mini' : 'gemini-1.5-flash')

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
