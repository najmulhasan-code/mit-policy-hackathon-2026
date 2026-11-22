"use client";

import { useState } from "react";
import { filesOf } from "../lib/files";
import type { Act, Person, Role, State } from "../lib/types";
import { ExitIcon, TrashIcon } from "./Icons";

const REQUESTERS: [string, string][] = [
  ["participant", "Participant"],
  ["parent", "Parent or guardian"],
];

const requesterName = (value: string) => REQUESTERS.find(([key]) => key === value)?.[1] ?? value;

/** One received donation on the withdrawals page: its files, where its withdrawal stands, and what this role can do. */
function Row({ person, role, act, busy }: { person: Person; role: Role; act: Act; busy: boolean }) {
  const [requester, setRequester] = useState("participant");
  const files = filesOf(person, null);
  const done = person.manifest.withdrawal;
  const asked = person.pending_request;
  const canAsk = role === "family" && !done && !asked;
  const open = () => {
    window.location.hash = `${role}/${person.id}`;
  };
  return (
    <tr className="row-link" data-participant={person.id} onClick={open}>
      <td>
        <ul className="file-names">
          {files.map((file) => (
            <li key={file.key} className={file.mark === "off" ? "gone" : undefined}>
              <span className={`pip ${file.mark}`} /> {file.name}
            </li>
          ))}
        </ul>
      </td>
      <td className="mono quiet">{person.id}</td>
      <td>{done ? "Withdrawn" : asked ? "Requested" : "Active"}</td>
      <td onClick={(event) => (canAsk ? event.stopPropagation() : undefined)}>
        {canAsk ? (
          <select className="asker" aria-label={`Who asks to withdraw ${person.id}`} value={requester} onChange={(event) => setRequester(event.target.value)}>
            {REQUESTERS.map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        ) : done ? (
          requesterName(done.requested_by)
        ) : asked ? (
          requesterName(asked.requested_by)
        ) : (
          ""
        )}
      </td>
      <td className="mono">{done ? done.date : asked ? asked.date : ""}</td>
      <td>{done ? `${person.manifest.items.filter((item) => item.status === "deleted").length} deleted` : ""}</td>
      <td className="mono">{done && role !== "study" ? done.receipt_code : ""}</td>
      <td onClick={(event) => event.stopPropagation()}>
        {canAsk && (
          <button
            className="button warning"
            disabled={busy}
            onClick={() => act("/api/request-withdrawal", { participant: person.id, requested_by: requester }, "Withdrawal requested")}
          >
            <ExitIcon /> Withdraw
          </button>
        )}
        {role === "study" && asked && !done && (
          <a className="button warning" href={`#study/${person.id}`}>
            <TrashIcon /> Carry out
          </a>
        )}
      </td>
    </tr>
  );
}

/** Every received donation with the state of its withdrawal. The family asks here, and the research team sees what waits. */
export function WithdrawalsView({ state, role, act, busy }: { state: State; role: Role; act: Act; busy: boolean }) {
  const order = (person: Person) => (person.pending_request && !person.manifest.withdrawal ? 0 : person.manifest.withdrawal ? 2 : 1);
  const people = [...state.participants].sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id));
  return (
    <>
      <div className="heading">
        <h1>Withdrawals</h1>
      </div>
      {people.length === 0 ? (
        <div className="empty">
          <span className="empty-text">No received files</span>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="withdrawals">
            <thead>
              <tr>
                <th>Files</th>
                <th>Donor</th>
                <th>Withdrawal</th>
                <th>Asked by</th>
                <th>Date</th>
                <th>Research copies</th>
                <th>{role !== "study" ? "Receipt code" : ""}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <Row key={person.id} person={person} role={role} act={act} busy={busy} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
