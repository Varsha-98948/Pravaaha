import { useState } from 'react'
import type { DeliveryPlan, Location, Vehicle } from '../types'
import { fmtTime } from '../utils/time'
import { Eye, Layers, Compass, Navigation } from 'lucide-react'

// Preserve the incoming demo layout for its known IDs. Organization-specific
// locations receive deterministic positions without importing sample records.
const knownCoordinates: Record<string, [number, number]> = {
  depot: [0, 0],
  c1: [2, 5],
  c2: [6, 3],
  c3: [8, 8],
  c4: [-4, 6],
  c5: [-6, 1],
  c6: [3, -5],
  c7: [-3, -6],
  c8: [9, -2],
}

// Brand color palette per vehicle
const VEHICLE_COLORS = [
  { stroke: '#243607', bg: 'rgba(36, 54, 7, 0.15)', text: '#243607', name: 'Primary Forest' },
  { stroke: '#91696E', bg: 'rgba(145, 105, 110, 0.18)', text: '#91696E', name: 'Secondary Terra' },
  { stroke: '#30280D', bg: 'rgba(48, 40, 13, 0.2)', text: '#30280D', name: 'Dark Umber' },
]

interface SpatialRouteCanvasProps {
  plan: DeliveryPlan
  vehicles: Vehicle[]
  locations?: Location[]
  selectedVehicleId?: string | null
  onSelectVehicle?: (id: string | null) => void
  highlightDisruption?: { from?: string; to?: string; vehicleId?: string; at?: number } | null
}

export function SpatialRouteCanvas({
  plan,
  vehicles,
  locations: organizationLocations = [],
  selectedVehicleId = null,
  onSelectVehicle,
  highlightDisruption = null,
}: SpatialRouteCanvasProps) {
  const [is3D, setIs3D] = useState(false)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)

  const xyCoords: Record<string, [number, number]> = {}
  const sortedLocations = [...organizationLocations].sort((a, b) => a.id.localeCompare(b.id))
  const depot = sortedLocations.find(location => location.kind === 'depot')
  for (const location of sortedLocations) {
    const known = knownCoordinates[location.id]
    if (known) xyCoords[location.id] = known
  }
  if (depot && !xyCoords[depot.id]) xyCoords[depot.id] = [0, 0]
  const unpositionedLocations = sortedLocations.filter(location => !xyCoords[location.id])
  unpositionedLocations.forEach((location, index) => {
    const angle = (2 * Math.PI * index) / Math.max(unpositionedLocations.length, 1) - Math.PI / 2
    const radius = 4 + (index % 3) * 1.25
    xyCoords[location.id] = [radius * Math.cos(angle), radius * Math.sin(angle)]
  })

  // Canvas bounds projection
  // X: [-7, 10] -> SVG [60, 740]
  // Y: [-7, 9]  -> SVG [440, 60] (inverted)
  const minX = -7.5
  const maxX = 10.5
  const minY = -7.5
  const maxY = 9.5
  const width = 800
  const height = 480

  const projectX = (x: number) => 60 + ((x - minX) / (maxX - minX)) * (width - 120)
  const projectY = (y: number) => height - 50 - ((y - minY) / (maxY - minY)) * (height - 100)

  // Active routes to display
  const activeRoutes = selectedVehicleId
    ? plan.routes.filter((r) => r.vehicleId === selectedVehicleId)
    : plan.routes

  // Node details
  const activeNodeInfo = selectedNode || hoveredNode

  return (
    <div className="relative rounded-2xl border border-[#30280D]/12 bg-gradient-to-b from-[#f8f9f4] via-[#f1f3e9] to-[#e8ebe0] p-4 shadow-spatial-md overflow-hidden">
      {/* Tactical Canvas Controls Toolbar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-[#30280D]/10 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#243607] text-[#f2f3ec] shadow-sm">
            <Compass size={15} />
          </div>
          <div>
            <span className="text-xs font-bold tracking-tight text-[#30280D] uppercase">
              Spatial Network Visualization
            </span>
            <span className="ml-2 text-[11px] text-[#30280D]/60 hidden sm:inline">
              {organizationLocations.length} Waypoints · {plan.routes.length} Vehicle Trajectories
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Vehicle Filter Selector Chips */}
          <div className="flex items-center gap-1 bg-[#BBBEA7]/25 p-1 rounded-lg border border-[#30280D]/10">
            <button
              onClick={() => onSelectVehicle?.(null)}
              className={`px-2 py-0.5 text-xs font-medium rounded transition-all ${
                selectedVehicleId === null
                  ? 'bg-[#243607] text-[#f2f3ec] shadow-sm'
                  : 'text-[#30280D]/75 hover:bg-white/60'
              }`}
            >
              All Fleet
            </button>
            {vehicles.map((v, i) => {
              const color = VEHICLE_COLORS[i % VEHICLE_COLORS.length]
              const isSelected = selectedVehicleId === v.id
              return (
                <button
                  key={v.id}
                  onClick={() => onSelectVehicle?.(isSelected ? null : v.id)}
                  className={`flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded transition-all ${
                    isSelected
                      ? 'bg-white text-[#30280D] shadow-sm border border-[#30280D]/20 font-semibold'
                      : 'text-[#30280D]/75 hover:bg-white/60'
                  }`}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: color.stroke }}
                  />
                  {v.name}
                </button>
              )
            })}
          </div>

          {/* 3D Perspective Toggle Button */}
          <button
            onClick={() => setIs3D(!is3D)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all shadow-sm ${
              is3D
                ? 'bg-[#30280D] text-[#f2f3ec] border-[#30280D]'
                : 'bg-white/90 text-[#30280D] border-[#30280D]/20 hover:bg-[#BBBEA7]/30'
            }`}
          >
            <Layers size={13} />
            <span>{is3D ? 'Spatial 3D' : 'Tactical 2D'}</span>
          </button>
        </div>
      </div>

      {/* Spatial Canvas Container with Perspective Transform */}
      <div
        className={`relative w-full overflow-hidden rounded-xl border border-[#30280D]/10 bg-white/70 transition-transform duration-500 ease-out perspective-1200 ${
          is3D ? 'shadow-spatial-lg' : 'shadow-spatial-inset'
        }`}
        style={{ minHeight: '420px' }}
      >
        {/* Subtle Spatial Coordinate Grid Background */}
        <div
          className="absolute inset-0 pointer-events-none opacity-40"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgba(48,40,13,0.15) 1px, transparent 1px), linear-gradient(to right, rgba(48,40,13,0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(48,40,13,0.03) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />

        {/* 3D Transform Plane */}
        <div
          className="w-full h-full transition-transform duration-500 ease-out transform-style-3d origin-center"
          style={{
            transform: is3D ? 'rotateX(28deg) rotateZ(-4deg) translateY(-10px) scale(0.96)' : 'none',
          }}
        >
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-auto max-h-[460px] select-none"
            style={{ filter: is3D ? 'drop-shadow(0 25px 20px rgba(48,40,13,0.18))' : 'none' }}
          >
            <defs>
              {/* Subtle Route Shadows */}
              <filter id="routeShadow" x="-10%" y="-10%" width="130%" height="130%">
                <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#30280D" floodOpacity="0.18" />
              </filter>
              <filter id="nodeShadow" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#30280D" floodOpacity="0.22" />
              </filter>
            </defs>

            {/* Background Network Connectivity Grid Lines */}
            <g opacity="0.12" stroke="#30280D" strokeWidth="1" strokeDasharray="3 3">
              {Object.keys(xyCoords).map((fromId, idx) => {
                const [fx, fy] = xyCoords[fromId]
                return Object.keys(xyCoords)
                  .slice(idx + 1)
                  .map((toId) => {
                    const [tx, ty] = xyCoords[toId]
                    return (
                      <line
                        key={`${fromId}-${toId}`}
                        x1={projectX(fx)}
                        y1={projectY(fy)}
                        x2={projectX(tx)}
                        y2={projectY(ty)}
                      />
                    )
                  })
              })}
            </g>

            {/* Road Closure Highlight (if applicable) */}
            {highlightDisruption?.from && highlightDisruption?.to && xyCoords[highlightDisruption.from] && xyCoords[highlightDisruption.to] && (
              <g>
                <line
                  x1={projectX(xyCoords[highlightDisruption.from][0])}
                  y1={projectY(xyCoords[highlightDisruption.from][1])}
                  x2={projectX(xyCoords[highlightDisruption.to][0])}
                  y2={projectY(xyCoords[highlightDisruption.to][1])}
                  stroke="#91696E"
                  strokeWidth="8"
                  strokeLinecap="round"
                  opacity="0.35"
                  className="secondary-pulse"
                />
                <line
                  x1={projectX(xyCoords[highlightDisruption.from][0])}
                  y1={projectY(xyCoords[highlightDisruption.from][1])}
                  x2={projectX(xyCoords[highlightDisruption.to][0])}
                  y2={projectY(xyCoords[highlightDisruption.to][1])}
                  stroke="#91696E"
                  strokeWidth="3"
                  strokeDasharray="6 4"
                />
              </g>
            )}

            {/* Vehicle Route Trajectories */}
            {activeRoutes.map((route) => {
              const vIdx = vehicles.findIndex((v) => v.id === route.vehicleId)
              const color = VEHICLE_COLORS[Math.max(0, vIdx) % VEHICLE_COLORS.length]
              const isSelected = selectedVehicleId === route.vehicleId

              // Path points: depot -> stops in order -> depot
              const vehicle = vehicles.find(item => item.id === route.vehicleId)
              const depotPoint = (vehicle && xyCoords[vehicle.depotId]) || [0, 0] as [number, number]
              const points: Array<[number, number]> = [depotPoint]
              route.stops.forEach((s) => {
                if (xyCoords[s.locationId]) {
                  points.push(xyCoords[s.locationId])
                }
              })
              // Route closes back at depot
              points.push(depotPoint)

              // Build path d string
              const pathD = points
                .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${projectX(pt[0])} ${projectY(pt[1])}`)
                .join(' ')

              return (
                <g key={route.vehicleId} filter="url(#routeShadow)">
                  {/* Outer Trajectory Halo */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke={color.stroke}
                    strokeWidth={isSelected ? '6' : '3.5'}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={selectedVehicleId && !isSelected ? '0.15' : isSelected ? '0.95' : '0.75'}
                    className="transition-all duration-300"
                  />

                  {/* Directional Dash Flow Overlay */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeDasharray="4 12"
                    opacity={selectedVehicleId && !isSelected ? '0' : '0.7'}
                  />

                  {/* Animated Vehicle Pulse Head on Route */}
                  {points.length > 1 && (
                    <circle
                      cx={projectX(points[1][0])}
                      cy={projectY(points[1][1])}
                      r="4"
                      fill={color.stroke}
                      className="spatial-pulse"
                    />
                  )}
                </g>
              )
            })}

            {/* Waypoint Nodes (Customers & Depot) */}
            {organizationLocations.map((loc) => {
              const coords = xyCoords[loc.id]
              if (!coords) return null

              const px = projectX(coords[0])
              const py = projectY(coords[1])
              const isDepot = loc.kind === 'depot'
              const isHovered = hoveredNode === loc.id
              const isSelected = selectedNode === loc.id

              return (
                <g
                  key={loc.id}
                  className="cursor-pointer transition-transform duration-200"
                  onMouseEnter={() => setHoveredNode(loc.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  onClick={() => setSelectedNode(selectedNode === loc.id ? null : loc.id)}
                  filter="url(#nodeShadow)"
                >
                  {/* Subtle Node Hover Ring */}
                  {(isHovered || isSelected) && (
                    <circle
                      cx={px}
                      cy={py}
                      r={isDepot ? 22 : 18}
                      fill="none"
                      stroke={isDepot ? '#243607' : '#91696E'}
                      strokeWidth="2"
                      opacity="0.6"
                      className="spatial-pulse"
                    />
                  )}

                  {/* Node Base Disc */}
                  <circle
                    cx={px}
                    cy={py}
                    r={isDepot ? 14 : 10}
                    fill={isDepot ? '#243607' : '#ffffff'}
                    stroke={isDepot ? '#f2f3ec' : '#30280D'}
                    strokeWidth={isDepot ? '2.5' : '2'}
                  />

                  {/* Center Dot or Symbol */}
                  <circle
                    cx={px}
                    cy={py}
                    r={isDepot ? 5 : 3.5}
                    fill={isDepot ? '#BBBEA7' : '#91696E'}
                  />

                  {/* Node Label Card Pill */}
                  <g transform={`translate(${px}, ${py + (isDepot ? 22 : 18)})`}>
                    <rect
                      x="-42"
                      y="-10"
                      width="84"
                      height="20"
                      rx="6"
                      fill={isDepot ? '#30280D' : '#ffffff'}
                      stroke="#30280D"
                      strokeWidth="1"
                      strokeOpacity="0.15"
                      fillOpacity={isDepot ? '0.95' : '0.9'}
                    />
                    <text
                      textAnchor="middle"
                      y="4"
                      fontSize="9.5"
                      fontWeight="600"
                      fill={isDepot ? '#f2f3ec' : '#30280D'}
                      letterSpacing="-0.2px"
                    >
                      {loc.name.length > 14 ? loc.name.slice(0, 12) + '…' : loc.name}
                    </text>
                  </g>
                </g>
              )
            })}
          </svg>
        </div>

        {/* Floating Spatial Inspection Panel */}
        {activeNodeInfo && (
          <div className="absolute top-4 right-4 z-20 w-64 rounded-xl border border-[#30280D]/15 bg-white/95 p-3.5 shadow-spatial-lg backdrop-blur-md animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-[#30280D]/10 pb-2">
              <span className="text-xs font-bold text-[#30280D]">
                {organizationLocations.find(location => location.id === activeNodeInfo)?.name ?? activeNodeInfo}
              </span>
              <span className="rounded bg-[#243607]/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#243607]">
                ID: {activeNodeInfo}
              </span>
            </div>

            <div className="mt-2 text-xs space-y-1.5 text-[#30280D]/80">
              <div className="flex justify-between">
                <span className="text-[#30280D]/60">Location Type:</span>
                <span className="font-semibold capitalize">
                  {organizationLocations.find((location) => location.id === activeNodeInfo)?.kind ?? 'Unknown'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#30280D]/60">Coordinates:</span>
                <span className="font-mono text-[11px]">
                  [{xyCoords[activeNodeInfo]?.[0] ?? 0}, {xyCoords[activeNodeInfo]?.[1] ?? 0}]
                </span>
              </div>

              {/* Visited stops at this location across active routes */}
              <div className="pt-1.5 border-t border-[#30280D]/06">
                <span className="text-[11px] font-semibold text-[#30280D]/70 block mb-1">
                  Scheduled Vehicle Visits:
                </span>
                {plan.routes.flatMap((r) =>
                  r.stops
                    .filter((s) => s.locationId === activeNodeInfo)
                    .map((s) => ({ ...s, vehicleId: r.vehicleId }))
                ).length > 0 ? (
                  <div className="space-y-1 max-h-24 overflow-y-auto">
                    {plan.routes.flatMap((r) =>
                      r.stops
                        .filter((s) => s.locationId === activeNodeInfo)
                        .map((s) => {
                          const v = vehicles.find((v) => v.id === r.vehicleId)
                          return (
                            <div
                              key={s.deliveryId}
                              className="flex items-center justify-between rounded bg-[#f2f3ec] px-2 py-1 text-[11px]"
                            >
                              <span className="font-medium text-[#243607]">
                                {v?.name ?? r.vehicleId}
                              </span>
                              <span>Arr {fmtTime(s.arrival)}</span>
                            </div>
                          )
                        })
                    )}
                  </div>
                ) : (
                  <span className="text-[11px] text-[#30280D]/50 italic">
                    {organizationLocations.find(location => location.id === activeNodeInfo)?.kind === 'depot' ? 'Depot Hub Origin/Terminus' : 'No visits scheduled in current plan'}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tactical Map Orientation Watermark */}
        <div className="absolute bottom-3 left-4 flex items-center gap-1.5 text-[10px] font-bold text-[#30280D]/40 uppercase tracking-widest pointer-events-none">
          <Navigation size={12} className="text-[#243607]/50 -rotate-45" />
          <span>Metric Grid · Simulated Coordinate Frame</span>
        </div>
      </div>
    </div>
  )
}
