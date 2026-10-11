/**
 * Vite Dev & Preview Server Middleware for AI Disruption Interpretation.
 *
 * Runs exclusively in Node.js server context, reading backend environment
 * variables securely without leaking keys to the client bundle.
 */

import {
  interpretDisruptionWithAi,
  resolveAiConfig,
  type LocationInfo,
  type VehicleInfo,
} from '../services/aiProvider'

export interface ServerRequest {
  url?: string
  method?: string
  on(event: string, listener: (...args: any[]) => void): any
  destroy(): void
}

export interface ServerResponse {
  setHeader(name: string, value: string): void
  statusCode: number
  end(chunk?: string): void
}

/**
 * Reads JSON body from an incoming HTTP request stream.
 */
function readJsonBody(req: ServerRequest): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: any) => {
      body += String(chunk)
      // Guard against oversized payload (max 1MB)
      if (body.length > 1e6) {
        req.destroy()
        reject(new Error('Payload too large.'))
      }
    })
    req.on('end', () => {
      if (!body.trim()) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(body))
      } catch {
        reject(new Error('Invalid JSON in request body.'))
      }
    })
    req.on('error', reject)
  })
}

function getSystemEnv(): Record<string, string | undefined> {
  const g = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }
  return (typeof g.process !== 'undefined' && g.process.env) ? g.process.env : {}
}

/**
 * Creates Connect-compatible middleware for AI API endpoints.
 */
export function createAiMiddleware(
  getEnv: () => Record<string, string | undefined> = getSystemEnv
) {
  return async (req: ServerRequest, res: ServerResponse, next: () => void) => {
    const url = req.url?.split('?')[0] || ''

    if (url === '/api/ai-status' && req.method === 'GET') {
      const env = getEnv()
      const { status } = resolveAiConfig(env)
      res.setHeader('Content-Type', 'application/json')
      res.statusCode = 200
      res.end(JSON.stringify(status))
      return
    }

    if (url === '/api/interpret-disruption' && req.method === 'POST') {
      const env = getEnv()
      const { config } = resolveAiConfig(env)

      try {
        const body = await readJsonBody(req)
        const text = typeof body.text === 'string' ? body.text : ''
        const knownLocations = (body.knownLocations || []) as LocationInfo[] | string[]
        const knownVehicles = (body.knownVehicles || []) as VehicleInfo[] | string[]
        const currentTime = typeof body.currentTime === 'number' ? body.currentTime : 0

        const result = await interpretDisruptionWithAi({
          text,
          knownLocations,
          knownVehicles,
          currentTime,
          config,
        })

        res.setHeader('Content-Type', 'application/json')
        res.statusCode = 200
        res.end(JSON.stringify(result))
      } catch (err: unknown) {
        res.setHeader('Content-Type', 'application/json')
        res.statusCode = 500
        res.end(
          JSON.stringify({
            rawText: '',
            event: null,
            missing: [(err as Error).message || 'Internal server error'],
            unknownLocations: [],
            unknownVehicles: [],
            preview: `Server Error: ${(err as Error).message}`,
            confirmation: 'pending',
            source: 'placeholder',
            error: (err as Error).message,
          })
        )
      }
      return
    }

    next()
  }
}
