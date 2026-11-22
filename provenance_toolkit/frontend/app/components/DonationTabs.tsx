"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { fileName, shortHash } from "../lib/api";
import { filesOf, useSelection } from "../lib/files";
import type { Finding, Item, Person, Role } from "../lib/types";
import { ChartIcon, CheckIcon, CrossIcon, DatasetIcon, KeyIcon, LinkIcon } from "./Icons";
import { Block, ConsentBlock, FindingTag } from "./Shared";
import { Timeline } from "./Timeline";

/** The record of a donation, in the six parts of data provenance, between an overview and the full history. */
const TABS = [
  { id: "overview", label: "Overview" },
  { id: "origin", label: "Origin" },
  { id: "transformations", label: "Transformations" },
  { id: "linkages", label: "Linkages" },
  { id: "access", label: "Access" },
  { id: "permissions", label: "Permissions" },
  { id: "derivatives", label: "Derivatives" },
  { id: "history", label: "History" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const STATUS_TEXT: Record<Item["status"], string> = { active: "Stored", deleted: "Deleted", "access-restricted": "Kept, restricted" };

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {head.map((title) => (
              <th key={title}>{title}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Nothing({ icon }: { icon: ReactNode }) {
  return <div className="empty small">{icon}</div>;
}

/** Where each item came from: the platform, who holds the original, how and when it was exported, whose account. */
function Origin({ person, role, marked }: { person: Person; role: Role; marked: string | null }) {
  const { items, events } = person.manifest;
  const recorded = (item: Item) => events.find((entry) => entry.item === item.id);
  return (
    <Table head={["File", "Platform", "Original held by", "Export", "Exported", "Account", "Received", "SHA-256", "Ledger"]}>
      {items
        .filter((item) => item.derived_from.length === 0)
        .map((item) => (
          <tr key={item.id} className={item.id === marked ? "chosen" : undefined}>
            <td className="lead-cell">{fileName(item.path)}</td>
            <td>{item.source.platform}</td>
            <td>{item.source.holder}</td>
            <td>{item.source.export_method ?? ""}</td>
            <td className="mono">{item.source.exported ?? ""}</td>
            <td>{item.source.account_holder ?? ""}</td>
            <td className="mono">{item.recorded}</td>
            <td className="mono" title={item.sha256}>
              {shortHash(item.sha256, 16)}
            </td>
            <td>
              {recorded(item) && (
                <a className="mono" href={`#${role}/ledger/${person.id}.${recorded(item)!.index}`} title="Show the entry in the ledger">
                  #{recorded(item)!.index}
                </a>
              )}
            </td>
          </tr>
        ))}
    </Table>
  );
}

/** Each processing step that produced a new item, with its inputs. */
function Transformations({ items }: { items: Item[] }) {
  const names = new Map(items.map((item) => [item.id, fileName(item.path)]));
  const derived = items.filter((item) => item.derived_from.length > 0);
  if (derived.length === 0) return <Nothing icon={<DatasetIcon size={36} />} />;
  return (
    <Table head={["Step", "Output", "Inputs", "Removed", "By", "Date", "SHA-256"]}>
      {derived.map((item) => (
        <tr key={item.id}>
          <td>{item.activity}</td>
          <td>{fileName(item.path)}</td>
          <td className="wrap">{item.derived_from.map((parent) => names.get(parent) ?? parent).join(", ")}</td>
          <td>
            {item.removed &&
              Object.entries(item.removed)
                .map(([kind, count]) => `${count} ${kind}${count === 1 ? "" : kind.endsWith("s") ? "es" : "s"}`)
                .join(", ")}
          </td>
          <td>{item.recorded_by}</td>
          <td className="mono">{item.recorded}</td>
          <td className="mono" title={item.sha256}>
            {shortHash(item.sha256, 16)}
          </td>
        </tr>
      ))}
    </Table>
  );
}

/** The connection between the donated chats and the hospital record. */
function Linkages({ items }: { items: Item[] }) {
  const record = items.find((item) => item.kind === "clinical record");
  const linked = items.filter((item) => item.kind === "derived dataset" && record && item.derived_from.includes(record.id));
  if (!record) return <Nothing icon={<LinkIcon size={36} />} />;
  return (
    <Table head={["Hospital record", "Linked in", "Chats linked", "By", "Date", "Health information"]}>
      {linked.map((item) => (
        <tr key={item.id}>
          <td>{fileName(record.path)}</td>
          <td>{fileName(item.path)}</td>
          <td>{item.derived_from.length - 1}</td>
          <td>{item.recorded_by}</td>
          <td className="mono">{item.recorded}</td>
          <td>{item.contains_phi ? "Protected" : ""}</td>
        </tr>
      ))}
    </Table>
  );
}

/** Every request to use the data: who asked, for what purpose, and whether the consent allowed it. */
function Access({ person, marked }: { person: Person; marked: string | null }) {
  const names = new Map(person.manifest.items.map((item) => [item.id, fileName(item.path)]));
  const requests = person.manifest.events.filter((entry) => entry.action === "use" || entry.action === "refused");
  if (requests.length === 0) return <Nothing icon={<KeyIcon size={36} />} />;
  return (
    <Table head={["File", "Decision", "Purpose", "Who", "Date"]}>
      {requests.map((entry) => (
        <tr key={entry.index} className={entry.item === marked ? "chosen" : undefined}>
          <td className="lead-cell">{names.get(entry.item) ?? entry.item}</td>
          <td>
            <span className={`tag ${entry.action === "use" ? "green" : "red"}`}>{entry.action === "use" ? "Granted" : "Refused"}</span>
          </td>
          <td className="wrap">{entry.purpose}</td>
          <td>{entry.actor}</td>
          <td className="mono">{entry.date}</td>
        </tr>
      ))}
    </Table>
  );
}

/** Who agreed, the purposes the consent approves and forbids, and the retention rule of each item. */
function Permissions({ person }: { person: Person }) {
  const { consent, completeness, items } = person.manifest;
  return (
    <>
      <ConsentBlock consent={consent} completeness={completeness} />
      <Block title="Purposes">
        <ul className="marks">
          {(consent.offered_uses ?? consent.permitted_uses).map((use) => (
            <li key={use}>
              <span className={consent.permitted_uses.includes(use) ? "good" : "bad"}>{consent.permitted_uses.includes(use) ? <CheckIcon /> : <CrossIcon />}</span>
              {use}
              {!consent.permitted_uses.includes(use) && <span className="quiet">switched off by the family</span>}
            </li>
          ))}
          {consent.prohibited_uses.map((use) => (
            <li key={use}>
              <span className="bad">
                <CrossIcon />
              </span>
              {use}
            </li>
          ))}
        </ul>
      </Block>
      <Block title="Retention" flush>
        <Table head={["File", "Rule", "Status"]}>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{fileName(item.path)}</td>
              <td className="wrap">{item.retention}</td>
              <td>{STATUS_TEXT[item.status]}</td>
            </tr>
          ))}
        </Table>
      </Block>
    </>
  );
}

/** What was made from the donation: datasets derived from it and findings computed from those. */
function Derivatives({ person, findings }: { person: Person; findings: Finding[] }) {
  const datasets = person.manifest.items.filter((item) => item.derived_from.length > 0);
  const used = findings.filter((finding) => finding.inputs.some((input) => input.participant === person.id));
  if (datasets.length === 0 && used.length === 0) return <Nothing icon={<ChartIcon size={36} />} />;
  return (
    <Table head={["Derivative", "Kind", "Made", "By", "Status"]}>
      {datasets.map((item) => (
        <tr key={item.id}>
          <td>{fileName(item.path)}</td>
          <td>{item.kind}</td>
          <td className="mono">{item.recorded}</td>
          <td>{item.recorded_by}</td>
          <td>{STATUS_TEXT[item.status]}</td>
        </tr>
      ))}
      {used.map((finding) => (
        <tr key={finding.id}>
          <td>{finding.id}</td>
          <td>finding</td>
          <td className="mono">{finding.created}</td>
          <td>{finding.created_by}</td>
          <td>
            <FindingTag status={finding.status} />
          </td>
        </tr>
      ))}
    </Table>
  );
}

/** The parts of a donation page. The overview is given by the page; the records are the same for every role. */
export function DonationTabs({ person, findings, role, children }: { person: Person; findings: Finding[]; role: Role; children: ReactNode }) {
  const [open, setOpen] = useState<TabId>("overview");
  const { items } = person.manifest;
  // The file the address names, or the first. It is marked in the tables when the donation has several files.
  const selection = useSelection();
  const files = filesOf(person, null);
  const marked = files.length > 1 ? (items.find((item) => item.id === selection)?.id ?? files[0].key) : null;
  return (
    <>
      <div className="tabs" role="tablist">
        {TABS.map((tab) => (
          <button key={tab.id} role="tab" aria-selected={open === tab.id} onClick={() => setOpen(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>
      <div className="tab-body" role="tabpanel">
        {open === "overview" && children}
        {open === "origin" && <Origin person={person} role={role} marked={marked} />}
        {open === "transformations" && <Transformations items={items} />}
        {open === "linkages" && <Linkages items={items} />}
        {open === "access" && <Access person={person} marked={marked} />}
        {open === "permissions" && <Permissions person={person} />}
        {open === "derivatives" && <Derivatives person={person} findings={findings} />}
        {open === "history" && <Timeline person={person} role={role} bare />}
      </div>
    </>
  );
}
