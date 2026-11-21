// The story the map tells. All chat data is SYNTHETIC. Every party, the vendor included, is simulated.
// Three switches change which branches the flow takes.

import { Ledger, fingerprint, merkleRoot, newFingerprintKey, newParty } from './ledger'
import type { LedgerEvent, Party } from './ledger'

export type Lane = 'family' | 'vendor' | 'research' | 'clinical' | 'auditor'
export const LANES: { id: Lane; name: string; note: string }[] = [
  { id: 'family', name: 'Family', note: 'teen and parent' },
  { id: 'vendor', name: 'AI vendor', note: 'its own copy' },
  { id: 'research', name: 'Hospital research', note: 'the study copy' },
  { id: 'clinical', name: 'Hospital clinical', note: 'the health record' },
  { id: 'auditor', name: 'Auditor', note: 'independent' },
]

export type Settings = {
  /** does the export contain items only the teen controls? */
  sensitive: boolean
  firedBy: 'teen' | 'parent'
  vendor: 'signs' | 'silent'
}

export type MapNode = {
  id: string
  lane: Lane
  col: number
  label: string
  plain: string
  parents: string[]
  glyph: 'station' | 'stop' | 'ghost' | 'double'
  signer: string
  event?: LedgerEvent
}

export type Ticket = { custodian: string; status: string; tone: 'done' | 'kept' | 'open'; lines: string[] }
export type Built = { nodes: MapNode[]; events: LedgerEvent[]; registry: Record<string, Party>; tickets: Ticket[] }

type Item = { id: string; kind: 'text' | 'image'; role: string; text: string; cls: 'shared' | 'teen_only' }

function syntheticExport(sensitive: boolean): Item[] {
  const cls = sensitive ? 'teen_only' : 'shared'
  return [
    { id: 'm1', kind: 'text', role: 'user', text: 'SYNTHETIC: i cannot sleep before exams', cls: 'shared' },
    { id: 'm2', kind: 'text', role: 'assistant', text: 'SYNTHETIC: a few things that can help with sleep', cls: 'shared' },
    { id: 'm2b', kind: 'text', role: 'assistant', text: 'SYNTHETIC: regenerated answer on a hidden branch', cls: 'shared' },
    { id: 'm3', kind: 'text', role: 'user', text: 'SYNTHETIC: a question about care a minor can consent to alone', cls },
    { id: 'm4', kind: 'text', role: 'assistant', text: 'SYNTHETIC: an answer to that question', cls },
    { id: 'img1', kind: 'image', role: 'user', text: 'SYNTHETIC: stand-in for the bytes of a photo', cls: 'shared' },
  ]
}

const PURPOSES = { HRESCH: 'permit', MLTRAINING: 'deny', share_outside_hospital: 'permit' }

export async function build(s: Settings): Promise<Built> {
  const names = ['teen', 'parent', 'hospital research', 'hospital clinical', 'privacy officer', 'analyst', 'auditor', 'AI vendor']
  const registry: Record<string, Party> = {}
  for (const n of names) registry[n] = await newParty(n)
  const P = (n: string) => registry[n]
  const ledger = new Ledger()
  const nodes: MapNode[] = []
  const byId: Record<string, MapNode> = {}

  const ghost = (id: string, lane: Lane, col: number, label: string, plain: string, parents: string[] = []) => {
    const n: MapNode = { id, lane, col, label, plain, parents, glyph: 'ghost', signer: 'not on the ledger' }
    nodes.push(n); byId[id] = n
  }
  const log = async (id: string, lane: Lane, col: number, type: string, actor: string, label: string, plain: string,
    body: Record<string, unknown>, parents: string[] = [], opts: { glyph?: MapNode['glyph']; cosign?: string[] } = {}) => {
    const causes = parents.map((p) => byId[p].event?.hash).filter((h): h is string => !!h)
    const event = await ledger.append(type, P(actor), body, causes, (opts.cosign ?? []).map(P))
    const signer = [actor, ...(opts.cosign ?? [])].join(' + ')
    const n: MapNode = { id, lane, col, label, plain, parents, glyph: opts.glyph ?? (opts.cosign ? 'double' : 'station'), signer, event }
    nodes.push(n); byId[id] = n
    return event
  }

  // ---- keys and fingerprints: one key per control class, both held by the family ----
  const keys = { shared: await newFingerprintKey(), teen_only: await newFingerprintKey() }
  const items = syntheticExport(s.sensitive)
  const fp: Record<string, string> = {}
  for (const it of items) fp[it.id] = await fingerprint(keys[it.cls], { source: 'chatgpt-export', id: it.id, role: it.role, text: it.text })
  const subject = await fingerprint(keys.shared, 'participant-001')
  const idsOf = (cls: Item['cls']) => items.filter((i) => i.cls === cls).map((i) => i.id)
  const sharedIds = idsOf('shared'), teenIds = idsOf('teen_only')
  const all = items.map((i) => fp[i.id])
  const rootV1 = await merkleRoot(all)

  // ---- before the ledger ----
  ghost('vendorCopy', 'vendor', 0, 'Chats kept by the AI vendor',
    'The original conversations sit on the vendor\'s servers. Nothing about this copy is on the ledger unless the vendor chooses to sign something.')
  ghost('export', 'family', 1, 'Teen exports chat history',
    'The teen downloads their own history. The file holds every message, including edited and regenerated answers the chat window no longer shows.', ['vendorCopy'])

  // ---- donation ----
  await log('sorted', 'family', 2, 'SORTED_ON_DEVICE', 'teen', 'Sorted on the teen\'s device',
    'A tool on the teen\'s own device fingerprints each item and labels it shared or teen-only. Only the labels and fingerprints leave the device, so nobody in the pipeline reads the chats to classify them.',
    { subject, items: items.length, shared: sharedIds.length, teen_only: teenIds.length, images: 1, hidden_branch_messages: 1 }, ['export'])
  await log('canary', 'auditor', 2, 'CANARY_COMMITTED', 'auditor', 'Canary committed',
    'The auditor plants a unique marker in a consented synthetic record and commits its fingerprint, so later models can be probed for it.',
    { canary_commitment: await fingerprint(keys.shared, 'canary held by the auditor') })
  await log('assent', 'family', 3, 'ASSENT_GIVEN', 'teen', 'Teen assent',
    'The teen agrees in their own right. Research is permitted and model training is denied (purpose code MLTRAINING).',
    { subject, covers: s.sensitive ? ['shared', 'teen_only'] : ['shared'], purposes: PURPOSES }, ['sorted'])
  await log('permission', 'family', 4, 'PERMISSION_GIVEN', 'parent', s.sensitive ? 'Parent permission (shared only)' : 'Parent permission',
    s.sensitive
      ? 'The parent\'s permission covers the shared items. For teen-only items the teen\'s own consent stands alone. This follows the Massachusetts rule that some care needs only the minor\'s consent; applying it to chat data is our proposal.'
      : 'The parent gives permission for the whole donation. Nothing in this export is in the teen-only class.',
    { subject, covers: ['shared'], purposes: PURPOSES }, ['sorted'])
  await log('received', 'research', 5, 'RECEIVED', 'hospital research', 'Export received',
    'The study receives the export. The ledger records how many items arrived, their class labels and one root hash for the whole dataset.',
    { subject, source: { platform: 'ChatGPT', method: 'user data export' }, items: all.length, shared: sharedIds.length, teen_only: teenIds.length, dataset: 'study-042', root: rootV1 },
    ['assent', 'permission'])
  await log('noTraining', 'research', 6, 'TRAINING_EXCLUDED', 'hospital research', 'No-training flag',
    'Every fingerprint goes on the exclusion list before the data is used for anything.', { subject, assets: all.length, basis: 'default for minors at donation' }, ['received'])
  await log('linked', 'clinical', 6, 'LINKED_TO_EHR', 'hospital clinical', 'Linked to health record',
    'The study data is linked to the teen\'s health record. From here the link is protected health information.', { subject, dataset: 'study-042' }, ['received'])

  // ---- use ----
  const redactedFp = await fingerprint(keys.shared, { source: 'chatgpt-export', id: 'm1', role: 'user', text: 'SYNTHETIC: i cannot sleep before [REDACTED]' })
  await log('redacted', 'research', 7, 'REDACTED', 'hospital research', 'Text redacted',
    'A detail is scrubbed from one message. The ledger keeps the fingerprints before and after and a summary of the change, never the words.',
    { transform: 'detail-scrub v0.1', diff: { messages_changed: 1, characters_before: 38, characters_after: 43 }, in: fp.m1, out: redactedFp }, ['received'])
  await log('image', 'research', 8, 'IMAGE_PREPARED', 'hospital research', 'Photo prepared',
    'Location, device and time data are stripped from the photo. Two fingerprints are kept: one of the exact file, and a perceptual hash that still matches after resizing or re-saving (simulated here). A do-not-train label is written into the file.',
    { asset: fp.img1, metadata_removed: ['gps', 'device', 'capture_time'], perceptual_hash: 'simulated', label: 'cawg.training-mining: notAllowed' }, ['received'])
  await log('copied', 'research', 9, 'COPIED', 'hospital research', 'Copy made for analysis',
    'An analysis set is created. Every copy is an event, because nobody can delete a copy that was never recorded.', { from: 'study-042', to: 'analysis-set-7', assets: all.length }, ['redacted', 'image'])
  await log('accessed', 'research', 10, 'ACCESSED', 'analyst', 'Analyst access',
    'An analyst opens the analysis set. The event records who, when, for which purpose and why.', { dataset: 'analysis-set-7', purpose: 'HRESCH', reason: 'protocol aim 2, coding of sleep topics' }, ['copied'])
  await log('refused', 'research', 11, 'TRAINING_REFUSED', 'hospital research', 'Training run refused',
    'Someone tries to train a model on the dataset. The gate finds its fingerprints on the exclusion list and refuses. The refusal is itself a signed event.',
    { dataset_root: rootV1, blocked_assets: all.length }, ['noTraining', 'copied'], { glyph: 'stop' })
  await log('narrowed', 'family', 11, 'PERMISSION_CHANGED', 'teen', 'Permission narrowed',
    'The teen blocks sharing outside the hospital. The event records the old and new setting.', { subject, change: { share_outside_hospital: ['permit', 'deny'] } }, ['assent'])

  // ---- withdrawal: the branch depends on who fires it and on the class of the data ----
  const partial = s.firedBy === 'parent' && s.sensitive
  const scope = partial ? sharedIds : items.map((i) => i.id)
  const kept = partial ? teenIds : []
  const rootV2 = await merkleRoot(kept.map((id) => fp[id]))
  await log('withdraw', 'family', 12, 'WITHDRAWAL_REQUESTED', s.firedBy, s.firedBy === 'teen' ? 'Teen withdraws' : 'Parent withdraws',
    s.firedBy === 'teen'
      ? 'The teen withdraws. A teen can stop the use of any of their data alone.'
      : 'The parent withdraws. A parent can stop the use of the shared items alone.',
    { subject, scope: 'all research and training use' }, [s.firedBy === 'teen' ? 'assent' : 'permission'])
  let c = 13
  let purgeCause = 'withdraw'
  if (partial) {
    await log('authority', 'research', c, 'AUTHORITY_CHECKED', 'privacy officer', 'Authority checked by class',
      'The privacy officer compares the request with the class labels, not the content. The parent\'s authority reaches the shared items only.',
      { requester: 'parent', reaches: { shared: sharedIds.length }, does_not_reach: { teen_only: teenIds.length } }, ['withdraw'])
    c += 1
    await log('teenStays', 'family', c, 'TEEN_ONLY_CONTINUES', 'privacy officer', 'Teen-only items stay',
      'The teen has not withdrawn, so the teen-only items stay in the study. The parent is told only that the shared items were withdrawn.',
      { subject, items_continuing: teenIds.length }, ['authority'])
    purgeCause = 'authority'
  }
  await log('quarantined', 'research', c, 'QUARANTINED', 'hospital research', 'Quarantined',
    'Access is blocked at once. The purge waits one week, so a request made with a stolen credential can still be undone.',
    { subject, items: scope.length, reversible_until: '2026-11-28' }, [purgeCause])
  await log('restricted', 'clinical', c, 'RESTRICTED', 'hospital clinical', 'Clinical record restricted',
    'The clinical record is kept, because Massachusetts law requires it. Access is restricted and the research link is removed.',
    { subject, outcome: 'retained, access restricted', research_link: 'removed' }, ['withdraw'])
  await log('purged', 'research', c + 1, 'PURGED', 'hospital research', 'Research copies purged',
    'The study copy and the analysis copy are deleted. Two hospital roles sign. The dataset root before and after is recorded, and so is the date backups expire.',
    { subject, items_removed: scope.length, datasets: ['study-042', 'analysis-set-7'], root_before: rootV1, root_after: rootV2, backups_expire_by: '2027-05-20' },
    ['quarantined'], { cosign: ['privacy officer'] })

  // ---- vendor: signs, or stays silent ----
  const leakCauses = ['canary']
  if (s.vendor === 'signs') {
    await log('vReceipt', 'vendor', c, 'VENDOR_DELETION_RECEIPT', 'AI vendor', 'Vendor deletion receipt',
      'The vendor signs a receipt with a time and a request number (simulated). This is the step that does not exist today: its delete call returns no signature.',
      { subject, items_matched: scope.length, deleted_from_active_systems: true, backups_expire_by: '2027-05-20', simulated: true }, ['withdraw'])
    await log('vTraining', 'vendor', c + 1, 'VENDOR_TRAINING_ATTESTED', 'AI vendor', 'Vendor training exclusion',
      'The vendor attests that these fingerprints are excluded from its next training run (simulated). Models already trained are not changed.',
      { exclusion_list_root: await merkleRoot(scope.map((id) => fp[id])), items_excluded: scope.length, already_trained_models: 'not changed', simulated: true }, ['vReceipt'])
    leakCauses.push('vTraining')
  } else {
    await log('vSilent', 'vendor', c, 'NO_ATTESTATION', 'auditor', 'Vendor: no attestation',
      'The vendor signs nothing. The auditor records the silence, so the gap is visible instead of assumed away.',
      { subject, custodian: 'AI vendor', about: ['deletion', 'training exclusion'], outcome: 'unverified' }, ['withdraw'], { glyph: 'stop' })
  }

  // ---- checks ----
  await log('keyGone', 'family', c + 2, 'KEY_DESTROYED', s.firedBy, partial ? 'Shared-items key destroyed' : 'Family keys destroyed',
    partial
      ? 'The key for the shared items is destroyed. Their fingerprints on the ledger can no longer be tied to any text. The teen-only key is untouched.'
      : 'The family destroys its keys. The fingerprints left on the ledger can no longer be tied to any text or person.',
    { subject, keys_destroyed: partial ? ['shared'] : s.sensitive ? ['shared', 'teen_only'] : ['shared'] }, ['purged'])
  await log('leakTest', 'auditor', c + 2, 'LEAK_TEST_RUN', 'auditor', 'Canary leak test',
    'The auditor probes a later model for the canary (simulated result). A miss is weak evidence; it is not proof the data was never used.',
    { method: 'canary probe, black-box', probes: 200, canary_hits: 0, control_hits: 0, simulated: true }, leakCauses)
  await log('audited', 'auditor', c + 3, 'AUDITED', 'auditor', 'Audit: root recomputed',
    'The auditor recomputes the dataset root from what remains and checks that the withdrawn fingerprints are absent.',
    { dataset: 'study-042', root_checked: rootV2, matches_ledger: true, withdrawn_items_absent: true }, ['purged'])

  const short = (h: string) => h.slice(0, 10) + '…'
  const tickets: Ticket[] = [
    { custodian: 'Research copies', status: partial ? 'Shared items purged' : 'Purged', tone: 'done',
      lines: [`Root ${short(rootV1)} to ${short(rootV2)}`, 'Auditor recomputed the root.', 'Backups expire by 20 May 2027.',
        ...(partial ? [`${teenIds.length} teen-only items stay: the teen has not withdrawn.`] : [])] },
    { custodian: 'Clinical record', status: 'Kept, restricted', tone: 'kept',
      lines: ['Retained because the law requires it.', 'Access restricted. Research link removed.'] },
    s.vendor === 'signs'
      ? { custodian: 'AI vendor', status: 'Signed receipt', tone: 'done', lines: ['Deletion receipt and training exclusion, both signed (simulated).', 'Models already trained are not changed.'] }
      : { custodian: 'AI vendor', status: 'Not verified', tone: 'open', lines: ['No attestation was made.', 'The study cannot delete this copy.'] },
  ]
  return { nodes, events: ledger.events, registry, tickets }
}
