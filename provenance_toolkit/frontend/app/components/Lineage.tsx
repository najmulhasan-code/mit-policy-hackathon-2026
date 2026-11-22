"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { fileName, fileSize, shortHash } from "../lib/api";
import { useSelection } from "../lib/files";
import type { Finding, Item, Person, Waiting } from "../lib/types";
import { AlertIcon, BuildingIcon, ChartIcon, CheckIcon, CrossIcon, DatasetIcon, FileIcon, ImageIcon, LockIcon, QuestionIcon, RecordIcon, TrashIcon } from "./Icons";

type Tone = "plain" | "good" | "warn" | "bad" | "gone" | "outside";

type FlowNode = {
  id: string;
  column: number;
  title: string;
  detail: string;
  mono?: boolean;
  tone: Tone;
  state: string;
  icon: ReactNode;
  mark?: ReactNode;
  /** The item holds protected health information. */
  phi?: boolean;
  /** The stage of the flow this node belongs to. It heads the node's column. */
  stage: string;
  /** What is shown about the node when it is chosen: pairs of a name and a value. */
  facts: [string, string][];
  /** The log entry that recorded the node, for the link to the ledger. */
  entry?: number;
};

/* Sizes of the layout. Widths are in layout units, drawn as shares of the canvas width. Heights are in pixels. */
const WIDTH = 208;
const HEIGHT = 56;
const GAP_X = 40;
const GAP_Y = 12;
const CAPTION = 28;
/* The narrowest and widest a column is drawn, in pixels, for a node and for the gap beside it. */
const NARROW = { node: 160, gap: 32 };
const WIDE = { node: 260, gap: 50 };

const IMAGE = /\.(png|jpe?g|gif|webp)$/i;

function fileIcon(name: string) {
  return IMAGE.test(name) ? <ImageIcon /> : <FileIcon />;
}

function capital(text: string) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** A donation the study has not received yet: where each file came from and the files themselves. */
function submittedFlow(waiting: Waiting) {
  const nodes: FlowNode[] = [];
  const edges: [string, string][] = [];
  for (const file of waiting.files) {
    const origin = `origin:${file.holder}`;
    if (!nodes.some((node) => node.id === origin)) {
      nodes.push({ id: origin, column: 0, title: file.holder, detail: file.platform, tone: "outside", state: "outside the hospital, cannot be verified", icon: <BuildingIcon />, mark: <QuestionIcon size={16} />, stage: "Source",
                   facts: [["Organisation", file.holder], ["Platform", file.platform], ["Its copy", "outside the hospital, cannot be verified"]] });
    }
    nodes.push({ id: file.file, column: 1, title: file.file, detail: fileSize(file.bytes), tone: "plain", state: "submitted", icon: fileIcon(file.file), stage: "Submitted",
                 facts: [["File", file.file], ["Platform", file.platform], ["Size", fileSize(file.bytes)], ["Fingerprint", file.sha256 ?? ""], ["Status", "submitted, waiting to be received"]] });
    edges.push([origin, file.file]);
  }
  return { nodes, edges };
}

/** Every item the study holds, the place each one came from, and the findings computed from them. */
function receivedFlow(person: Person, findings: Finding[]) {
  const nodes: FlowNode[] = [];
  const edges: [string, string][] = [];
  const stored = new Map(person.storage.map((file) => [file.path, file]));

  const byId = new Map(person.manifest.items.map((item) => [item.id, item]));

  const itemNode = (item: Item, column: number): FlowNode => {
    const name = fileName(item.path);
    const icon = item.kind === "clinical record" ? <RecordIcon /> : item.kind === "derived dataset" ? <DatasetIcon /> : fileIcon(name);
    const phi = item.kind === "clinical record" || item.contains_phi === true;
    const stage = item.derived_from.length === 0 ? "Received" : capital(item.activity);
    const made = item.derived_from.map((parent) => fileName(byId.get(parent)?.path ?? parent)).join(", ");
    const facts: [string, string][] = [
      ["File", name],
      ["Kind", item.kind],
      ["Fingerprint", item.sha256],
      ["Size", fileSize(item.bytes)],
      ["Recorded", `${item.recorded} by ${item.recorded_by}`],
      ...(made ? ([["Made from", made]] as [string, string][]) : []),
      ["Retention", item.retention],
    ];
    const entry = person.manifest.events.find((event) => event.item === item.id)?.index;
    const base = { id: item.id, column, title: name, detail: shortHash(item.sha256, 16), mono: true, icon, phi, stage, facts, entry };
    if (item.status === "deleted") return { ...base, tone: "gone", state: "deleted", mark: <TrashIcon size={16} /> };
    const file = stored.get(item.path);
    if (!file) return { ...base, tone: "bad", state: "missing from storage", mark: <CrossIcon size={16} /> };
    if (!file.matches) return { ...base, tone: "bad", state: "altered", mark: <CrossIcon size={16} /> };
    if (item.status === "access-restricted") return { ...base, tone: "warn", state: "kept, access restricted", mark: <LockIcon size={16} /> };
    return { ...base, tone: "good", state: "verified", mark: <CheckIcon size={16} /> };
  };

  const depth = (item: Item): number => (item.derived_from.length === 0 ? 0 : 1 + Math.max(...item.derived_from.map((parent) => (byId.has(parent) ? depth(byId.get(parent)!) : 0))));
  const deepest = Math.max(0, ...person.manifest.items.map(depth));

  for (const item of person.manifest.items) {
    if (item.derived_from.length > 0) {
      nodes.push(itemNode(item, 1 + depth(item)));
      item.derived_from.forEach((parent) => edges.push([parent, item.id]));
      continue;
    }
    const origin = `origin:${item.source.holder}`;
    if (!nodes.some((node) => node.id === origin)) {
      const inside = item.kind === "clinical record";
      nodes.push(
        inside
          ? { id: origin, column: 0, title: capital(item.source.holder), detail: "Health record", tone: "plain", state: "source", icon: <BuildingIcon />, stage: "Source",
              facts: [["Organisation", capital(item.source.holder)], ["Holds", "the health record"]] }
          : { id: origin, column: 0, title: capital(item.source.holder), detail: capital(item.source.platform), tone: "outside", state: "outside the hospital, cannot be verified", icon: <BuildingIcon />, mark: <QuestionIcon size={16} />, stage: "Source",
              facts: [["Organisation", capital(item.source.holder)], ["Platform", capital(item.source.platform)], ["Its copy", "outside the hospital, cannot be verified"]] },
      );
    }
    nodes.push(itemNode(item, 1));
    edges.push([origin, item.id]);
  }

  for (const finding of findings) {
    const inputs = finding.inputs.filter((input) => input.participant === person.id);
    if (inputs.length === 0) continue;
    const tone: Tone = finding.status === "current" ? "good" : finding.status === "outdated" ? "bad" : "gone";
    const mark = finding.status === "current" ? <CheckIcon size={16} /> : finding.status === "outdated" ? <AlertIcon size={16} /> : <TrashIcon size={16} />;
    nodes.push({ id: finding.id, column: 2 + deepest, title: finding.id, detail: capital(finding.status), tone, state: finding.status, icon: <ChartIcon />, mark, stage: "Findings",
                 facts: [["Finding", finding.id], ["Status", finding.status], ["Computed", `${finding.created} by ${finding.created_by}`], ["Fingerprint", finding.sha256]] });
    inputs.forEach((input) => edges.push([input.item, finding.id]));
  }
  return { nodes, edges };
}

/** Every node reached from `start` by following the edges one way: towards the sources, or towards what was made. */
export function reach(start: string, edges: [string, string][], towardsSources: boolean) {
  const found = new Set<string>([start]);
  const waiting = [start];
  while (waiting.length) {
    const current = waiting.pop()!;
    for (const [from, to] of edges) {
      const next = towardsSources ? (to === current ? from : null) : from === current ? to : null;
      if (next && !found.has(next)) {
        found.add(next);
        waiting.push(next);
      }
    }
  }
  return found;
}

/**
 * The path of the data, left to right: where it came from, what the study holds, what was derived, what was found.
 * Choosing a node marks everything it came from and everything made from it, and shows its record under the diagram.
 */
export function Lineage({ person, waiting, findings }: { person: Person | null; waiting: Waiting | null; findings: Finding[] }) {
  // The node chosen here, kept with the address it was chosen under. Without one, the node the address names is chosen.
  const selection = useSelection();
  const [local, setLocal] = useState<{ under: string; id: string | null } | null>(null);
  const here = local !== null && local.under === selection;
  const chosen = here ? local.id : selection || null;
  const { nodes, edges } = person ? receivedFlow(person, findings) : waiting ? submittedFlow(waiting) : { nodes: [], edges: [] };
  if (nodes.length === 0) return null;

  const used = [...new Set(nodes.map((node) => node.column))].sort();
  const columns = used.map((column) => nodes.filter((node) => node.column === column));
  const rows = Math.max(...columns.map((column) => column.length));
  const width = columns.length * WIDTH + (columns.length - 1) * GAP_X;
  const height = CAPTION + rows * HEIGHT + (rows - 1) * GAP_Y;
  const share = (units: number) => `${(units / width) * 100}%`;
  const span = (size: { node: number; gap: number }) => columns.length * size.node + (columns.length - 1) * size.gap;

  const place = new Map<string, { x: number; y: number; tone: Tone }>();
  columns.forEach((column, index) => {
    const top = CAPTION + ((rows - column.length) * (HEIGHT + GAP_Y)) / 2;
    column.forEach((node, row) => place.set(node.id, { x: index * (WIDTH + GAP_X), y: top + row * (HEIGHT + GAP_Y), tone: node.tone }));
  });

  const focus = nodes.find((node) => node.id === chosen) ?? null;
  const before = focus ? reach(focus.id, edges, true) : null;
  const after = focus ? reach(focus.id, edges, false) : null;
  const related = (id: string) => !focus || before!.has(id) || after!.has(id);
  const onTrace = (from: string, to: string) => focus !== null && ((before!.has(from) && before!.has(to)) || (after!.has(from) && after!.has(to)));
  const role = typeof window === "undefined" ? "" : window.location.hash.slice(1).split("/")[0];

  return (
    <>
      <div className="flow-wrap">
        <div className="flow" style={{ height, minWidth: span(NARROW), maxWidth: span(WIDE) }}>
          <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
            {edges.map(([from, to]) => {
              const a = place.get(from);
              const b = place.get(to);
              if (!a || !b) return null;
              const x1 = a.x + WIDTH;
              const y1 = a.y + HEIGHT / 2;
              const y2 = b.y + HEIGHT / 2;
              const bend = (b.x - x1) / 2;
              const tone = b.tone === "gone" || a.tone === "gone" ? "gone" : b.tone === "bad" ? "bad" : "";
              const trace = !focus ? "" : onTrace(from, to) ? " lit" : " dim";
              return <path key={`${from}>${to}`} className={tone + trace} d={`M${x1} ${y1} C${x1 + bend} ${y1} ${b.x - bend} ${y2} ${b.x} ${y2}`} />;
            })}
          </svg>
          {columns.map((column, index) => (
            <span key={index} className="flow-stage" style={{ left: share(index * (WIDTH + GAP_X)), width: share(WIDTH) }}>
              {column[0].stage}
            </span>
          ))}
          {nodes.map((node) => {
            const at = place.get(node.id)!;
            const choose = () => setLocal({ under: selection, id: here && node.id === chosen ? null : node.id });
            return (
              <div
                key={node.id}
                className={`node ${node.tone}${focus?.id === node.id ? " focus" : ""}${related(node.id) ? "" : " dim"}`}
                style={{ left: share(at.x), top: at.y, width: share(WIDTH), height: HEIGHT }}
                title={`${node.title}: ${node.state}${node.phi ? ", protected health information" : ""}`}
                role="button"
                tabIndex={0}
                aria-pressed={focus?.id === node.id}
                onClick={choose}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    choose();
                  }
                }}
              >
                <span className="node-icon">{node.icon}</span>
                <span className="node-text">
                  <span className="node-title">{node.title}</span>
                  <span className="node-line">
                    <span className={`node-detail${node.mono ? " mono" : ""}`}>{node.detail}</span>
                    <span className="node-mark">
                      {node.phi && <span className="phi">PHI</span>}
                      {node.mark}
                    </span>
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {focus && (
        <div className="table-wrap flow-detail">
          <table>
            <tbody>
              {focus.facts.map(([name, value]) => (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  <td className={name === "Fingerprint" ? "mono wrap" : "wrap"}>{value}</td>
                </tr>
              ))}
              {person && focus.entry !== undefined && (
                <tr>
                  <th scope="row">Ledger</th>
                  <td>
                    <a className="mono" href={`#${role}/ledger/${person.id}.${focus.entry}`}>
                      #{focus.entry}
                    </a>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
