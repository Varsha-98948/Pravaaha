import type { Minutes } from '../types'
export const DAY_START_CLOCK = 8 * 60 // simulation minute 0 = 08:00
export const fmtTime = (m: Minutes) => { const t = DAY_START_CLOCK + m; return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` }
export const fmtWindow = (w: { start: Minutes; end: Minutes }) => `${fmtTime(w.start)}–${fmtTime(w.end)}`
export const isValidWindow = (w: { start: Minutes; end: Minutes }) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.start >= 0 && w.end > w.start
