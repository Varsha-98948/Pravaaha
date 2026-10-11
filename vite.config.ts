import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createAiMiddleware } from './src/server/aiMiddleware'

export function aiApiPlugin(): Plugin {
  return {
    name: 'ai-api-plugin',
    configureServer(server) {
      server.middlewares.use(
        createAiMiddleware(() => {
          const env = loadEnv(server.config.mode || 'development', process.cwd(), '')
          return { ...process.env, ...env }
        })
      )
    },
    configurePreview(server) {
      server.middlewares.use(
        createAiMiddleware(() => {
          const env = loadEnv(server.config.mode || 'production', process.cwd(), '')
          return { ...process.env, ...env }
        })
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), aiApiPlugin()],
  test: { include: ['tests/**/*.test.ts'] },
})
