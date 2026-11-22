"use client";

import { useEffect, useRef, useState } from "react";
import { fileName, shortHash } from "../lib/api";
import { ledgerTree } from "../lib/proof";
import type { TreeNode } from "../lib/proof";
import type { Item, LogEntry, Role, State } from "../lib/types";
import { actionName, chooseDataset, DatasetList, datasetsOf, DatasetTrail } from "./DatasetTrail";
import { BOX, CAPTION, captionLines, GAP, height, NARROW, place, ROW, TOP } from "./DatasetTree";
import type { Placed } from "./DatasetTree";
import { CheckIcon, CrossIcon, TreeIcon } from "./Icons";

/* The height of the participant band under the leaves. */
const BAND = 34;

/**
 * The ledger by dataset. A list of the datasets of every participant, the chosen dataset with its own trail of
 * log entries, and under them, folded, the study ledger as a tree. The bottom row of the tree has one leaf per log entry,
 * in the order written. Each box above is the hash of the two below it, and the top box is the root. Every hash is
 * computed here from the entry hashes. One dataset is always chosen: the one the address names, or the one the
 * newest entry is about. The paths of its entries to the root are marked, and the path of the chosen entry is drawn stronger.
 */
export function LedgerView({ state, role, selection }: { state: State; role: Role; selection: string | null }) {
  const leaves = state.ledger.leaves;
  const key = leaves.map((leaf) => leaf.hash).join();
  const [built, setBuilt] = useState<{ key: string; tree: TreeNode | null } | null>(null);
  const [room, setRoom] = useState(0);
  const frame = useRef<HTMLDivElement>(null);
  const drawn = built !== null;

  // The width available to the tree, read again whenever the frame is resized.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setRoom(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [drawn]);

  useEffect(() => {
    let stale = false;
    if (!window.crypto?.subtle) return;
    ledgerTree(key ? key.split(",") : []).then((tree) => !stale && setBuilt({ key, tree }));
    return () => {
      stale = true;
    };
  }, [key]);

  const tree = built?.key === key ? built.tree : null;
  const entries = new Map<string, LogEntry>();
  const items = new Map<string, Item>();
  for (const person of state.participants) {
    for (const entry of person.manifest.events) entries.set(`${person.id}#${entry.index}`, entry);
    for (const item of person.manifest.items) items.set(item.id, item);
  }

  if (leaves.length === 0) {
    return (
      <>
        <div className="heading">
          <h1>Ledger</h1>
        </div>
        <div className="empty">
          <TreeIcon size={40} />
        </div>
      </>
    );
  }

  const nodes: Placed[] = [];
  const gap = Math.max(NARROW, Math.min(GAP, room > 0 ? room / leaves.length : GAP));
  const box = Math.min(BOX.width, gap - 6);
  const shown = Math.max(4, Math.floor((box - 8) / 7.3));
  const root = tree ? place(tree, 0, height(tree), gap, nodes) : null;
  const datasets = datasetsOf(state);
  const { dataset, index } = chooseDataset(datasets, leaves, selection);
  const position = new Map(leaves.map((written, at) => [`${written.participant}#${written.index}`, at]));
  const picked = (dataset && index !== null ? position.get(`${dataset.participant}#${index}`) : undefined) ?? -1;
  // The ledger positions of the entries of the chosen dataset.
  const own = dataset ? dataset.entries.map((written) => position.get(`${dataset.participant}#${written.index}`)).filter((at): at is number => at !== undefined) : [];
  const onPath = (node: Placed) => node.lo <= picked && picked < node.hi;
  const onTrail = (node: Placed) => own.some((at) => node.lo <= at && at < node.hi);
  const matches = tree !== null && tree.hash === state.ledger.root;
  const leaf = picked >= 0 ? leaves[picked] : undefined;
  const entry = leaf ? entries.get(`${leaf.participant}#${leaf.index}`) : undefined;
  const file = entry ? items.get(entry.item) : undefined;
  // Runs of neighbouring leaves that belong to one participant, for the bands under the tree.
  const runs: { participant: string; from: number; to: number }[] = [];
  leaves.forEach((written, position) => {
    const last = runs[runs.length - 1];
    if (last && last.participant === written.participant) last.to = position;
    else runs.push({ participant: written.participant, from: position, to: position });
  });
  const siblings = nodes.filter((node) => node.left && node.right && onPath(node)).map((node) => (onPath(node.left!) ? node.right! : node.left!));
  const width = leaves.length * gap;
  const bottom = root ? TOP + height(root) * ROW : TOP;

  return (
    <>
      <div className="heading">
        <h1>Ledger</h1>
      </div>

      <div className="ledger-layout">
        <DatasetList datasets={datasets} chosen={dataset} role={role} />
        {dataset && <DatasetTrail dataset={dataset} datasets={datasets} state={state} role={role} picked={index} position={position} rootHolds={tree ? matches : null} />}
      </div>

      <details className="study-ledger">
        <summary>
          <h2>Study ledger</h2>
          <span className="mono quiet">{leaves.length}</span>
          {tree && (
            <>
              <span className="mono quiet" title={tree.hash}>
                {shortHash(tree.hash)}
              </span>
              <span className={matches ? "good" : "bad"}>
                {matches ? <CheckIcon size={15} /> : <CrossIcon size={15} />}
                <span className="visually-hidden">{matches ? "root holds" : "root differs"}</span>
              </span>
            </>
          )}
        </summary>

      {tree && (
        <p className="ledger-root">
          <span className={matches ? "good" : "bad"}>{matches ? <CheckIcon /> : <CrossIcon />}</span>
          <span className="quiet">Root</span>
          <span className="mono">{tree.hash}</span>
        </p>
      )}

      {root && (
        <div className="flow-wrap" ref={frame}>
          <svg className="tree" width={width} height={bottom + CAPTION + BAND} viewBox={`0 0 ${width} ${bottom + CAPTION + BAND}`} role="img" aria-label="The ledger as a tree of hashes">
            {runs.map((run) => (
              <g key={`${run.participant}-${run.from}`} className={`tree-band${run.participant === dataset?.participant ? " on" : ""}`}>
                <line x1={run.from * gap + 5} y1={bottom + CAPTION} x2={(run.to + 1) * gap - 5} y2={bottom + CAPTION} />
                {(run.to - run.from + 1) * gap >= 50 && (
                  <text x={((run.from + run.to + 1) * gap) / 2} y={bottom + CAPTION + 17}>
                    {run.participant}
                  </text>
                )}
              </g>
            ))}
            {nodes.map(
              (node) =>
                node.left &&
                node.right &&
                [node.left, node.right].map((child) => (
                  <line
                    key={`${node.lo}-${node.hi}-${child.lo}`}
                    className={onPath(node) && onPath(child) ? "on" : onTrail(node) && onTrail(child) ? "lit" : "dim"}
                    x1={node.x}
                    y1={node.y + BOX.height / 2}
                    x2={child.x}
                    y2={child.y - BOX.height / 2}
                  />
                )),
            )}
            {nodes.map((node) => {
              const isLeaf = !node.left;
              const kind = node === root ? "root" : isLeaf ? "leaf" : "mid";
              const trail = onTrail(node) ? " lit" : "";
              const marks = (onPath(node) ? " on" : siblings.includes(node) ? " sibling" : trail || node === root ? "" : " dim") + trail;
              const label = isLeaf ? leaves[node.lo] : null;
              const action = label ? entries.get(`${label.participant}#${label.index}`)?.action : undefined;
              const choose = label
                ? () => {
                    window.location.hash = `${role}/ledger/${label.participant}.${label.index}`;
                  }
                : undefined;
              return (
                <g
                  key={`${node.lo}-${node.hi}`}
                  className={`tree-node ${kind}${marks}`}
                  onClick={choose}
                  onKeyDown={
                    choose &&
                    ((event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        choose();
                      }
                    })
                  }
                  tabIndex={isLeaf ? 0 : undefined}
                  role={isLeaf ? "button" : undefined}
                  aria-label={label ? `${label.participant} entry ${label.index}` : undefined}
                >
                  <title>{node.hash}</title>
                  {isLeaf && <rect className="hit" x={node.x - gap / 2 + 1} y={node.y - BOX.height / 2 - 4} width={gap - 2} height={CAPTION + 10} rx="2" />}
                  <rect x={node.x - (node === root ? BOX.width : box) / 2} y={node.y - BOX.height / 2} width={node === root ? BOX.width : box} height={BOX.height} rx="2" />
                  <text x={node.x} y={node.y + 4}>
                    {node.hash.slice(0, node === root ? 10 : Math.min(10, shown))}
                  </text>
                  {label && trail && (
                    <>
                      <text className="cap" x={node.x} y={node.y + 30}>
                        #{label.index}
                      </text>
                      {(gap >= 84 ? captionLines(action ?? "") : []).map((line, row) => (
                        <text key={row} className="cap" x={node.x} y={node.y + 44 + row * 14}>
                          {line}
                        </text>
                      ))}
                    </>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {root && leaf && (
        <div className="table-wrap entry-proof">
          <table>
            <tbody>
              <tr>
                <th scope="row">Entry</th>
                <td>
                  <a className="id" href={`#${role}/${leaf.participant}`}>
                    {leaf.participant}
                  </a>{" "}
                  <span className="mono">#{leaf.index}</span> {entry ? actionName(entry.action) : null}
                </td>
              </tr>
              {entry && (
                <tr>
                  <th scope="row">Written</th>
                  <td>
                    {entry.actor} <span className="mono quiet">{entry.date}</span>
                  </td>
                </tr>
              )}
              <tr>
                <th scope="row">Entry hash</th>
                <td className="mono wrap">{leaf.hash}</td>
              </tr>
              {file && (
                <tr>
                  <th scope="row">File</th>
                  <td className="wrap">
                    {fileName(file.path)} <span className="mono quiet">{file.sha256}</span>
                  </td>
                </tr>
              )}
              {siblings
                .slice()
                .sort((a, b) => b.depth - a.depth)
                .map((node, level) => (
                  <tr key={`${node.lo}-${node.hi}`}>
                    <th scope="row">Hashed with, step {level + 1}</th>
                    <td className="mono wrap">{node.hash}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      </details>
    </>
  );
}
