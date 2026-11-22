"use client";

import { useState } from "react";
import { fileName } from "../lib/api";
import { useSelection } from "../lib/files";
import type { Act, Person, State, ViewProps, Waiting } from "../lib/types";
import { stageOf } from "../lib/types";
import { CheckIcon, KeyIcon, LinkIcon, PeopleIcon, PersonIcon, TrashIcon, UploadIcon } from "./Icons";
import { DonationTabs } from "./DonationTabs";
import { Lineage } from "./Lineage";
import { Block, ConsentBlock, DetailHead } from "./Shared";

export function StudyView({ state, person, waiting, act, busy }: ViewProps) {
  if (person) return <Received state={state} person={person} act={act} busy={busy} />;
  if (waiting) return <Inbox state={state} waiting={waiting} act={act} busy={busy} />;
  return null;
}

function Inbox({ state, waiting, act, busy }: { state: State; waiting: Waiting; act: Act; busy: boolean }) {
  const { consent } = waiting;
  const complete = consent.parental_permission.given && consent.child_assent.given;
  return (
    <>
      <DetailHead role="study" id={waiting.id} stage="submitted" person={null} waiting={waiting}>
        <button
          className="button"
          disabled={busy || !complete}
          onClick={() => act("/api/intake", { participant: waiting.id }, `${waiting.id} received`)}
        >
          <CheckIcon /> Receive
        </button>
      </DetailHead>
      <Lineage person={null} waiting={waiting} findings={state.findings} />
      <ConsentBlock consent={consent} completeness={waiting.completeness} />
    </>
  );
}

type Visit = { date: string; type: string };

/** The purpose under which the chats are linked to the hospital record. */
const LINKAGE = "linkage to the health record for this study";

/**
 * Read the visits from a hospital record file. Two forms are read: a FHIR Bundle of Encounter
 * resources, and a JSON object with an `encounters` list of {date, type}.
 */
function readVisits(text: string): Visit[] {
  const record = JSON.parse(text);
  if (Array.isArray(record?.encounters)) {
    return record.encounters.map((visit: Visit) => ({ date: String(visit.date).slice(0, 10), type: String(visit.type ?? "visit") }));
  }
  if (record?.resourceType === "Bundle" && Array.isArray(record.entry)) {
    return record.entry
      .map((entry: { resource?: Record<string, never> }) => entry.resource as Record<string, never> | undefined)
      .filter((resource?: Record<string, never>) => resource?.["resourceType"] === "Encounter")
      .map((resource: { period?: { start?: string }; actualPeriod?: { start?: string }; type?: { text?: string }[]; class?: { display?: string } }) => ({
        date: String(resource.period?.start ?? resource.actualPeriod?.start ?? "").slice(0, 10),
        type: resource.type?.[0]?.text ?? resource.class?.display ?? "visit",
      }));
  }
  return [];
}

function Received({ state, person, act, busy }: { state: State; person: Person; act: Act; busy: boolean }) {
  const [record, setRecord] = useState<{ name: string; visits: Visit[] } | null>(null);
  // The file picked for a request, kept with the address it was picked under. Without one, the file the address names is picked.
  const selection = useSelection();
  const [picked, setPicked] = useState<{ under: string; id: string } | null>(null);
  const itemId = picked && picked.under === selection ? picked.id : selection;
  const setItemId = (id: string) => setPicked({ under: selection, id });
  const [purpose, setPurpose] = useState("");
  const [identityConfirmed, setIdentityConfirmed] = useState(false);

  const { manifest } = person;
  const withdrawn = manifest.withdrawal;
  const pending = person.pending_request;
  const clinical = manifest.items.find((item) => item.kind === "clinical record");
  const usable = manifest.items.filter((item) => item.status === "active" && item.kind !== "clinical record");
  const purposes = [...(manifest.consent.offered_uses ?? manifest.consent.permitted_uses), ...manifest.consent.prohibited_uses];
  const chosenItem = usable.some((item) => item.id === itemId) ? itemId : (usable[0]?.id ?? "");
  const chosenPurpose = purposes.includes(purpose) ? purpose : (purposes[0] ?? "");
  const requests = manifest.events.filter((entry) => entry.action === "use" || entry.action === "refused");
  const names = new Map(manifest.items.map((item) => [item.id, fileName(item.path)]));
  const valid = record?.visits.filter((visit) => /^\d{4}-\d{2}-\d{2}$/.test(visit.date)) ?? [];
  // Once the family has changed its permissions, linkage needs its purpose to be among those still permitted.
  const linkageOff = manifest.consent.offered_uses !== undefined && !manifest.consent.permitted_uses.includes(LINKAGE);

  async function choose(file: File | undefined) {
    if (!file) return;
    try {
      setRecord({ name: file.name, visits: readVisits(await file.text()) });
    } catch {
      setRecord({ name: file.name, visits: [] });
    }
  }

  return (
    <>
      <DetailHead role="study" id={person.id} stage={stageOf(person)} person={person} />
      <DonationTabs person={person} findings={state.findings} role="study">
      <Lineage person={person} waiting={null} findings={state.findings} />

      {!clinical && !withdrawn && (
        <Block title="Hospital record">
          <div className="form-row">
            <label className="button secondary">
              <UploadIcon /> {record ? record.name : "Record export"}
              <input
                className="hidden-input"
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  const file = Array.from(event.target.files ?? [])[0];
                  event.target.value = "";
                  choose(file);
                }}
              />
            </label>
            {record && <span className={`tag ${valid.length ? "green" : "red"}`}>{valid.length} visits</span>}
            <button
              className="button"
              disabled={busy || valid.length === 0 || linkageOff}
              onClick={() => act("/api/link", { participant: person.id, encounters: valid }, "Hospital record linked")}
            >
              <LinkIcon /> Link
            </button>
          </div>
          {valid.length > 0 && (
            <div className="table-wrap">
              <table>
                <tbody>
                  {valid.map((visit, index) => (
                    <tr key={index}>
                      <td className="mono">{visit.date}</td>
                      <td>{visit.type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Block>
      )}

      {(!withdrawn || requests.length > 0) && (
        <Block title="Data access" side={withdrawn && <span className="tag">Closed</span>}>
          {!withdrawn && (
            <div className="form-row">
              <select aria-label="File" value={chosenItem} onChange={(event) => setItemId(event.target.value)}>
                {usable.map((item) => (
                  <option key={item.id} value={item.id}>
                    {fileName(item.path)}
                  </option>
                ))}
              </select>
              <select aria-label="Purpose" className="grow" value={chosenPurpose} onChange={(event) => setPurpose(event.target.value)}>
                {purposes.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
              <button
                className="button"
                disabled={busy || !chosenItem}
                onClick={() =>
                  act("/api/use", { participant: person.id, item: chosenItem, purpose: chosenPurpose }, (result) =>
                    result.permitted ? { kind: "ok", text: "Access granted" } : { kind: "error", text: "Access refused by the consent" },
                  )
                }
              >
                <KeyIcon /> Request
              </button>
            </div>
          )}
          {requests.length > 0 && (
            <div className="table-wrap">
              <table>
                <tbody>
                  {requests.map((entry) => (
                    <tr key={entry.index}>
                      <td>
                        <span className={`tag ${entry.action === "use" ? "green" : "red"}`}>{entry.action === "use" ? "Granted" : "Refused"}</span>
                      </td>
                      <td>{names.get(entry.item) ?? entry.item}</td>
                      <td className="wrap">{entry.purpose}</td>
                      <td>{entry.actor}</td>
                      <td className="mono">{entry.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Block>
      )}

      {(withdrawn || pending) && (
        <Block
          title="Withdrawal"
          side={withdrawn ? <span className="tag">Carried out {withdrawn.date}</span> : <span className="tag amber">Requested {pending!.date}</span>}
        >
          {withdrawn ? (
            <ul className="marks">
              <li>
                <span className="quiet">
                  <PeopleIcon />
                </span>
                Requested by the {withdrawn.requested_by}
              </li>
              <li>
                <span className="quiet">
                  <PersonIcon />
                </span>
                {withdrawn.staff}
              </li>
              <li>
                <span className="quiet">
                  <KeyIcon />
                </span>
                <span className="mono">{withdrawn.receipt_code}</span>
              </li>
            </ul>
          ) : (
            <div className="form-row">
              <label className="choice">
                <input type="checkbox" checked={identityConfirmed} onChange={(event) => setIdentityConfirmed(event.target.checked)} />
                Identity of the {pending!.requested_by} confirmed
              </label>
              <button
                className="button warning"
                disabled={busy || !identityConfirmed}
                onClick={() => act("/api/withdraw", { participant: person.id, identity_confirmed: identityConfirmed }, "Research copies deleted, receipt issued")}
              >
                <TrashIcon /> Delete research copies
              </button>
            </div>
          )}
        </Block>
      )}
      </DonationTabs>
    </>
  );
}
