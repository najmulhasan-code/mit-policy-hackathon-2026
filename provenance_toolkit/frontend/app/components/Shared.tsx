import type { ReactNode } from "react";
import { filesOf, useSelection } from "../lib/files";
import type { Check, Consent, Finding, Person, Role, Stage, Waiting } from "../lib/types";
import { nextStep, ROLE_LABEL, STAGE_LABEL } from "../lib/types";
import { BackIcon, CheckIcon, CrossIcon, PersonIcon } from "./Icons";

const STAGE_TONE: Record<Stage, string> = { submitted: "blue", active: "green", requested: "amber", withdrawn: "" };

export function StageTag({ stage }: { stage: Stage }) {
  return <span className={`tag ${STAGE_TONE[stage]}`}>{STAGE_LABEL[stage]}</span>;
}

const FINDING_TONE: Record<Finding["status"], string> = { current: "green", outdated: "red", retired: "" };

export function FindingTag({ status }: { status: Finding["status"] }) {
  return <span className={`tag ${FINDING_TONE[status]}`}>{status[0].toUpperCase() + status.slice(1)}</span>;
}

/**
 * The top of a donation page: a way back to the list, the chosen file, the participant number, the stage and the page's actions.
 * A donation of several files has a row under the heading that names each one. The chosen file is the one the address names, or the first.
 */
export function DetailHead({ role, id, stage, person, waiting, children }: { role: Role; id: string; stage?: Stage; person: Person | null; waiting?: Waiting | null; children?: ReactNode }) {
  const next = nextStep(person);
  const selection = useSelection();
  const files = filesOf(person, waiting ?? null);
  const chosen = files.find((file) => file.key === selection) ?? files[0];
  return (
    <>
    <div className={`heading${files.length > 1 ? " with-files" : ""}`} data-participant={id}>
      <a className="icon-button plain" href={`#${role}/donations`} aria-label="Back to files" title="Files">
        <BackIcon />
      </a>
      <h1>{chosen ? chosen.name : id}</h1>
      {chosen && <span className="donor mono">{id}</span>}
      {files.length > 1 && <span className="donor">{files.length} files</span>}
      {chosen && person && (
        <a className="donor" href={`#${role}/ledger/${chosen.key}`}>
          Ledger
        </a>
      )}
      {stage && <StageTag stage={stage} />}
      {next && (
        <span className={`next${next.role === role ? " mine" : ""}`}>
          {next.role === role ? next.text : `${ROLE_LABEL[next.role]}: ${next.text}`}
        </span>
      )}
      {children && <span className="heading-actions">{children}</span>}
    </div>
    {files.length > 1 && (
      <nav className="file-switch" aria-label="Files of the donation">
        {files.map((file) => (
          <a key={file.key} href={`#${role}/${id}/${encodeURIComponent(file.key)}`} title={file.state} aria-current={file.key === chosen.key ? "true" : undefined}>
            <span className={`pip ${file.mark}`} /> {file.name}
            <span className="file-platform">{file.platform}</span>
          </a>
        ))}
      </nav>
    )}
    </>
  );
}

/** A titled section of the working area. `side` sits at the right of the title. */
export function Block({ title, side, flush, children }: { title: string; side?: ReactNode; flush?: boolean; children?: ReactNode }) {
  return (
    <section className="block">
      <div className="block-head">
        <h2>{title}</h2>
        {side}
      </div>
      {children && <div className={`block-body${flush ? " flush" : ""}`}>{children}</div>}
    </section>
  );
}

/** The consent on record: who agreed and when, what it allows, and what it forbids. */
export function ConsentBlock({ consent, completeness }: { consent: Consent; completeness: string }) {
  const complete = consent.parental_permission.given && consent.child_assent.given;
  const mark = (given: boolean) => <span className={given ? "good" : "bad"}>{given ? <CheckIcon /> : <CrossIcon />}</span>;
  return (
    <Block title="Consent" side={<span className={`tag ${complete ? "green" : "red"}`}>{complete ? "Complete" : "Incomplete"}</span>}>
      <ul className="marks">
        <li>
          {mark(consent.parental_permission.given)} Parent or guardian permission <span className="mono quiet">{consent.parental_permission.date}</span>
        </li>
        <li>
          {mark(consent.child_assent.given)} Participant agreement <span className="mono quiet">{consent.child_assent.date}</span>
        </li>
        <li>
          <span className="quiet">
            <PersonIcon />
          </span>
          Turns 18 on <span className="mono quiet">{consent.participant_turns_18}</span>
        </li>
      </ul>
      {completeness && completeness !== "No statement given." && <p className="quiet">Stated by the family: {completeness}</p>}
    </Block>
  );
}

/** A list of checks, each with a pass or fail mark and the detail the engine reported. */
export function CheckList({ checks }: { checks: Check[] }) {
  return (
    <ul className="checks">
      {checks.map((check) => (
        <li key={check.check} className={check.passed ? "" : "failed"}>
          <span className={`check-mark${check.passed ? "" : " fail"}`}>
            {check.passed ? <CheckIcon size={13} /> : <CrossIcon size={13} />}
            <span className="visually-hidden">{check.passed ? "passed" : "failed"}</span>
          </span>
          <span className="check-name">{check.check}</span>
          <span className="check-detail">{check.detail}</span>
        </li>
      ))}
    </ul>
  );
}

/* The accent of the interface, its tint, the ink and five greys. */
const STRIP = ["var(--blue)", "var(--blue-tint)", "#14171a", "#59636e", "#7d8791", "#a3acb5", "#c6ccd2", "#e4e7ea"];

/** A hash drawn as 32 cells, one per byte, so that a changed value looks different at a glance. */
export function HashStrip({ hash }: { hash: string }) {
  const bytes = hash.match(/../g) ?? [];
  return (
    <span className="strip" aria-hidden="true">
      {bytes.map((byte, index) => (
        <i key={index} style={{ background: STRIP[parseInt(byte, 16) % STRIP.length] }} />
      ))}
    </span>
  );
}
