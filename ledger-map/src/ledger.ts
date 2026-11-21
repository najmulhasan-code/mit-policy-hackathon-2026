// The ledger itself: canonical bytes, fingerprints, dataset roots, signed and chained events.
// Everything here runs in the browser with the built-in Web Crypto API. No server, no packages.

const enc = new TextEncoder()

/** Same data -> same text, whatever the key order or spacing. Text is Unicode-normalised (NFC). */
export function canonical(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v.normalize('NFC'))
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'
  const o = v as Record<string, unknown>
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k.normalize('NFC')) + ':' + canonical(o[k])).join(',') + '}'
}

const toHex = (b: ArrayBuffer | Uint8Array) =>
  [...(b instanceof Uint8Array ? b : new Uint8Array(b))].map((x) => x.toString(16).padStart(2, '0')).join('')
const fromHex = (h: string) => new Uint8Array((h.match(/../g) ?? []).map((x) => parseInt(x, 16)))

async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource))
}
export async function sha256(text: string): Promise<string> {
  return toHex(await sha256Bytes(enc.encode(text)))
}

/** A secret key held by the family. Fingerprints cannot be recomputed or guessed without it. */
export function newFingerprintKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']) as Promise<CryptoKey>
}

/** Keyed one-way fingerprint (HMAC-SHA-256). It is not encryption: the item cannot be recovered from it. */
export async function fingerprint(key: CryptoKey, item: unknown): Promise<string> {
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(canonical(item))))
}

/** One hash that stands for a whole dataset (Merkle root, RFC 6962 style, over sorted leaves). */
export async function merkleRoot(fingerprints: string[]): Promise<string> {
  const leaves = [...fingerprints].sort()
  const cat = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) { out.set(p, at); at += p.length }
    return out
  }
  const mth = async (items: string[]): Promise<Uint8Array> => {
    if (items.length === 0) return sha256Bytes(new Uint8Array())
    if (items.length === 1) return sha256Bytes(cat(new Uint8Array([0]), fromHex(items[0])))
    let k = 1
    while (k * 2 < items.length) k *= 2
    return sha256Bytes(cat(new Uint8Array([1]), await mth(items.slice(0, k)), await mth(items.slice(k))))
  }
  return toHex(await mth(leaves))
}

// ---- signatures ----

let signatureAlg: 'Ed25519' | 'ECDSA P-256' = 'Ed25519'
const signParams = (): AlgorithmIdentifier | EcdsaParams =>
  signatureAlg === 'Ed25519' ? { name: 'Ed25519' } : { name: 'ECDSA', hash: 'SHA-256' }

export type Party = { name: string; keys: CryptoKeyPair }

export async function newParty(name: string): Promise<Party> {
  let keys: CryptoKeyPair
  try {
    keys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])) as CryptoKeyPair
  } catch {
    signatureAlg = 'ECDSA P-256' // older browsers without Ed25519
    keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
  }
  return { name, keys }
}

async function sign(p: Party, hashHex: string): Promise<string> {
  return toHex(await crypto.subtle.sign(signParams(), p.keys.privateKey, fromHex(hashHex) as BufferSource))
}

// ---- events ----

export type LedgerEvent = {
  seq: number
  type: string
  at: string
  actor: string
  alg: { hash: string; fingerprint: string; signature: string }
  body: Record<string, unknown>
  /** hashes of the earlier events that authorise this one: the branching links on the map */
  causedBy: string[]
  /** hash of the event written just before this one: the chain */
  prevHash: string
  hash: string
  sig: string
  cosig: { actor: string; sig: string }[]
}

const SIGNED: (keyof LedgerEvent)[] = ['seq', 'type', 'at', 'actor', 'alg', 'body', 'causedBy', 'prevHash']
const signedPart = (e: LedgerEvent) => Object.fromEntries(SIGNED.map((k) => [k, e[k]]))

export class Ledger {
  events: LedgerEvent[] = []
  private clock = Date.UTC(2026, 10, 21, 19, 0)

  async append(type: string, actor: Party, body: Record<string, unknown>, causedBy: string[] = [], cosigners: Party[] = []) {
    this.clock += 7 * 60_000
    const e = {
      seq: this.events.length, type, at: new Date(this.clock).toISOString().replace('.000Z', 'Z'), actor: actor.name,
      alg: { hash: 'SHA-256', fingerprint: 'HMAC-SHA-256', signature: signatureAlg },
      body, causedBy, prevHash: this.events.length ? this.events[this.events.length - 1].hash : '0'.repeat(64),
    } as LedgerEvent
    e.hash = await sha256(canonical(signedPart(e)))
    e.sig = await sign(actor, e.hash)
    e.cosig = await Promise.all(cosigners.map(async (c) => ({ actor: c.name, sig: await sign(c, e.hash) })))
    this.events.push(e)
    return e
  }
}

export type Verdict = { ok: boolean; failAt: number | null; reason: string }

/** Recompute every hash, chain link, causal link and signature. */
export async function verify(events: LedgerEvent[], registry: Record<string, Party>): Promise<Verdict> {
  let prev = '0'.repeat(64)
  const seen = new Set<string>()
  for (const e of events) {
    if (e.prevHash !== prev) return { ok: false, failAt: e.seq, reason: 'its link to the previous event is broken' }
    if ((await sha256(canonical(signedPart(e)))) !== e.hash) return { ok: false, failAt: e.seq, reason: 'its content was altered after signing' }
    if (!e.causedBy.every((h) => seen.has(h))) return { ok: false, failAt: e.seq, reason: 'it cites an event that is not on the ledger' }
    for (const s of [{ actor: e.actor, sig: e.sig }, ...e.cosig]) {
      const ok = await crypto.subtle.verify(signParams(), registry[s.actor].keys.publicKey, fromHex(s.sig) as BufferSource, fromHex(e.hash) as BufferSource)
      if (!ok) return { ok: false, failAt: e.seq, reason: `the signature of ${s.actor} does not match` }
    }
    seen.add(e.hash)
    prev = e.hash
  }
  return { ok: true, failAt: null, reason: `all ${events.length} events verify` }
}
