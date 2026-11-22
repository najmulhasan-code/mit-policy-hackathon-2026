"use client";

import { useState } from "react";
import { fileName, fileSize, shortHash } from "../lib/api";
import { fingerprint } from "../lib/proof";
import type { Act, Check, Person, State, ViewProps, Waiting } from "../lib/types";
import { stageOf } from "../lib/types";
import { BackIcon, CheckIcon, CrossIcon, ExitIcon, FileIcon, ImageIcon, KeyIcon, UploadIcon } from "./Icons";
import { DonationTabs } from "./DonationTabs";
import { Lineage } from "./Lineage";
import { Timeline } from "./Timeline";
import { Block, CheckList, ConsentBlock, DetailHead } from "./Shared";

export function FamilyView({ state, person, waiting, act, busy }: ViewProps) {
  if (person?.manifest.withdrawal) return <Receipt state={state} person={person} act={act} busy={busy} />;
  if (person) return <ActiveDonation state={state} person={person} act={act} busy={busy} />;
  if (waiting) return <Submitted state={state} waiting={waiting} />;
  return null;
}

type Chosen = { file: File; platform: string; accountHolder: string; sha256: string };

/** The purpose under which the chats are linked to the hospital record. */
const LINKAGE = "linkage to the health record for this study";

const PLATFORM_HINTS: [RegExp, string][] = [
  [/chatgpt|openai/i, "ChatGPT"],
  [/character/i, "Character.AI"],
  [/gemini|bard/i, "Gemini"],
  [/snap/i, "Snapchat My AI"],
  [/meta/i, "Meta AI"],
];

async function toBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

function localDate(time: number) {
  const day = new Date(time);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

/** The day a person born on `born` turns 18. A birthday on 29 February falls on 1 March in a common year. */
function eighteenth(born: string) {
  const [year, month, day] = born.split("-").map(Number);
  const date = new Date(year + 18, month - 1, day);
  return localDate(date.getTime());
}

type FormProps = {
  today: string;
  platforms: string[];
  act: Act;
  busy: boolean;
  onDonated: (participant: string) => void;
  /** Called when a chosen file cannot be read from the device. */
  onUnreadable: () => void;
};

/** The donation form. */
export function DonationForm({ today, platforms, act, busy, onDonated, onUnreadable }: FormProps) {
  const [chosen, setChosen] = useState<Chosen[]>([]);
  const [over, setOver] = useState(false);
  const [born, setBorn] = useState("");
  const [permission, setPermission] = useState(false);
  const [assent, setAssent] = useState(false);
  const [sending, setSending] = useState(false);

  const turns18 = born ? eighteenth(born) : "";
  const minor = turns18 > today;
  const ready = chosen.length > 0 && minor && born <= today && permission && assent;

  async function add(files: File[]) {
    const added = await Promise.all(
      files.map(async (file) => {
        const guess = PLATFORM_HINTS.find(([pattern, name]) => pattern.test(file.name) && platforms.includes(name))?.[1];
        return { file, platform: guess ?? (platforms.includes("Other") ? "Other" : platforms[0]), accountHolder: "participant", sha256: await fingerprint(file) };
      }),
    );
    // An attachment with no platform in its name takes the platform of the export it came with.
    setChosen((list) => {
      const all = [...list.filter((entry) => !added.some((next) => next.file.name === entry.file.name)), ...added];
      const named = (entry: Chosen) => PLATFORM_HINTS.some(([pattern]) => pattern.test(entry.file.name));
      const known = all.find(named)?.platform;
      return all.map((entry) => (known && added.includes(entry) && !named(entry) ? { ...entry, platform: known } : entry));
    });
  }

  // `sending` covers the time the files are being read, before the request itself sets `busy`.
  async function submit() {
    if (sending) return;
    setSending(true);
    try {
      const files = await Promise.all(
        chosen.map(async (entry) => ({
          name: entry.file.name,
          platform: entry.platform,
          account_holder: entry.accountHolder,
          sha256: entry.sha256,
          content: await toBase64(entry.file),
        })),
      );
      const newest = Math.max(...chosen.map((entry) => entry.file.lastModified));
      const exported = [localDate(newest), today].sort()[0];
      const result = await act(
        "/api/donate",
        { files, exported, completeness: "", participant_turns_18: turns18, parental_permission: permission, child_assent: assent },
        (done) => ({ kind: "ok", text: `${done.participant} submitted` }),
      );
      if (result?.participant) onDonated(result.participant);
    } catch {
      onUnreadable();
    } finally {
      setSending(false);
    }
  }

  const picker = (
    <label
      className={`drop${over ? " over" : ""}${chosen.length > 0 ? " slim" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        add(Array.from(event.dataTransfer.files));
      }}
    >
      <UploadIcon size={chosen.length > 0 ? 16 : 30} />
      {chosen.length > 0 ? "Add files" : "Chat export files"}
      <input
        className="hidden-input"
        type="file"
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          add(files);
        }}
      />
    </label>
  );

  return (
    <>
      <div className="heading">
        <a className="icon-button plain" href="#family/donations" aria-label="Back to files" title="Files">
          <BackIcon />
        </a>
        <h1>New donation</h1>
      </div>

      {chosen.length === 0 && picker}

      {chosen.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Size</th>
                <th>SHA-256</th>
                <th>Platform</th>
                <th>Account of</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {chosen.map((entry, index) => (
                <tr key={entry.file.name}>
                  <td>
                    <span className="with-icon">
                      {/\.(png|jpe?g|gif|webp)$/i.test(entry.file.name) ? <ImageIcon size={16} /> : <FileIcon size={16} />}
                      {entry.file.name}
                    </span>
                  </td>
                  <td>{fileSize(entry.file.size)}</td>
                  <td className="mono" title={entry.sha256}>
                    {shortHash(entry.sha256, 24)}
                  </td>
                  <td>
                    <select
                      aria-label={`Platform for ${entry.file.name}`}
                      value={entry.platform}
                      onChange={(event) => setChosen((list) => list.map((item, place) => (place === index ? { ...item, platform: event.target.value } : item)))}
                    >
                      {platforms.map((platform) => (
                        <option key={platform}>{platform}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      aria-label={`Account holder for ${entry.file.name}`}
                      value={entry.accountHolder}
                      onChange={(event) => setChosen((list) => list.map((item, place) => (place === index ? { ...item, accountHolder: event.target.value } : item)))}
                    >
                      <option value="participant">The participant</option>
                      <option value="someone else">Someone else</option>
                    </select>
                  </td>
                  <td>
                    <button className="icon-button plain" aria-label={`Remove ${entry.file.name}`} title="Remove" onClick={() => setChosen((list) => list.filter((_, place) => place !== index))}>
                      <CrossIcon size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {chosen.length > 0 && picker}

      <Block title="Consent">
        <div className="form-row">
          <div className="field">
            <label htmlFor="born">Participant&apos;s date of birth</label>
            <input id="born" type="date" value={born} max={today} onChange={(event) => setBorn(event.target.value)} />
          </div>
          {born && <span className={`tag ${minor ? "green" : "red"}`}>{minor ? `Under 18 until ${turns18}` : "18 or older"}</span>}
        </div>
        <label className="choice">
          <input type="checkbox" checked={permission} onChange={(event) => setPermission(event.target.checked)} />
          Parent or guardian gives permission
        </label>
        <label className="choice">
          <input type="checkbox" checked={assent} onChange={(event) => setAssent(event.target.checked)} />
          Participant agrees
        </label>
        <div className="actions">
          <button className="button" disabled={busy || sending || !ready} onClick={submit}>
            <UploadIcon /> Donate
          </button>
        </div>
      </Block>
    </>
  );
}

function Submitted({ state, waiting }: { state: State; waiting: Waiting }) {
  return (
    <>
      <DetailHead role="family" id={waiting.id} stage="submitted" person={null} waiting={waiting} />
      <Lineage person={null} waiting={waiting} findings={state.findings} />
      <ConsentBlock consent={waiting.consent} completeness={waiting.completeness} />
    </>
  );
}

function ActiveDonation({ state, person, act, busy }: { state: State; person: Person; act: Act; busy: boolean }) {
  const [requester, setRequester] = useState("participant");
  const [chosen, setChosen] = useState<string[] | null>(null);
  const pending = person.pending_request;
  const { consent } = person.manifest;
  const offered = consent.offered_uses ?? consent.permitted_uses;
  const permitted = chosen ?? consent.permitted_uses;
  const changed = offered.some((use) => permitted.includes(use) !== consent.permitted_uses.includes(use));
  const adult = state.today >= consent.participant_turns_18;
  // The server refuses to switch linkage off once the linked dataset exists.
  const linked = person.manifest.items.some((item) => item.kind === "derived dataset" && item.status === "active");

  async function update() {
    const done = await act("/api/permissions", { participant: person.id, permitted, requested_by: requester }, "Permissions updated");
    if (done) setChosen(null);
  }

  return (
    <>
      <DetailHead role="family" id={person.id} stage={stageOf(person)} person={person} />
      <DonationTabs person={person} findings={state.findings} role="family">
        <Lineage person={person} waiting={null} findings={state.findings} />

        <fieldset className="form-row who-asks">
          <legend className="hidden-input">Who is asking</legend>
          {[
            ["participant", "Participant"],
            ["parent", "Parent or guardian"],
          ].map(([value, text]) => (
            <label className="choice" key={value}>
              <input type="radio" name="requester" value={value} checked={requester === value} onChange={() => setRequester(value)} />
              {text}
            </label>
          ))}
        </fieldset>

        {adult && !consent.renewed_at_18 && (
          <Block title="Consent at 18" side={<span className="tag amber">Needed since {consent.participant_turns_18}</span>}>
            <button className="button" disabled={busy} onClick={() => act("/api/renew-consent", { participant: person.id }, "Consent renewed")}>
              <CheckIcon /> Renew consent
            </button>
          </Block>
        )}

        <Block title="Permissions">
          {offered.map((use) => (
            <label className="choice" key={use}>
              <input
                type="checkbox"
                checked={permitted.includes(use)}
                disabled={use === LINKAGE && linked}
                onChange={(event) => setChosen(event.target.checked ? [...permitted, use] : permitted.filter((entry) => entry !== use))}
              />
              {use}
            </label>
          ))}
          <div className="actions">
            <button className="button" disabled={busy || !changed} onClick={update}>
              <CheckIcon /> Update
            </button>
          </div>
        </Block>

        <Block title="Withdraw" side={pending && <span className="tag amber">Requested {pending.date}</span>}>
          {!pending && (
            <button
              className="button warning"
              disabled={busy}
              onClick={() => act("/api/request-withdrawal", { participant: person.id, requested_by: requester }, "Withdrawal requested")}
            >
              <ExitIcon /> Withdraw
            </button>
          )}
        </Block>
      </DonationTabs>
    </>
  );
}

function Receipt({ state, person, act, busy }: { state: State; person: Person; act: Act; busy: boolean }) {
  const [code, setCode] = useState("");
  const [checks, setChecks] = useState<Check[] | null>(null);
  const { manifest } = person;
  const withdrawal = manifest.withdrawal!;
  const deleted = manifest.items.filter((item) => item.status === "deleted");
  const kept = manifest.items.filter((item) => item.status === "access-restricted");
  const genuine = checks?.every((check) => check.passed);

  async function check() {
    const result = await act("/api/check-receipt", { participant: person.id, code }, (done) =>
      done.genuine ? { kind: "ok", text: "Receipt genuine" } : { kind: "error", text: "Receipt not confirmed" },
    );
    setChecks(result?.receipt_checks ?? null);
  }

  return (
    <>
      <DetailHead role="family" id={person.id} stage="withdrawn" person={person} />

      <div className="receipt">
        <div>
          <div className="with-icon quiet">
            <KeyIcon size={16} /> Receipt {withdrawal.date}
          </div>
          <p className="code">{withdrawal.receipt_code}</p>
        </div>
        <div className="form-row">
          <input aria-label="Receipt code to check" type="text" value={code} onChange={(event) => setCode(event.target.value)} />
          <button className="icon-button" aria-label="Check receipt code" title="Check" disabled={busy || code.trim() === ""} onClick={check}>
            <CheckIcon />
          </button>
          {checks && <span className={`tag ${genuine ? "green" : "red"}`}>{genuine ? "Genuine" : "Not confirmed"}</span>}
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-number">{deleted.length}</div>
          <div className="stat-label">Deleted</div>
        </div>
        <div className="stat">
          <div className="stat-number">{kept.length}</div>
          <div className="stat-label">Kept by law, restricted</div>
        </div>
        <div className="stat">
          <div className="stat-number">{manifest.external_copies.length}</div>
          <div className="stat-label">Outside the hospital, not verifiable</div>
        </div>
      </div>

      {checks && (
        <Block title="Receipt check">
          <CheckList checks={checks} />
        </Block>
      )}

      <Block title="Outside the hospital" flush>
        <div className="table-wrap">
          <table>
            <tbody>
              {manifest.external_copies.map((copy) => (
                <tr key={copy.holder}>
                  <td>{copy.holder}</td>
                  <td>{copy.platform}</td>
                  <td className="wrap">{copy.what}</td>
                  <td>Deletion cannot be verified</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>

      <Block title="Data flow">
        <Lineage person={person} waiting={null} findings={state.findings} />
      </Block>

      <Block title="Deleted files" flush>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>SHA-256</th>
              </tr>
            </thead>
            <tbody>
              {deleted.map((item) => (
                <tr key={item.id}>
                  <td>{fileName(item.path)}</td>
                  <td className="mono">{item.sha256}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>
      <Timeline person={person} role="family" />
    </>
  );
}
