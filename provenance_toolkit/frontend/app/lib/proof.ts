import type { LogEntry, State } from "./types";

/**
 * The checks in this file run in the browser, on the records as the server returned them.
 * They repeat the engine's arithmetic: the hash of each log entry, the chain between
 * entries, and the Merkle tree over the study ledger (shaped as in RFC 6962).
 */

const encoder = new TextEncoder();
const FIELDS = ["action", "actor", "date", "index", "item", "previous", "purpose"] as const;
const FIRST_LINK = "0".repeat(64);
const HELD = "provenance-toolkit-checkpoint";
const BACKSLASH = String.fromCharCode(92);
const NON_ASCII = new RegExp("[" + String.fromCharCode(0x80) + "-" + String.fromCharCode(0xffff) + "]", "g");

async function sha256(bytes: Uint8Array) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

function join(...parts: Uint8Array[]) {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The SHA-256 fingerprint of a file, computed on this device. */
export async function fingerprint(file: Blob) {
  return toHex(await sha256(new Uint8Array(await file.arrayBuffer())));
}

/** A value written the way the engine writes it before hashing: JSON with every non-ASCII character escaped. */
function engineJson(value: string | number) {
  return JSON.stringify(value ?? null).replace(NON_ASCII, (character) => BACKSLASH + "u" + character.charCodeAt(0).toString(16).padStart(4, "0"));
}

/** A value written as the engine writes it before hashing: JSON with sorted keys and no spaces. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return engineJson(value as string | number);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return "{" + keys.map((key) => `${engineJson(key)}:${canonical(record[key])}`).join(",") + "}";
}

const hashText = async (text: string) => toHex(await sha256(encoder.encode(text)));

export async function entryHash(entry: LogEntry) {
  const content: Record<string, unknown> = {};
  for (const field of FIELDS) content[field] = entry[field];
  if (entry.state !== undefined) content.state = entry.state;
  return hashText(canonical(content));
}

/** The hash of everything in a manifest except its log, which the newest log entry of each save carries. */
async function stateHash(manifest: object) {
  return hashText(canonical(Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== "events"))));
}

const leafHash = (entryHashText: string) => sha256(join(Uint8Array.of(0), encoder.encode(entryHashText)));
const nodeHash = (left: Uint8Array, right: Uint8Array) => sha256(join(Uint8Array.of(1), left, right));

/** The largest power of two smaller than `count`. */
function splitPoint(count: number) {
  let split = 1;
  while (split * 2 < count) split *= 2;
  return split;
}

async function treeRoot(hashes: Uint8Array[]): Promise<Uint8Array> {
  if (hashes.length === 0) return sha256(new Uint8Array(0));
  if (hashes.length === 1) return hashes[0];
  const split = splitPoint(hashes.length);
  return nodeHash(await treeRoot(hashes.slice(0, split)), await treeRoot(hashes.slice(split)));
}

type Sibling = { side: "left" | "right"; hash: Uint8Array };

/** The sibling hashes on the way from one leaf to the root, lowest first. */
async function treePath(hashes: Uint8Array[], index: number): Promise<Sibling[]> {
  if (hashes.length <= 1) return [];
  const split = splitPoint(hashes.length);
  if (index < split) return [...(await treePath(hashes.slice(0, split), index)), { side: "right", hash: await treeRoot(hashes.slice(split)) }];
  return [...(await treePath(hashes.slice(split), index - split)), { side: "left", hash: await treeRoot(hashes.slice(0, split)) }];
}

export type TreeNode = { lo: number; hi: number; hash: string; left?: TreeNode; right?: TreeNode };

/** Every node of the ledger tree, built from the entry hashes in ledger order. Null for an empty ledger. */
export async function ledgerTree(leaves: string[]): Promise<TreeNode | null> {
  if (leaves.length === 0) return null;
  const hashes = await Promise.all(leaves.map(leafHash));
  const build = async (lo: number, hi: number): Promise<{ node: TreeNode; bytes: Uint8Array }> => {
    if (hi - lo === 1) return { node: { lo, hi, hash: toHex(hashes[lo]) }, bytes: hashes[lo] };
    const split = splitPoint(hi - lo);
    const left = await build(lo, lo + split);
    const right = await build(lo + split, hi);
    const bytes = await nodeHash(left.bytes, right.bytes);
    return { node: { lo, hi, hash: toHex(bytes), left: left.node, right: right.node }, bytes };
  };
  return (await build(0, hashes.length)).node;
}

export type HeldCheckpoint = { size: number; root: string; time: string };

export type StudyProof = {
  /** The ledger root as computed here. */
  root: string;
  size: number;
  /** What did not add up: entries whose hash or link is wrong, leaves that differ from the logs, a different root on the server. */
  faults: string[];
  /** Each checkpoint the auditor holds, and whether the ledger still extends it. */
  auditor: { size: number; date: string; holds: boolean }[];
  /** The checkpoint this browser kept from its previous look, and whether the ledger still extends it. */
  browser: (HeldCheckpoint & { holds: boolean }) | null;
  /** The entry hashes in ledger order. */
  leaves: string[];
  /** Ledger position of a log entry, by "participant#index". */
  position: Record<string, number>;
};

/** Drop the checkpoint this browser kept, so that the next look starts from the ledger as it is now. */
export function forgetHeld() {
  window.localStorage.removeItem(HELD);
}

function readHeld(): HeldCheckpoint | null {
  try {
    const held = JSON.parse(window.localStorage.getItem(HELD) ?? "null");
    return held && typeof held.size === "number" && typeof held.root === "string" ? held : null;
  } catch {
    return null;
  }
}

export async function verifyStudy(state: State): Promise<StudyProof> {
  const faults: string[] = [];
  const logs: Record<string, LogEntry[]> = {};
  for (const person of state.participants) {
    const events = person.manifest.events;
    logs[person.id] = events;
    for (let index = 0; index < events.length; index += 1) {
      const entry = events[index];
      const previous = index ? events[index - 1].hash : FIRST_LINK;
      if (entry.index !== index || entry.previous !== previous || (await entryHash(entry)) !== entry.hash) faults.push(`${person.id} #${index}`);
    }
    const newest = events[events.length - 1];
    if (newest?.state !== undefined && (await stateHash(person.manifest)) !== newest.state) faults.push(`${person.id} record`);
  }

  const leaves = state.ledger.leaves;
  const counted: Record<string, number> = {};
  const position: Record<string, number> = {};
  leaves.forEach((leaf, place) => {
    const expected = counted[leaf.participant] ?? 0;
    if (leaf.index !== expected || logs[leaf.participant]?.[expected]?.hash !== leaf.hash) faults.push(`leaf ${place}`);
    counted[leaf.participant] = expected + 1;
    position[`${leaf.participant}#${leaf.index}`] = place;
  });
  for (const [participant, events] of Object.entries(logs)) {
    if (events.length !== (counted[participant] ?? 0)) faults.push(`${participant} not in ledger`);
  }

  const hashes = await Promise.all(leaves.map((leaf) => leafHash(String(leaf.hash))));
  const root = toHex(await treeRoot(hashes));
  if (root !== state.ledger.root) faults.push("root differs from the server");
  const extends_ = async (size: number, held: string) => size <= hashes.length && toHex(await treeRoot(hashes.slice(0, size))) === held;

  const auditor = await Promise.all(state.checkpoints.map(async (mark) => ({ size: mark.size, date: mark.date, holds: await extends_(mark.size, mark.root) })));
  const held = readHeld();
  const browser = held ? { ...held, holds: await extends_(held.size, held.root) } : null;
  if (faults.length === 0 && hashes.length > 0 && (!browser || browser.holds) && (!held || held.root !== root)) {
    window.localStorage.setItem(HELD, JSON.stringify({ size: hashes.length, root, time: new Date().toISOString() }));
  }
  return { root, size: hashes.length, faults, auditor, browser, leaves: leaves.map((leaf) => String(leaf.hash)), position };
}

export type Inclusion = { leaf: string; steps: { side: "left" | "right"; sibling: string; result: string }[]; root: string };

/** Fold one leaf with its sibling hashes up to the root, keeping every intermediate value. */
export async function inclusion(leaves: string[], place: number): Promise<Inclusion> {
  const hashes = await Promise.all(leaves.map(leafHash));
  let current = hashes[place];
  const steps = [];
  for (const sibling of await treePath(hashes, place)) {
    current = sibling.side === "left" ? await nodeHash(sibling.hash, current) : await nodeHash(current, sibling.hash);
    steps.push({ side: sibling.side, sibling: toHex(sibling.hash), result: toHex(current) });
  }
  return { leaf: toHex(hashes[place]), steps, root: toHex(current) };
}
