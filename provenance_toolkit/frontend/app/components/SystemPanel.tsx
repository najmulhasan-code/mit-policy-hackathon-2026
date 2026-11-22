"use client";

import { actionName } from "./DatasetTrail";
import { useEffect, useState } from "react";
import { fileName, fileSize, shortHash } from "../lib/api";
import { fingerprint, forgetHeld, inclusion, verifyStudy } from "../lib/proof";
import type { Inclusion, StudyProof } from "../lib/proof";
import type { Person, State } from "../lib/types";
import { AlertIcon, CheckIcon, CrossIcon, DatasetIcon, FileIcon, HashIcon, ImageIcon, LockIcon, RecordIcon, SealIcon, TrashIcon, UploadIcon } from "./Icons";
import { HashStrip } from "./Shared";

function Mark({ ok }: { ok: boolean }) {
  return (
    <span className={ok ? "good" : "bad"}>
      {ok ? <CheckIcon size={16} /> : <CrossIcon size={16} />}
      <span className="visually-hidden">{ok ? "passed" : "failed"}</span>
    </span>
  );
}

/** Every log entry re-hashed here and folded into one root. */
function Records({ proof }: { proof: StudyProof }) {
  return (
    <details className="panel-block">
      <summary>
        <Mark ok={proof.faults.length === 0} /> Whole study log
        <span className="panel-side">
          {proof.faults.length === 0 ? proof.size : `${proof.faults.length} wrong`} of {proof.size} entries
        </span>
      </summary>
      <HashStrip hash={proof.root} />
      <p className="root mono">{proof.root}</p>
      {proof.faults.length > 0 && (
        <ul className="proof-rows">
          {proof.faults.slice(0, 6).map((fault) => (
            <li key={fault} className="bad">
              <AlertIcon size={16} />
              <span className="mono">{fault}</span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

/** Shown only when the records no longer agree with a checkpoint, the ledger root taken when the auditor verified. */
function History({ proof, onAccept }: { proof: StudyProof; onAccept: () => void }) {
  const changedSinceLastVisit = proof.browser !== null && !proof.browser.holds;
  const broken = proof.auditor.filter((mark) => !mark.holds);
  if (broken.length === 0 && !changedSinceLastVisit) return null;
  return (
    <details className="panel-block" open>
      <summary>
        <Mark ok={false} /> History rewritten
      </summary>
      <ul className="proof-rows">
        {broken.map((mark) => (
          <li key={`${mark.size}-${mark.date}`}>
            <Mark ok={false} />
            <span>Differs from what the auditor verified</span>
            <span className="mono quiet">{mark.date}</span>
          </li>
        ))}
        {changedSinceLastVisit && (
          <li>
            <Mark ok={false} />
            <span>Changed since last opened here</span>
            <button className="text-button" onClick={onAccept}>
              Accept
            </button>
          </li>
        )}
      </ul>
    </details>
  );
}

/** One log entry folded with its sibling hashes up to the ledger root, every value computed here. */
function InclusionProof({ proof, person, index }: { proof: StudyProof; person: Person; index: number }) {
  const place = proof.position[`${person.id}#${index}`];
  // The result is kept with the place it was computed for, so a result for another entry is not shown.
  const [result, setResult] = useState<{ place: number; value: Inclusion } | null>(null);
  const leaves = proof.leaves.join();

  useEffect(() => {
    let stale = false;
    if (place === undefined) return;
    inclusion(leaves ? leaves.split(",") : [], place).then((next) => !stale && setResult({ place, value: next }));
    return () => {
      stale = true;
    };
  }, [leaves, place]);

  const entry = person.manifest.events[index];
  if (!entry) return null;
  const shown = result !== null && result.place === place ? result.value : null;
  const reaches = shown !== null && shown.root === proof.root;

  return (
    <details className="panel-block">
      <summary>
        <Mark ok={reaches} /> Ledger inclusion
        <span className="panel-side mono">
          #{index} {actionName(entry.action)}
        </span>
      </summary>
      {place === undefined ? (
        <p className="state bad">
          <CrossIcon size={14} /> not in the ledger
        </p>
      ) : (
        shown && (
          <ol className="ladder">
            <li>
              <span className="ladder-op">leaf {place}</span>
              <span className="mono" title={shown.leaf}>
                {shortHash(shown.leaf, 24)}
              </span>
            </li>
            {shown.steps.map((step, level) => (
              <li key={level}>
                <span className="ladder-op">
                  {step.side === "left" ? "hashed with the sibling on the left" : "hashed with the sibling on the right"}
                </span>
                <span className="mono quiet" title={step.sibling}>
                  {shortHash(step.sibling, 24)}
                </span>
                <span className="mono" title={step.result}>
                  {shortHash(step.result, 24)}
                </span>
              </li>
            ))}
            <li className={reaches ? "reaches" : "misses"}>
              <span className="ladder-op with-icon">
                {reaches ? <CheckIcon size={14} /> : <CrossIcon size={14} />} {reaches ? "equals the ledger root" : "differs from the ledger root"}
              </span>
            </li>
          </ol>
        )
      )}
    </details>
  );
}

/** The activity log as a chain. Each entry shows the previous hash and its own. Choosing one shows its proof. */
function Chain({ person, chosen, onChoose }: { person: Person; chosen: number; onChoose: (index: number) => void }) {
  const entries = person.manifest.events;
  const broken = new Set(person.broken_links);
  const mismatched = new Set(person.seal_mismatches);
  const sealed = new Map(person.seals.map((seal) => [seal.index, seal]));
  const firstBroken = person.broken_links.length ? Math.min(...person.broken_links) : null;
  const intact = person.broken_links.length === 0 && person.seal_mismatches.length === 0;

  return (
    <details className="panel-block">
      <summary>
        <Mark ok={intact} /> This donation log
        <span className="panel-side">
          {entries.length - person.broken_links.length} of {entries.length} entries
        </span>
      </summary>
      <ol className="chain">
        {entries.map((entry) => {
          const isBroken = broken.has(entry.index);
          const afterBreak = firstBroken !== null && entry.index > firstBroken;
          const seal = sealed.get(entry.index);
          const sealBad = mismatched.has(entry.index);
          return (
            <li key={entry.index} className={isBroken || sealBad ? "link-bad" : afterBreak ? "link-doubt" : ""}>
              <button aria-pressed={chosen === entry.index} onClick={() => onChoose(entry.index)}>
                <span className="chain-head">
                  <span className="chain-index">#{entry.index}</span>
                  <span className="chain-action">{actionName(entry.action)}</span>
                  <span className="quiet">{entry.actor}</span>
                </span>
                <span className="chain-hash mono" title={`previous ${entry.previous}\nhash ${entry.hash}`}>
                  {shortHash(entry.hash, 20)}
                </span>
                {isBroken && (
                  <span className="state bad">
                    <CrossIcon size={14} /> hash mismatch
                  </span>
                )}
                {seal && !sealBad && (
                  <span className="state good">
                    <SealIcon size={14} /> {seal.date}
                  </span>
                )}
                {sealBad && (
                  <span className="state bad">
                    <AlertIcon size={14} /> differs from the sealed hash
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </details>
  );
}

function kindIcon(name: string, kind: string | undefined) {
  if (kind === "clinical record") return <RecordIcon />;
  if (kind === "derived dataset") return <DatasetIcon />;
  if (/\.(png|jpe?g|gif|webp)$/i.test(name)) return <ImageIcon />;
  return <FileIcon />;
}

/** The files found in storage when the state was last read, each with its fingerprint recomputed. */
function Storage({ person }: { person: Person }) {
  const items = new Map(person.manifest.items.map((item) => [item.path, item]));
  const deleted = person.manifest.items.filter((item) => item.status === "deleted");
  const sound = person.storage.every((file) => file.item && file.matches);
  return (
    <details className="panel-block">
      <summary>
        <Mark ok={sound} /> Files unchanged
        <span className="panel-side">
          {person.storage.filter((file) => file.item && file.matches).length} of {person.storage.length}
        </span>
      </summary>
      <ul className="files">
        {person.storage.map((file) => {
          const item = items.get(file.path);
          return (
            <li key={file.path} className={file.matches ? "" : "file-bad"}>
              <span className="file-icon">{kindIcon(file.path, item?.kind)}</span>
              <div>
                <div className="file-name">{fileName(file.path)}</div>
                <div className="file-meta mono" title={file.sha256}>
                  {shortHash(file.sha256, 24)} {fileSize(file.bytes)}
                </div>
              </div>
              {!file.item ? (
                <span className="state bad" title="Not in the records">
                  <AlertIcon size={16} />
                </span>
              ) : !file.matches ? (
                <span className="state bad" title="Altered">
                  <CrossIcon size={16} />
                </span>
              ) : item?.status === "access-restricted" ? (
                <span className="state warn" title="Kept, access restricted">
                  <LockIcon size={16} />
                </span>
              ) : (
                <span className="state good" title="Matches the recorded fingerprint">
                  <CheckIcon size={16} />
                </span>
              )}
            </li>
          );
        })}
        {deleted.map((item) => (
          <li key={item.id} className="file-gone">
            <span className="file-icon">
              <TrashIcon />
            </span>
            <div>
              <div className="file-name">{fileName(item.path)}</div>
              <div className="file-meta mono" title={item.sha256}>
                {shortHash(item.sha256, 24)}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

type Match = { key: string; participant: string; name: string; status: string };

/** The file is hashed in the page and its fingerprint is looked up in the records already loaded. */
function FileCheck({ state }: { state: State }) {
  const [checked, setChecked] = useState<{ name: string; sha256: string } | null>(null);

  const matches: Match[] = [];
  if (checked) {
    for (const person of state.participants) {
      for (const item of person.manifest.items) {
        if (item.sha256 === checked.sha256) matches.push({ key: `${person.id}/${item.path}`, participant: person.id, name: fileName(item.path), status: item.status === "active" ? "held" : item.status === "deleted" ? "deleted" : "restricted" });
      }
    }
    for (const waiting of state.waiting) {
      for (const file of waiting.files) {
        if (file.sha256 === checked.sha256) matches.push({ key: `${waiting.id}/${file.file}`, participant: waiting.id, name: file.file, status: "submitted" });
      }
    }
  }

  async function check(file: File | undefined) {
    if (file) setChecked({ name: file.name, sha256: await fingerprint(file) });
  }

  return (
    <section className="panel-block">
      <h2 className="plain-title">
        <HashIcon size={16} /> Check a file
        <label className="panel-side icon-button plain small" title="Choose a file">
          <UploadIcon size={15} />
          <input
            className="hidden-input"
            type="file"
            aria-label="File to check"
            onChange={(event) => {
              const file = Array.from(event.target.files ?? [])[0];
              event.target.value = "";
              check(file);
            }}
          />
        </label>
      </h2>
      {checked && (
        <>
          <div className="file-name">{checked.name}</div>
          <p className="root mono">{checked.sha256}</p>
          <ul className="proof-rows">
            {matches.length === 0 && (
              <li>
                <Mark ok={false} />
                <span>Not in the records</span>
              </li>
            )}
            {matches.map((match) => (
              <li key={match.key}>
                <Mark ok />
                <span>
                  {match.participant} {match.name}
                </span>
                <span className="quiet">{match.status}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function SystemPanel({ state, person }: { state: State; person: Person | null }) {
  const [proof, setProof] = useState<StudyProof | null>(null);
  const [picked, setPicked] = useState<{ person: string; index: number } | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let stale = false;
    if (!window.crypto?.subtle) return;
    verifyStudy(state).then((next) => !stale && setProof(next));
    return () => {
      stale = true;
    };
  }, [state, round]);

  const last = person ? person.manifest.events.length - 1 : -1;
  const chosen = person && picked?.person === person.id && picked.index <= last ? picked.index : last;

  return (
    <aside className="system" aria-label="Proof">
      <div className="panel-title">
        <SealIcon size={16} /> Proof
      </div>
      {proof && <Records proof={proof} />}
      {proof && <History proof={proof} onAccept={() => { forgetHeld(); setRound((round) => round + 1); }} />}
      {person && <Storage person={person} />}
      {person && <Chain person={person} chosen={chosen} onChoose={(index) => setPicked({ person: person.id, index })} />}
      {person && proof && chosen >= 0 && <InclusionProof proof={proof} person={person} index={chosen} />}
      <FileCheck state={state} />
    </aside>
  );
}
