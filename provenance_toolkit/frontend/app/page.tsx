"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { AuditorView } from "./components/AuditorView";
import { DonationForm, FamilyView } from "./components/FamilyView";
import { FindingsView } from "./components/FindingsView";
import { LedgerView } from "./components/LedgerView";
import { AlertIcon, BuildingIcon, ChartIcon, CheckIcon, CrossIcon, DownloadIcon, ExitIcon, LinkIcon, PeopleIcon, SealIcon, TrashIcon, TreeIcon, UploadIcon } from "./components/Icons";
import { StageTag } from "./components/Shared";
import { StudyView } from "./components/StudyView";
import { SystemPanel } from "./components/SystemPanel";
import { WithdrawalsView } from "./components/WithdrawalsView";
import { chooseRole, getSession, getState, leaveRole, NoRole, post, Refused, shortHash } from "./lib/api";
import { fileAddress, filesOf } from "./lib/files";
import type { FileEntry } from "./lib/files";
import type { Act, Notice, Person, Role, State, Waiting } from "./lib/types";
import { nextStep, ROLE_LABEL, stageOf } from "./lib/types";

/** Where an action on the start page leads: a page of the role. Without one, the role opens on its first page. */
type Target = { page?: string };
type RoleEntry = { id: Role; label: string; icon: (size: number) => ReactNode; can: ({ text: string; icon: ReactNode } & Target)[] };

/** The three parties of a data donation, and what each one does here. */
const ROLES: RoleEntry[] = [
  {
    id: "family",
    label: "Family",
    icon: (size) => <PeopleIcon size={size} />,
    can: [
      { text: "Donate chat exports", page: "new", icon: <UploadIcon size={24} /> },
      { text: "Follow the data", icon: <TreeIcon size={24} /> },
      { text: "Withdraw", page: "withdrawals", icon: <ExitIcon size={24} /> },
    ],
  },
  {
    id: "study",
    label: "Research team",
    icon: (size) => <BuildingIcon size={size} />,
    can: [
      { text: "Receive donations", icon: <DownloadIcon size={24} /> },
      { text: "Run the analysis", page: "findings", icon: <ChartIcon size={24} /> },
      { text: "Carry out withdrawals", page: "withdrawals", icon: <TrashIcon size={24} /> },
    ],
  },
  {
    id: "auditor",
    label: "Auditor",
    icon: (size) => <SealIcon size={size} />,
    can: [
      { text: "Verify a donation", icon: <CheckIcon size={24} /> },
      { text: "Inspect the ledger", page: "ledger", icon: <TreeIcon size={24} /> },
      { text: "Read the findings", page: "findings", icon: <ChartIcon size={24} /> },
    ],
  },
];

const LIST = "donations";
const FINDINGS = "findings";
const NEW = "new";
const LEDGER = "ledger";
const WITHDRAWALS = "withdrawals";
const REFRESH_MS = 4000;

function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

const currentHash = () => window.location.hash.slice(1);

/** The address after the # names the page: study/donations, study/P-0001, auditor/findings, family/new. */
const pageOf = (hash: string) => hash.split("/")[1] || LIST;

/** The start page: the three parties and what each does here. */
function StartPage({ enter, busy }: { enter: (role: Role, target?: Target) => void; busy: boolean }) {
  return (
    <div className="doors">
      {ROLES.map((entry) => (
        <div key={entry.id} className={`door door-${entry.id}`}>
          <button type="button" className="door-head" disabled={busy} onClick={() => enter(entry.id)}>
            <span className="door-ghost">{entry.icon(150)}</span>
            <span className="door-icon">{entry.icon(26)}</span>
            <span className="door-name">{entry.label}</span>
          </button>
          <div className="door-can">
            {entry.can.map((action) => (
              <button key={action.text} type="button" disabled={busy} onClick={() => enter(entry.id, action)}>
                {action.icon}
                {action.text}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

type Donation = { id: string; person: Person | null; waiting: Waiting | null };

function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ stroke: "var(--blue)" }} strokeWidth="2.2" aria-hidden="true">
      <rect x="3" y="9.500" width="5" height="5" />
      <rect x="16" y="3" width="5" height="5" />
      <rect x="16" y="16" width="5" height="5" />
      <path d="M8 12h4M12 5.500v13M12 5.500h4M12 18.500h4" />
    </svg>
  );
}

function DonationsView({ state, donations, role }: { state: State; donations: Donation[]; role: Role }) {
  const stored = state.participants.flatMap((person) => person.storage);
  const altered = stored.filter((file) => !file.matches).length;
  const donated = donations.reduce((count, donation) => count + filesOf(donation.person, donation.waiting).length, 0);
  return (
    <>
      <div className="heading">
        <h1>Files</h1>
        {role === "family" && (
          <span className="heading-actions">
            <a className="button" href="#family/new">
              <UploadIcon /> Donate
            </a>
          </span>
        )}
      </div>
      {donations.length === 0 ? (
        <div className="empty">
          <UploadIcon size={40} />
          <span className="empty-text">No files</span>
        </div>
      ) : (
        <>
          {donations.length > 1 && (
          <div className="stats">
            <div className="stat">
              <div className="stat-number">{donated}</div>
              <div className="stat-label">Files</div>
            </div>
            <div className="stat">
              <div className="stat-number">{stored.length}</div>
              <div className="stat-label">Files in storage</div>
            </div>
            <div className="stat">
              <div className={`stat-number ${altered ? "bad" : ""}`}>{altered}</div>
              <div className="stat-label">Altered files</div>
            </div>
            <div className="stat">
              <div className="stat-number">{state.ledger.leaves.length}</div>
              <div className="stat-label">Ledger entries</div>
            </div>
            <div className="stat">
              <div className="stat-number">{state.findings.filter((finding) => finding.status === "current").length}</div>
              <div className="stat-label">Current findings</div>
            </div>
            <div className="stat minor">
              <div className="stat-number">{donations.length}</div>
              <div className="stat-label">Participants</div>
            </div>
          </div>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Platform</th>
                  <th>Fingerprint</th>
                  <th>Donor</th>
                  <th>Status</th>
                  <th>Hospital record</th>
                  <th>Log</th>
                  <th>Verification</th>
                  <th>Next</th>
                </tr>
              </thead>
              <tbody>
                {donations.flatMap(({ id, person, waiting }) => {
                  const files = filesOf(person, waiting);
                  const linked = person?.manifest.items.find((item) => item.kind === "clinical record");
                  const intact = person ? person.broken_links.length === 0 && person.seal_mismatches.length === 0 : true;
                  const passed = person?.report?.results.filter((result) => result.passed).length ?? 0;
                  const next = nextStep(person);
                  const shown: (FileEntry | null)[] = files.length > 0 ? files : [null];
                  return shown.map((file, place) => {
                    const lead = place === 0;
                    const address = fileAddress(role, id, files, file);
                    const open = () => {
                      window.location.hash = address;
                    };
                    return (
                      <tr key={`${id} ${file?.key ?? ""}`} className={`row-link${lead ? " lead" : ""}${place < shown.length - 1 ? " joined" : ""}`} data-participant={id} onClick={open}>
                        <td>
                          {file && (
                            <a className={`file-name${file.mark === "off" ? " gone" : ""}`} href={`#${address}`} title={file.state} onClick={(event) => event.stopPropagation()}>
                              <span className={`pip ${file.mark}`} /> {file.name}
                              {file.mark === "no" && <span className="file-fault">{file.state}</span>}
                            </a>
                          )}
                        </td>
                        <td>{file?.platform}</td>
                        <td className="mono quiet" title={file?.sha256}>
                          {file?.sha256 ? shortHash(file.sha256) : ""}
                        </td>
                        <td className="mono quiet">{id}</td>
                        <td>{lead && <StageTag stage={person ? stageOf(person) : "submitted"} />}</td>
                        <td>
                          {lead && linked && (
                            <span className={linked.status === "active" ? "good" : "warn"}>
                              <LinkIcon />
                              <span className="visually-hidden">{linked.status === "active" ? "linked" : "access restricted"}</span>
                            </span>
                          )}
                        </td>
                        <td>
                          {lead && person && (
                            <span className={`state ${intact ? "good" : "bad"}`}>
                              {intact ? <CheckIcon size={15} /> : <CrossIcon size={15} />}
                              <span className="visually-hidden">{intact ? "passed" : "failed"}</span> {person.manifest.events.length}
                            </span>
                          )}
                        </td>
                        <td>
                          {lead && person?.report && (
                            <span className={`state ${person.report.passed ? "good" : "bad"}`}>
                              <SealIcon size={15} />
                              <span className="visually-hidden">{person.report.passed ? "passed" : "failed"}</span> {passed}/{person.report.results.length}
                            </span>
                          )}
                        </td>
                        <td>{lead && next && <span className={next.role === role ? "next mine" : "next"}>{next.role === role ? next.text : `${ROLE_LABEL[next.role]}: ${next.text}`}</span>}</td>
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

export default function Home() {
  const hash = useSyncExternalStore(subscribeToHash, currentHash, () => "");
  const wanted = pageOf(hash);
  const [state, setState] = useState<State | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [toast, setToast] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const shownAt = useRef(0);
  const actions = useRef(0);
  const entered = state !== null;

  // Show a notice and record the time, which the page-change handler below reads.
  const notify = useCallback((next: Notice) => {
    shownAt.current = Date.now();
    setToast(next);
  }, []);

  // A notice belongs to the page it was raised on. Moving to another page clears it,
  // except in the moment after an action that itself opens a page.
  useEffect(() => {
    const clear = () => Date.now() - shownAt.current > 800 && setToast(null);
    window.addEventListener("hashchange", clear);
    return () => window.removeEventListener("hashchange", clear);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.kind === "error" ? 9000 : 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // The server no longer knows which role this browser chose, for example after a restart: back to the start page.
  const failed = useCallback(
    (error: unknown) => {
      if (error instanceof NoRole) {
        setState(null);
        setChoosing(true);
      } else notify({ kind: "error", text: error instanceof Refused ? error.message : "The server cannot be reached" });
    },
    [notify],
  );

  // On opening the page, ask whether this browser has already chosen a role. If that cannot be read, the start page is shown.
  useEffect(() => {
    getSession()
      .then((session) => (session ? getState().then(setState) : setChoosing(true)))
      .catch((error) => {
        failed(error);
        setChoosing(true);
      });
  }, [failed]);

  // Once a role is chosen, the state is read again every few seconds, so a change made outside the interface shows up.
  // `actions` counts completed actions. A reading that started before an action completed is dropped.
  useEffect(() => {
    if (!entered) return;
    let stopped = false;
    const timer = window.setInterval(() => {
      const started = actions.current;
      getState()
        .then((next) => !stopped && started === actions.current && setState(next))
        .catch((error) => !stopped && failed(error));
    }, REFRESH_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [entered, failed]);

  const act: Act = useCallback(
    async (path, body, done) => {
      setBusy(true);
      try {
        const result = await post(path, body);
        actions.current += 1;
        setState(result);
        notify(typeof done === "string" ? { kind: "ok", text: done } : done(result));
        return result;
      } catch (error) {
        actions.current += 1;
        failed(error);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [failed, notify],
  );

  async function enter(role: Role, target: Target = {}) {
    setBusy(true);
    try {
      const next = await chooseRole(role);
      actions.current += 1;
      setState(next);
      setChoosing(false);
      // A study with one donation opens on it. With none, the family opens on the donation form.
      const held = [...next.participants.map((person) => person.id), ...next.waiting.map((waiting) => waiting.id)];
      const landing = held.length === 1 ? `${role}/${held[0]}` : held.length === 0 && role === "family" ? `${role}/${NEW}` : `${role}/${LIST}`;
      window.location.hash = target.page && (target.page !== NEW || role === "family") ? `${role}/${target.page}` : landing;
    } catch (error) {
      failed(error);
    } finally {
      setBusy(false);
    }
  }

  async function changeRole() {
    await leaveRole().catch(() => undefined);
    actions.current += 1;
    setState(null);
    setChoosing(true);
    window.location.hash = "";
  }

  const notice = toast && (
    <p className={`toast${toast.kind === "error" ? " error" : ""}`} role="status">
      {toast.kind === "error" ? <AlertIcon /> : <CheckIcon />}
      {toast.text}
    </p>
  );

  if (!state) {
    return (
      <div className="app">
        <header className="topbar">
          <a className="brand" href="#">
            <Mark /> Provenance Toolkit
          </a>
        </header>
        {choosing && (
          <main className="work">
            <StartPage enter={enter} busy={busy} />
          </main>
        )}
        {notice}
      </div>
    );
  }

  const { role } = state.session;
  const donations: Donation[] = [
    ...state.participants.map((person) => ({ id: person.id, person, waiting: null })),
    ...state.waiting.map((waiting) => ({ id: waiting.id, person: null, waiting })),
  ].sort((a, b) => a.id.localeCompare(b.id));

  const current = donations.find((donation) => donation.id === wanted) ?? null;
  const page = current ? current.id : wanted === NEW && role === "family" ? NEW : wanted === FINDINGS && role !== "family" ? FINDINGS : wanted === LEDGER ? LEDGER : wanted === WITHDRAWALS ? WITHDRAWALS : LIST;

  const mine = ROLES.find((entry) => entry.id === role)!;
  const person = current?.person ?? null;
  const waiting = current?.waiting ?? null;
  const outdated = state.findings.filter((finding) => finding.status === "outdated").length;
  const waitingWithdrawals = state.participants.filter((entry) => entry.pending_request && !entry.manifest.withdrawal).length;
  const props = { state, person, waiting, act, busy };

  return (
    <div className={`app role-${role}`}>
      <header className="topbar">
        <a className="brand" href={`#${role}/${LIST}`}>
          <Mark /> Provenance Toolkit
        </a>
        <nav className="nav" aria-label="Pages">
          <a href={`#${role}/${LIST}`} aria-current={page !== FINDINGS && page !== LEDGER && page !== WITHDRAWALS ? "page" : undefined}>
            Files <span className="count">{donations.reduce((count, donation) => count + filesOf(donation.person, donation.waiting).length, 0)}</span>
          </a>
          {role !== "family" && (
            <a href={`#${role}/${FINDINGS}`} aria-current={page === FINDINGS ? "page" : undefined}>
              Findings {outdated > 0 ? <span className="count alert">{outdated}</span> : <span className="count">{state.findings.length}</span>}
            </a>
          )}
          <a href={`#${role}/${WITHDRAWALS}`} aria-current={page === WITHDRAWALS ? "page" : undefined}>
            Withdrawals{" "}
            <span className={waitingWithdrawals > 0 && role === "study" ? "count alert" : "count"}>
              {waitingWithdrawals > 0 ? waitingWithdrawals : state.participants.filter((entry) => entry.manifest.withdrawal).length}
            </span>
          </a>
          <a href={`#${role}/${LEDGER}`} aria-current={page === LEDGER ? "page" : undefined}>
            Ledger <span className="count">{state.ledger.leaves.length}</span>
          </a>
        </nav>
        <div className="topbar-right">
          <span className="who">
            {mine.icon(16)}
            {mine.label}
          </span>
          <button className="icon-button plain" aria-label="Change role" title="Change role" onClick={changeRole}>
            <ExitIcon />
          </button>
        </div>
      </header>

      <div className="columns">
        <main className="work">
          {page === FINDINGS ? (
            <FindingsView state={state} act={act} busy={busy} canAct={role === "study"} role={role} />
          ) : page === WITHDRAWALS ? (
            <WithdrawalsView state={state} role={role} act={act} busy={busy} />
          ) : page === LEDGER ? (
            <LedgerView state={state} role={role} selection={hash.split("/")[2] ?? null} />
          ) : page === LIST ? (
            <DonationsView state={state} donations={donations} role={role} />
          ) : page === NEW ? (
            <DonationForm
              today={state.today}
              platforms={Object.keys(state.protocol.platforms)}
              act={act}
              busy={busy}
              onUnreadable={() => notify({ kind: "error", text: "The files could not be read" })}
              onDonated={(participant) => {
                window.location.hash = `family/${participant}`;
              }}
            />
          ) : role === "family" ? (
            <FamilyView key={page} {...props} />
          ) : role === "study" ? (
            <StudyView key={page} {...props} />
          ) : (
            <AuditorView key={page} {...props} />
          )}
        </main>
        <SystemPanel state={state} person={person} />
      </div>
      {notice}
    </div>
  );
}
