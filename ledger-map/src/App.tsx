import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import LedgerMap, { COL, LEFT } from './Map'
import { build } from './scenario'
import type { Built, Settings } from './scenario'
import { verify } from './ledger'
import type { LedgerEvent, Verdict } from './ledger'

// #branch opens on the parent-withdraws case; #end and #altered open on the finished map (handy for screenshots)
const HASH = typeof location !== 'undefined' ? location.hash : ''
const START: Settings = { sensitive: true, firedBy: HASH === '#branch' ? 'parent' : 'teen', vendor: HASH === '#branch' ? 'silent' : 'signs' }

/** Body shown in the panel: long fingerprints shortened so the shape stays readable. */
function pretty(body: Record<string, unknown>): string {
  return JSON.stringify(body, (_, v) => (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v) ? v.slice(0, 12) + '…' : v), 2)
}

function Switch<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { id: T; text: string }[]; onChange: (v: T) => void
}) {
  return (
    <fieldset className="switch">
      <legend>{label}</legend>
      <div className="switch-row">
        {options.map((o) => (
          <button key={o.id} type="button" aria-pressed={o.id === value} onClick={() => onChange(o.id)}>{o.text}</button>
        ))}
      </div>
    </fieldset>
  )
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(START)
  const [built, setBuilt] = useState<Built | null>(null)
  const [shown, setShown] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [alteredSeq, setAlteredSeq] = useState<number | null>(null)
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [fit, setFit] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1500)
  const scroller = useRef<HTMLDivElement>(null)
  const jump = useRef(HASH)

  // rebuild the whole ledger whenever a switch changes
  useEffect(() => {
    let live = true
    setPlaying(false)
    build(settings).then((b) => {
      if (!live) return
      setBuilt(b)
      setAlteredSeq(null)
      const end = ['#end', '#altered', '#branch'].includes(jump.current)
      setShown((s) => (end ? b.nodes.length : Math.min(Math.max(s, 1), b.nodes.length)))
      if (jump.current === '#altered') setAlteredSeq(4)
      setSelected((sel) => (end ? (b.nodes.find((n) => n.id === 'authority') ?? b.nodes[b.nodes.length - 1]).id : sel && b.nodes.some((n) => n.id === sel) ? sel : b.nodes[0].id))
      jump.current = ''
    })
    return () => { live = false }
  }, [settings])

  // the events as one party sees them: the honest ledger, or a copy with one event altered
  const view: LedgerEvent[] = useMemo(() => {
    if (!built) return []
    return built.events.map((e) => (e.seq === alteredSeq ? { ...e, body: { ...e.body, altered_after_signing: true } } : e))
  }, [built, alteredSeq])

  // real verification, recomputed every time the view changes
  useEffect(() => {
    if (!built) return
    let live = true
    verify(view, built.registry).then((v) => { if (live) setVerdict(v) })
    return () => { live = false }
  }, [built, view])

  const total = built?.nodes.length ?? 0
  const step = useCallback((d: number) => {
    setShown((s) => {
      const next = Math.min(Math.max(s + d, 1), total)
      if (built) setSelected(built.nodes[next - 1].id)
      return next
    })
  }, [built, total])

  useEffect(() => {
    if (!playing) return
    if (shown >= total) { setPlaying(false); return }
    const t = setTimeout(() => step(1), 1100)
    return () => clearTimeout(t)
  }, [playing, shown, total, step])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return
      if (e.key === 'ArrowRight') step(1)
      if (e.key === 'ArrowLeft') step(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step])

  // keep the newest station in view
  useEffect(() => {
    const el = scroller.current
    const n = built?.nodes[shown - 1]
    if (!el || !n || fit) return
    const x = LEFT + n.col * COL
    if (x > el.scrollLeft + el.clientWidth - 200 || x < el.scrollLeft + 200) el.scrollTo({ left: Math.max(0, x - el.clientWidth * 0.6), behavior: 'smooth' })
  }, [shown, built, fit])

  if (!built) return <main className="app"><p className="loading">Building the ledger…</p></main>

  const node = built.nodes.find((n) => n.id === selected) ?? built.nodes[0]
  const ev = node.event
  const atEnd = shown >= total
  const failAt = verdict && !verdict.ok ? verdict.failAt : null
  const causes = node.parents.map((p) => built.nodes.find((n) => n.id === p)!.label)

  return (
    <main className="app">
      <header className="top">
        <div className="title">
          <h1>Where a donated chat log goes</h1>
          <p>Every action is one signed event. The ledger holds fingerprints of the chats, never the chats. Synthetic data; every party is simulated.</p>
        </div>
        <div className="switches">
          <Switch label="The export contains" value={settings.sensitive ? 'yes' : 'no'}
            options={[{ id: 'yes', text: 'some teen-only items' }, { id: 'no', text: 'shared items only' }]}
            onChange={(v) => setSettings({ ...settings, sensitive: v === 'yes' })} />
          <Switch label="Withdrawal is fired by" value={settings.firedBy}
            options={[{ id: 'teen', text: 'the teen' }, { id: 'parent', text: 'the parent' }]}
            onChange={(v) => setSettings({ ...settings, firedBy: v })} />
          <Switch label="The AI vendor" value={settings.vendor}
            options={[{ id: 'signs', text: 'signs receipts' }, { id: 'silent', text: 'stays silent' }]}
            onChange={(v) => setSettings({ ...settings, vendor: v })} />
        </div>
      </header>

      <section className="stage">
        <div className={`map-scroll ${fit ? 'is-fit' : ''}`} ref={scroller}>
          <LedgerMap nodes={built.nodes} shown={shown} selected={node.id} failAt={failAt} fit={fit} onSelect={setSelected} />
        </div>
      </section>

      <footer className="dock">
        <div className="transport">
          <button type="button" onClick={() => { setPlaying(false); step(-1) }} disabled={shown <= 1}>Back</button>
          <button type="button" className="primary" onClick={() => { if (atEnd) { setShown(1); setSelected(built.nodes[0].id) } setPlaying(!playing) }}>
            {playing ? 'Pause' : atEnd ? 'Replay' : 'Play'}
          </button>
          <button type="button" onClick={() => { setPlaying(false); step(1) }} disabled={atEnd}>Next</button>
          <input type="range" min={1} max={total} value={shown} aria-label="Step through the events"
            onChange={(e) => { setPlaying(false); const v = Number(e.target.value); setShown(v); setSelected(built.nodes[v - 1].id) }} />
          <span className="count">{shown} of {total}</span>
          <button type="button" onClick={() => setFit(!fit)}>{fit ? 'Zoom in' : 'Show whole map'}</button>
        </div>
        <p className={`verdict ${verdict?.ok ? 'ok' : 'bad'}`} role="status">
          {verdict === null ? 'Checking…' : verdict.ok ? `Ledger check: ${verdict.reason}.`
            : `Ledger check fails at event #${String(verdict.failAt).padStart(2, '0')}: ${verdict.reason}. Nothing after it can be trusted.`}
        </p>
      </footer>

      <section className="below">
        <aside className="panel" aria-live="polite">
          <p className="panel-kicker">{ev ? `Event #${String(ev.seq).padStart(2, '0')}, signed by ${node.signer}` : 'Not on the ledger'}</p>
          <h2>{node.label}</h2>
          <p className="panel-plain">{node.plain}</p>
          {causes.length > 0 && <p className="panel-because">Follows from: {causes.join('; ')}</p>}
          {ev && (alteredSeq === ev.seq
            ? <button type="button" className="act" onClick={() => setAlteredSeq(null)}>Restore this event</button>
            : <button type="button" className="act act-danger" onClick={() => setAlteredSeq(ev.seq)}>Alter this event in one copy</button>)}
        </aside>
        {ev && (
          <div className="record">
            <dl className="hashes">
              <dt>This event's hash</dt><dd>{ev.hash.slice(0, 32)}…</dd>
              <dt>Previous event's hash</dt><dd>{ev.prevHash.slice(0, 32)}…</dd>
              <dt>Signature</dt><dd>{ev.alg.signature}, {ev.sig.slice(0, 24)}…</dd>
            </dl>
            <pre className="body">{pretty(ev.seq === alteredSeq ? { ...ev.body, altered_after_signing: true } : ev.body)}</pre>
          </div>
        )}
      </section>

      {atEnd && (
        <section className="receipt" aria-label="Erasure receipt">
          <h2>The erasure receipt: three custodians, three different answers</h2>
          <div className="tickets">
            {built.tickets.map((t) => (
              <article key={t.custodian} className={`ticket tone-${t.tone}`}>
                <h3>{t.custodian}</h3>
                <p className="ticket-status">{t.status}</p>
                <ul>{t.lines.map((l) => <li key={l}>{l}</li>)}</ul>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
