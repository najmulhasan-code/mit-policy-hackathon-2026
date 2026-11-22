"use client";

import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import { fileName, fileSize, shortHash } from "../lib/api";
import { entryHash } from "../lib/proof";
import type { Finding, Item, Leaf, LogEntry, Person, Role, State } from "../lib/types";
import { CheckIcon, CrossIcon } from "./Icons";
import { DatasetTree } from "./DatasetTree";
import { reach } from "./Lineage";
import { Block, FindingTag } from "./Shared";

/** The value a log entry carries in `item` when it is about the whole donation. */
const WHOLE = "all";
const RECORD_NAME = "Consent and study record";

type Standing = { label: string; tone: string };

/**
 * One row of the ledger page: an item of a participant's manifest with the log entries about it,
 * or, with `item` null, the entries of a participant that are about no single item.
 */
export type Dataset = {
  id: string;
  participant: string;
  item: Item | null;
  name: string;
  standing: Standing | null;
  entries: LogEntry[];
};

/** Where an item stands, from its record and from the file found in storage. */
function standingOf(item: Item, person: Person): Standing {
  if (item.status === "deleted") return { label: "Deleted", tone: "" };
  const file = person.storage.find((stored) => stored.path === item.path);
  if (!file) return { label: "Missing", tone: "red" };
  if (!file.matches) return { label: "Altered", tone: "red" };
  if (item.status === "access-restricted") return { label: "Restricted", tone: "amber" };
  return { label: "Present", tone: "blue" };
}

/**
 * Every dataset of the study with its own log entries, by participant. An entry names an item, a finding or the whole
 * donation. An entry that names a finding belongs to the items of this participant that went into the finding.
 * Entries that belong to no item are gathered in one last row per participant.
 */
export function datasetsOf(state: State): Dataset[] {
  const findings = new Map(state.findings.map((finding) => [finding.id, finding]));
  const all: Dataset[] = [];
  for (const person of state.participants) {
    const own = person.manifest.items.map((item): Dataset => ({ id: item.id, participant: person.id, item, name: fileName(item.path), standing: standingOf(item, person), entries: [] }));
    const byId = new Map(own.map((dataset) => [dataset.id, dataset]));
    const record: Dataset = { id: `${person.id}-record`, participant: person.id, item: null, name: RECORD_NAME, standing: null, entries: [] };
    for (const entry of person.manifest.events) {
      const direct = byId.get(entry.item);
      const inputs = findings.get(entry.item)?.inputs.filter((input) => input.participant === person.id) ?? [];
      const through = inputs.map((input) => byId.get(input.item)).filter((dataset): dataset is Dataset => dataset !== undefined);
      const homes = direct ? [direct] : entry.item !== WHOLE && through.length > 0 ? through : [record];
      for (const home of homes) home.entries.push(entry);
    }
    all.push(...own);
    if (record.entries.length > 0) all.push(record);
  }
  return all;
}

/**
 * The dataset and the entry the address names. The address is a dataset id, or a participant and an entry
 * number joined by a dot. Without either, the newest entry of the ledger and its dataset are chosen.
 */
export function chooseDataset(datasets: Dataset[], leaves: Leaf[], selection: string | null): { dataset: Dataset | null; index: number | null } {
  const holding = (participant: string, index: number) => datasets.find((dataset) => dataset.participant === participant && dataset.entries.some((entry) => entry.index === index));
  const dot = selection ? selection.lastIndexOf(".") : -1;
  if (selection && dot > 0 && /^\d+$/.test(selection.slice(dot + 1))) {
    const index = Number(selection.slice(dot + 1));
    const dataset = holding(selection.slice(0, dot), index);
    if (dataset) return { dataset, index };
  }
  const named = datasets.find((dataset) => dataset.id === selection);
  if (named) return { dataset: named, index: named.entries.length ? named.entries[named.entries.length - 1].index : null };
  const newest = leaves[leaves.length - 1];
  const dataset = newest ? holding(newest.participant, newest.index) : undefined;
  if (dataset) return { dataset, index: newest.index };
  return { dataset: datasets[0] ?? null, index: null };
}

/** The handlers that make a table row open an address, by pointer and by keyboard. */
function opens(address: string) {
  const open = () => {
    window.location.hash = address;
  };
  return {
    onClick: open,
    tabIndex: 0,
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    },
  };
}

function StandingTag({ standing }: { standing: Standing | null }) {
  return standing ? <span className={`tag ${standing.tone}`}>{standing.label}</span> : null;
}

/** The datasets of the study, grouped by participant. The chosen one is marked. */
export function DatasetList({ datasets, chosen, role }: { datasets: Dataset[]; chosen: Dataset | null; role: Role }) {
  const participants = [...new Set(datasets.map((dataset) => dataset.participant))];
  return (
    <nav className="dataset-list" aria-label="Datasets">
      {participants.map((participant) => (
        <div key={participant} className="dataset-group">
          <div className="dataset-group-head">
            <span className="mono">{participant}</span>
          </div>
          {datasets
            .filter((dataset) => dataset.participant === participant)
            .map((dataset) => (
              <a key={dataset.id} className="dataset-row" href={`#${role}/ledger/${dataset.id}`} title={dataset.item?.sha256} aria-current={dataset.id === chosen?.id ? "true" : undefined}>
                <span className="dataset-name">{dataset.name}</span>
                {dataset.item ? <StandingTag standing={dataset.standing} /> : <span className="mono quiet">{dataset.entries.length}</span>}
              </a>
            ))}
        </div>
      ))}
    </nav>
  );
}

const ACTION: Record<string, string> = {
  intake: "Received",
  redaction: "Redacted",
  registration: "Registered",
  linkage: "Linked",
  use: "Access granted",
  refused: "Access refused",
};

/** The name of a log action as shown on screen. */
export function actionName(action: string) {
  return ACTION[action] ?? action[0].toUpperCase() + action.slice(1);
}

const FINGERPRINT = /([0-9a-f]{64})/;

/** The purpose of a log entry. A fingerprint written in it is shown by its first characters, with the whole value in its title. */
function Purpose({ text }: { text: string }) {
  return (
    <>
      {text.split(FINGERPRINT).map((part, place) =>
        place % 2 ? (
          <span key={place} className="mono" title={part}>
            {shortHash(part, 10)}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** The action of a log entry as a label. An entry about a finding names the finding. */
function actionLabel(entry: LogEntry, dataset: Dataset) {
  const label = actionName(entry.action);
  return entry.item === dataset.id || entry.item === WHOLE ? label : `${label} ${entry.item}`;
}

type Relative = { relation: string; key: string; name: string; kind: string; hash: string; dataset?: Dataset; finding?: Finding };

/** What the dataset was made from, what was made from it and the findings that used it, following the manifest and the findings. */
function relatives(dataset: Dataset, datasets: Dataset[], findings: Finding[]): Relative[] {
  const own = datasets.filter((other) => other.participant === dataset.participant && other.item);
  const edges: [string, string][] = [];
  for (const other of own) other.item!.derived_from.forEach((parent) => edges.push([parent, other.id]));
  for (const finding of findings) {
    for (const input of finding.inputs) if (input.participant === dataset.participant) edges.push([input.item, finding.id]);
  }
  const before = reach(dataset.id, edges, true);
  const after = reach(dataset.id, edges, false);
  const row = (relation: string, other: Dataset): Relative => ({ relation, key: `${relation} ${other.id}`, name: other.name, kind: other.item!.kind, hash: other.item!.sha256, dataset: other });
  return [
    ...own.filter((other) => other.id !== dataset.id && before.has(other.id)).map((other) => row("Made from", other)),
    ...own.filter((other) => other.id !== dataset.id && after.has(other.id)).map((other) => row("Made into", other)),
    ...findings.filter((finding) => after.has(finding.id)).map((finding): Relative => ({ relation: "Used in", key: `Used in ${finding.id}`, name: finding.id, kind: finding.purpose, hash: finding.sha256, finding })),
  ];
}

/**
 * The chosen dataset: its record, its lineage and its own trail of log entries, oldest first. The mark on an entry
 * is set when its hash, computed here, equals the leaf at its place in the ledger and the tree over the leaves has the root given.
 */
export function DatasetTrail({
  dataset,
  datasets,
  state,
  role,
  picked,
  position,
  rootHolds,
}: {
  dataset: Dataset;
  datasets: Dataset[];
  state: State;
  role: Role;
  /** The number of the chosen entry in the participant's log. */
  picked: number | null;
  /** Ledger position of a log entry, by "participant#index". */
  position: Map<string, number>;
  /** Whether the root computed here equals the root given. Null until the tree is built. */
  rootHolds: boolean | null;
}) {
  const { item, participant, entries } = dataset;
  const person = state.participants.find((one) => one.id === participant);
  const key = `${participant} ${entries.map((entry) => entry.hash).join()}`;
  const [computed, setComputed] = useState<{ key: string; hashes: string[] } | null>(null);

  useEffect(() => {
    let stale = false;
    if (!window.crypto?.subtle) return;
    Promise.all(entries.map(entryHash)).then((hashes) => !stale && setComputed({ key, hashes }));
    return () => {
      stale = true;
    };
    // The key names the entries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const hashes = computed?.key === key ? computed.hashes : null;
  const included = (entry: LogEntry, place: number) => {
    const at = position.get(`${participant}#${entry.index}`);
    return rootHolds === true && at !== undefined && state.ledger.leaves[at].hash === entry.hash && hashes![place] === entry.hash;
  };
  const related = item ? relatives(dataset, datasets, state.findings) : [];
  const stored = item && person?.storage.find((file) => file.path === item.path);
  const consent = person?.manifest.consent;

  return (
    <div className="ledger-detail">
      <section className="block">
        <div className="block-head">
          <h2>{dataset.name}</h2>
          <StandingTag standing={dataset.standing} />
        </div>
        <dl className="facts">
          <div>
            <dt>Participant</dt>
            <dd>
              <a className="id" href={`#${role}/${participant}`}>
                {participant}
              </a>
            </dd>
          </div>
          {item && (
            <>
              <div>
                <dt>Kind</dt>
                <dd>{item.kind}</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{fileSize(item.bytes)}</dd>
              </div>
              {item.derived_from.length === 0 && (
                <div>
                  <dt>Source</dt>
                  <dd>
                    {item.source.holder}, {item.source.platform}
                  </dd>
                </div>
              )}
              <div>
                <dt>Recorded</dt>
                <dd>
                  <span className="mono">{item.recorded}</span> {item.recorded_by}
                </dd>
              </div>
              <div className="line">
                <dt>Fingerprint</dt>
                <dd className="mono">{item.sha256}</dd>
              </div>
              {stored && !stored.matches && (
                <div className="line">
                  <dt>In storage</dt>
                  <dd className="mono">{stored.sha256}</dd>
                </div>
              )}
              <div className="line">
                <dt>Retention</dt>
                <dd>{item.retention}</dd>
              </div>
            </>
          )}
          {!item && consent && (
            <>
              <div>
                <dt>Study protocol</dt>
                <dd>{consent.study_protocol}</dd>
              </div>
              <div className="line">
                <dt>Permitted</dt>
                <dd>{consent.permitted_uses.join("; ")}</dd>
              </div>
              <div className="line">
                <dt>Prohibited</dt>
                <dd>{consent.prohibited_uses.join("; ")}</dd>
              </div>
            </>
          )}
        </dl>
      </section>

      <Block title="Trail" side={<span className="mono quiet">{entries.length}</span>} flush>
        <div className="table-wrap">
          <table className="trail">
            <thead>
              <tr>
                <th>Date</th>
                <th>Entry</th>
                <th>By</th>
                <th>Action</th>
                <th>Purpose</th>
                <th>Entry hash</th>
                <th>Root</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, place) => {
                const holds = hashes && rootHolds !== null ? included(entry, place) : null;
                return (
                  <tr key={entry.index} className={`row-link${entry.index === picked ? " on" : ""}`} aria-selected={entry.index === picked} {...opens(`${role}/ledger/${participant}.${entry.index}`)}>
                    <td className="mono">{entry.date}</td>
                    <td className="mono">#{entry.index}</td>
                    <td>{entry.actor}</td>
                    <td>{actionLabel(entry, dataset)}</td>
                    <td className="wrap">
                      <Purpose text={entry.purpose} />
                    </td>
                    <td className="mono" title={entry.hash}>
                      {shortHash(entry.hash)}
                    </td>
                    <td>
                      {holds !== null && (
                        <span className={`state ${holds ? "good" : "bad"}`}>
                          {holds ? <CheckIcon size={15} /> : <CrossIcon size={15} />}
                          <span className="visually-hidden">{holds ? "included under the root" : "not included under the root"}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Block>

      {entries.length > 0 && (
        <Block title="Dataset tree">
          <DatasetTree
            leaves={entries.map((entry) => ({ index: entry.index, hash: entry.hash, label: actionName(entry.action) }))}
            picked={picked}
            address={(index) => `${role}/ledger/${participant}.${index}`}
          />
        </Block>
      )}

      {related.length > 0 && (
        <Block title="Lineage" flush>
          <div className="table-wrap">
            <table className="relatives">
              <thead>
                <tr>
                  <th>Relation</th>
                  <th>Name</th>
                  <th>Kind</th>
                  <th>Fingerprint</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {related.map((one) => {
                  const address = one.dataset ? `${role}/ledger/${one.dataset.id}` : one.finding && role !== "family" ? `${role}/findings` : null;
                  return (
                    <tr key={one.key} className={address ? "row-link" : undefined} {...(address ? opens(address) : {})}>
                      <td className="quiet">{one.relation}</td>
                      <td>{one.name}</td>
                      <td className="wrap">{one.kind}</td>
                      <td className="mono" title={one.hash}>
                        {shortHash(one.hash)}
                      </td>
                      <td>{one.dataset ? <StandingTag standing={one.dataset.standing} /> : one.finding ? <FindingTag status={one.finding.status} /> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Block>
      )}
    </div>
  );
}
