import type { InterpretedDisruption } from '../types'
export interface DisruptionInterpreter { interpret(text: string, knownLocationIds: string[]): Promise<InterpretedDisruption> }
/** Placeholder: no AI is configured, so it never produces an event. A real impl must call a backend/edge function (no keys in the browser)
 *  and return a schema-validated event. Applying always requires confirmation === 'confirmed'. */
export const placeholderInterpreter: DisruptionInterpreter = {
  async interpret(text) { return { rawText: text, event: null, missing: ['AI interpreter not configured'], unknownLocations: [], preview: 'No AI integration is configured, so this text was not interpreted. Use the quick events below.', confirmation: 'pending', source: 'placeholder' } },
}
