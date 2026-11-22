import type { ReactNode } from "react";
import { fileName } from "../lib/api";
import type { LogEntry, Person, Role } from "../lib/types";
import { ChartIcon, CheckIcon, ClockIcon, CrossIcon, ExitIcon, FileIcon, KeyIcon, LinkIcon, LockIcon, RecordIcon, TrashIcon } from "./Icons";
import { Block } from "./Shared";

/** What a log entry records, as a short phrase, with the icon of the kind of action. The file it names is shown before it. */
function describe(entry: LogEntry): { icon: ReactNode; text: string } {
  switch (entry.action) {
    case "intake":
      return { icon: <FileIcon />, text: "Received" };
    case "redaction":
      return { icon: <FileIcon />, text: "Direct identifiers removed" };
    case "registration":
      return { icon: <RecordIcon />, text: "Hospital record added" };
    case "linkage":
      return { icon: <LinkIcon />, text: "Chats linked to hospital visits" };
    case "use":
      return { icon: <KeyIcon />, text: `Access granted: ${entry.purpose}` };
    case "refused":
      return { icon: <CrossIcon />, text: `Access refused: ${entry.purpose}` };
    case "included in finding":
      return { icon: <ChartIcon />, text: `Used in finding ${entry.item}` };
    case "finding marked outdated":
      return { icon: <ChartIcon />, text: `Finding ${entry.item} marked outdated` };
    case "finding retired":
      return { icon: <ChartIcon />, text: `Finding ${entry.item} retired and recomputed` };
    case "permissions updated":
      return { icon: <KeyIcon />, text: `Permissions changed. Now ${entry.purpose}` };
    case "consent renewed":
      return { icon: <KeyIcon />, text: "Consent renewed by the participant at 18" };
    case "withdrawal requested":
      return { icon: <ExitIcon />, text: "Withdrawal requested" };
    case "withdrawal started":
      return { icon: <ExitIcon />, text: "Withdrawal started, identity confirmed" };
    case "access restricted":
      return { icon: <LockIcon />, text: "Hospital record kept by law, access restricted" };
    case "deleted":
      return { icon: <TrashIcon />, text: "Deleted" };
    case "receipt issued":
      return { icon: <KeyIcon />, text: "Receipt issued" };
    default:
      return { icon: <ClockIcon />, text: entry.action };
  }
}

/**
 * Everything that happened to a donation, oldest first, read from its log. The mark shows whether the entry's hash still holds
 * and opens the entry in the ledger.
 * `bare` leaves out the section title, for the tab that already carries the name.
 */
export function Timeline({ person, role, bare }: { person: Person; role: Role; bare?: boolean }) {
  const names = new Map(person.manifest.items.map((item) => [item.id, fileName(item.path)]));
  const broken = new Set(person.broken_links);
  const list = (
      <ol className="timeline">
        {person.manifest.events.map((entry) => {
          const { icon, text } = describe(entry);
          const file = names.get(entry.item);
          const holds = !broken.has(entry.index);
          return (
            <li key={entry.index}>
              <span className="timeline-icon">{icon}</span>
              <span className="timeline-text">
                {file && <span className="timeline-file">{file}</span>}
                {text}
              </span>
              <span className="quiet">{entry.actor}</span>
              <span className="mono quiet">{entry.date}</span>
              <a
                className={holds ? "good" : "bad"}
                href={`#${role}/ledger/${person.id}.${entry.index}`}
                title={`Entry #${entry.index} in the ledger`}
              >
                {holds ? <CheckIcon size={16} /> : <CrossIcon size={16} />}
                <span className="visually-hidden">{holds ? "hash holds, show in the ledger" : "hash mismatch, show in the ledger"}</span>
              </a>
            </li>
          );
        })}
      </ol>
  );
  if (bare) return list;
  return (
    <Block title="History" flush>
      {list}
    </Block>
  );
}
