import type { InterpretedDisruption } from '../types'
import type { AiStatusResult } from './aiProvider'
export type { AiStatusResult } from './aiProvider'

export interface InterpreterContext {
  knownVehicles?: Array<{ id: string; name?: string }> | string[]
  locations?: Array<{ id: string; name?: string }>
  currentTime?: number
}

export interface DisruptionInterpreter {
  interpret(
    text: string,
    knownLocationIds: string[],
    context?: InterpreterContext
  ): Promise<InterpretedDisruption>
}

/**
 * Checks whether the backend AI provider is configured and available.
 */
export async function getAiInterpreterStatus(
  statusEndpoint = '/api/ai-status'
): Promise<AiStatusResult> {
  try {
    const res = await fetch(statusEndpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })

    if (!res.ok) {
      return {
        configured: false,
        provider: null,
        model: null,
        missingConfig: [`Server returned ${res.status}: ${res.statusText}`],
      }
    }

    const data = (await res.json()) as AiStatusResult
    return data
  } catch (err: unknown) {
    return {
      configured: false,
      provider: null,
      model: null,
      missingConfig: ['Backend server is unreachable. Check that the dev server is running.'],
      error: (err as Error).message,
    }
  }
}

/**
 * Backend-connected Disruption Interpreter.
 * Communicates with backend / edge function so credentials never touch the browser.
 */
export class HttpDisruptionInterpreter implements DisruptionInterpreter {
  constructor(private readonly endpoint: string = '/api/interpret-disruption') {}

  async interpret(
    text: string,
    knownLocationIds: string[],
    context?: InterpreterContext
  ): Promise<InterpretedDisruption> {
    try {
      const payload = {
        text,
        knownLocations: context?.locations || knownLocationIds,
        knownVehicles: context?.knownVehicles || [],
        currentTime: context?.currentTime || 0,
      }

      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const errorText = await res.text().catch(() => '')
        return {
          rawText: text,
          event: null,
          missing: [`Backend endpoint error (${res.status}): ${errorText || res.statusText}`],
          unknownLocations: [],
          unknownVehicles: [],
          preview: `AI interpreter communication error (${res.status}).`,
          confirmation: 'pending',
          source: 'placeholder',
          error: `HTTP ${res.status}: ${errorText || res.statusText}`,
        }
      }

      const interpretation = (await res.json()) as InterpretedDisruption
      return interpretation
    } catch (err: unknown) {
      const msg = (err as Error).message || 'Failed to reach AI interpretation endpoint.'
      return {
        rawText: text,
        event: null,
        missing: [msg],
        unknownLocations: [],
        unknownVehicles: [],
        preview: `Unable to connect to AI interpreter: ${msg}`,
        confirmation: 'pending',
        source: 'placeholder',
        error: msg,
      }
    }
  }
}

/**
 * Default HTTP disruption interpreter communicating with backend API.
 */
export const defaultDisruptionInterpreter = new HttpDisruptionInterpreter()

/**
 * Placeholder interpreter: for offline demo fallback or testing without AI backend.
 */
export const placeholderInterpreter: DisruptionInterpreter = {
  async interpret(text) {
    return {
      rawText: text,
      event: null,
      missing: ['AI interpreter not configured'],
      unknownLocations: [],
      unknownVehicles: [],
      preview: 'No AI integration is configured, so this text was not interpreted. Use the quick events below.',
      confirmation: 'pending',
      source: 'placeholder',
    }
  },
}
