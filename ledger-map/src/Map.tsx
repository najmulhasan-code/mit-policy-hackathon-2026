// The map: one line per custodian, one station per event, a curve wherever one event authorises another.

import { LANES } from './scenario'
import type { Lane, MapNode } from './scenario'

export const COL = 118, LANE_H = 116, LEFT = 160, TOP = 76, R = 11

const SHORT: Record<string, string> = { 'hospital research': 'research', 'hospital clinical': 'clinical', 'AI vendor': 'vendor', 'privacy officer': 'privacy officer' }

const laneIndex = (l: Lane) => LANES.findIndex((x) => x.id === l)
const xOf = (n: MapNode) => LEFT + n.col * COL
const yOf = (n: MapNode) => TOP + laneIndex(n.lane) * LANE_H

function wrap(text: string, max = 15): string[] {
  const lines: string[] = []
  let cur = ''
  for (const w of text.split(' ')) {
    if ((cur + ' ' + w).trim().length <= max) cur = (cur + ' ' + w).trim()
    else { lines.push(cur); cur = w }
  }
  if (cur) lines.push(cur)
  return lines.slice(0, 3)
}

function edgePath(a: MapNode, b: MapNode) {
  const x1 = xOf(a), y1 = yOf(a), x2 = xOf(b), y2 = yOf(b)
  if (y1 === y2) return `M ${x1} ${y1} L ${x2} ${y2}`
  const bend = Math.max(48, (x2 - x1) * 0.55)
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
}

type Props = {
  nodes: MapNode[]
  shown: number
  selected: string | null
  failAt: number | null
  /** true: scale the whole map to the width available. false: natural size, scroll sideways. */
  fit: boolean
  onSelect: (id: string) => void
}

export default function LedgerMap({ nodes, shown, selected, failAt, fit, onSelect }: Props) {
  const visible = nodes.slice(0, shown)
  const ids = new Set(visible.map((n) => n.id))
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))
  const width = LEFT + (Math.max(...nodes.map((n) => n.col)) + 1) * COL + 40
  const height = TOP + LANES.length * LANE_H - 20
  const broken = (n: MapNode) => failAt !== null && n.event !== undefined && n.event.seq >= failAt
  const newest = visible[visible.length - 1]?.id

  return (
    <svg className="map" width={fit ? '100%' : width} height={fit ? undefined : height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label="Map of ledger events by custodian">
      {LANES.map((l, i) => (
        <g key={l.id} className={`lane lane-${l.id}`}>
          <line className="lane-bed" x1={LEFT - 40} x2={width - 16} y1={TOP + i * LANE_H} y2={TOP + i * LANE_H} />
          <text className="lane-name" x={20} y={TOP + i * LANE_H - 2}>{l.name}</text>
          <text className="lane-note" x={20} y={TOP + i * LANE_H + 17}>{l.note}</text>
        </g>
      ))}

      {visible.flatMap((n) => n.parents.filter((p) => ids.has(p)).map((p) => {
        const from = byId[p]
        const cls = ['edge', `lane-${n.lane}`, n.glyph === 'ghost' || from.glyph === 'ghost' ? 'edge-ghost' : '',
          broken(n) ? 'edge-broken' : '', n.id === newest ? 'edge-new' : ''].join(' ')
        return <path key={p + '>' + n.id} className={cls} d={edgePath(from, n)} pathLength={1} />
      }))}

      {visible.map((n) => {
        const x = xOf(n), y = yOf(n)
        const cls = ['station', `lane-${n.lane}`, `glyph-${n.glyph}`, n.id === selected ? 'is-selected' : '',
          broken(n) ? 'is-broken' : '', failAt !== null && n.event?.seq === failAt ? 'is-altered' : '', n.id === newest ? 'is-new' : ''].join(' ')
        const lines = wrap(n.label)
        return (
          <g key={n.id} className={cls} transform={`translate(${x} ${y})`} tabIndex={0} role="button"
            aria-label={`${n.label}. ${n.signer}.`} aria-pressed={n.id === selected}
            onClick={() => onSelect(n.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(n.id) } }}>
            <circle className="hit" r={30} />
            {n.glyph === 'double' && <circle className="ring-outer" r={R + 6} />}
            {n.glyph === 'stop'
              ? <g><rect className="dot" x={-R} y={-R} width={R * 2} height={R * 2} rx={3} /><line className="bar" x1={-6} x2={6} y1={0} y2={0} /></g>
              : <circle className="dot" r={R} />}
            {lines.map((ln, k) => (
              <text key={k} className="station-label" y={-R - 12 - (lines.length - 1 - k) * 17}>{ln}</text>
            ))}
            <text className="station-meta" y={R + 20}>
              {n.event ? `#${String(n.event.seq).padStart(2, '0')}  ${broken(n) ? (n.event.seq === failAt ? 'altered' : 'unverified') : n.signer.split(' + ').length > 1 ? '2 signatures' : (SHORT[n.signer] ?? n.signer)}` : 'off the ledger'}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
