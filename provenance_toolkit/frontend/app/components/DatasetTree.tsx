"use client";

import { useEffect, useRef, useState } from "react";
import { ledgerTree } from "../lib/proof";
import type { TreeNode } from "../lib/proof";

/* The widest and the narrowest spacing of the leaves. Between them a tree is fitted to the width available. */
export const GAP = 100;
export const NARROW = 44;
export const ROW = 56;
export const BOX = { width: 84, height: 24 };
export const TOP = 20;
/* Height under a leaf box for its caption: the entry number, then the action on up to two lines. */
export const CAPTION = 70;
const CAPTION_WIDTH = 16;

/** Break an action name into at most two lines at a space, so that the captions of neighbouring leaves stay apart. */
export function captionLines(text: string): string[] {
  if (text.length <= CAPTION_WIDTH) return [text];
  const cut = text.lastIndexOf(" ", CAPTION_WIDTH);
  return cut < 0 ? [text] : [text.slice(0, cut), text.slice(cut + 1)];
}

export type Placed = TreeNode & { x: number; y: number; depth: number; left?: Placed; right?: Placed };

export function height(node: TreeNode): number {
  return node.left && node.right ? 1 + Math.max(height(node.left), height(node.right)) : 0;
}

/** Give every node a position: leaves in order along the bottom, each parent centred over its two children. */
export function place(node: TreeNode, depth: number, levels: number, gap: number, all: Placed[]): Placed {
  let placed: Placed;
  if (node.left && node.right) {
    const left = place(node.left, depth + 1, levels, gap, all);
    const right = place(node.right, depth + 1, levels, gap, all);
    placed = { ...node, left, right, depth, x: (left.x + right.x) / 2, y: TOP + depth * ROW };
  } else {
    placed = { lo: node.lo, hi: node.hi, hash: node.hash, depth, x: gap / 2 + node.lo * gap, y: TOP + levels * ROW };
  }
  all.push(placed);
  return placed;
}

/** One log entry of a dataset as a leaf: its number in the participant's log, its hash and the name of its action. */
export type TrailLeaf = { index: number; hash: string; label: string };

/**
 * The tree over the log entries of one dataset, in trail order, built the same way as the study ledger.
 * The bottom row has one box per entry with the entry hash. The top box is the dataset root, and its full value
 * is written above the tree. With one entry the root is drawn over that entry. The path of the chosen entry is marked.
 */
export function DatasetTree({ leaves, picked, address }: { leaves: TrailLeaf[]; picked: number | null; address: (index: number) => string }) {
  const key = leaves.map((leaf) => leaf.hash).join();
  const [built, setBuilt] = useState<{ key: string; tree: TreeNode | null } | null>(null);
  const [room, setRoom] = useState(0);
  const frame = useRef<HTMLDivElement>(null);
  const drawn = built !== null;

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
  if (!tree) return null;

  const levels = Math.max(1, height(tree));
  const single = !tree.left;
  const gap = Math.max(NARROW, Math.min(GAP, room > 0 ? room / leaves.length : GAP));
  const box = Math.min(BOX.width, gap - 6);
  const shown = Math.max(4, Math.floor((box - 8) / 7.3));
  const nodes: Placed[] = [];
  const top = place(tree, single ? 1 : 0, levels, gap, nodes);
  const chosen = leaves.findIndex((leaf) => leaf.index === picked);
  const onPath = (node: Placed) => node.lo <= chosen && chosen < node.hi;
  const width = Math.max(leaves.length * gap, BOX.width + 2);
  const shift = (width - leaves.length * gap) / 2;
  const bottom = TOP + levels * ROW;

  return (
    <>
      <p className="ledger-root">
        <span className="quiet">Dataset root</span>
        <span className="mono">{tree.hash}</span>
      </p>
      <div className="flow-wrap" ref={frame}>
        <svg className="tree dataset-tree" width={width} height={bottom + CAPTION + 4} viewBox={`${-shift} 0 ${width} ${bottom + CAPTION + 4}`} role="img" aria-label="The entries of the dataset as a tree of hashes">
          {single && <line className={chosen === 0 ? "on" : ""} x1={top.x} y1={TOP + BOX.height / 2} x2={top.x} y2={top.y - BOX.height / 2} />}
          {nodes.map(
            (node) =>
              node.left &&
              node.right &&
              [node.left, node.right].map((child) => (
                <line key={`${node.lo}-${node.hi}-${child.lo}`} className={onPath(node) && onPath(child) ? "on" : ""} x1={node.x} y1={node.y + BOX.height / 2} x2={child.x} y2={child.y - BOX.height / 2} />
              )),
          )}
          {single && (
            <g className={`tree-node root${chosen === 0 ? " on" : ""}`}>
              <title>{tree.hash}</title>
              <rect x={top.x - BOX.width / 2} y={TOP - BOX.height / 2} width={BOX.width} height={BOX.height} rx="2" />
              <text x={top.x} y={TOP + 4}>
                {tree.hash.slice(0, 10)}
              </text>
            </g>
          )}
          {nodes.map((node) => {
            const leaf = node.left ? null : leaves[node.lo];
            const isRoot = node === top && !single;
            const choose = leaf
              ? () => {
                  window.location.hash = address(leaf.index);
                }
              : undefined;
            return (
              <g
                key={`${node.lo}-${node.hi}`}
                className={`tree-node ${isRoot ? "root" : leaf ? "leaf" : "mid"}${onPath(node) ? " on" : ""}`}
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
                tabIndex={leaf ? 0 : undefined}
                role={leaf ? "button" : undefined}
                aria-label={leaf ? `Entry ${leaf.index}` : undefined}
              >
                <title>{leaf ? leaf.hash : node.hash}</title>
                {leaf && <rect className="hit" x={node.x - gap / 2 + 1} y={node.y - BOX.height / 2 - 4} width={gap - 2} height={CAPTION + 10} rx="2" />}
                <rect x={node.x - (isRoot ? BOX.width : box) / 2} y={node.y - BOX.height / 2} width={isRoot ? BOX.width : box} height={BOX.height} rx="2" />
                <text x={node.x} y={node.y + 4}>
                  {(leaf ? leaf.hash : node.hash).slice(0, isRoot ? 10 : Math.min(10, shown))}
                </text>
                {leaf && (
                  <>
                    <text className="cap" x={node.x} y={node.y + 30}>
                      #{leaf.index}
                    </text>
                    {(gap >= 84 ? captionLines(leaf.label) : []).map((line, row) => (
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
    </>
  );
}
