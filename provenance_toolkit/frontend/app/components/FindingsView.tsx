"use client";

import { fileName, shortHash } from "../lib/api";
import type { Act, Finding, Person, Role, State } from "../lib/types";
import { ChartIcon, DatasetIcon, DownloadIcon, PeopleIcon, PersonIcon, RecordIcon } from "./Icons";
import { Block, FindingTag } from "./Shared";

/** The purpose a participant must permit for the linked dataset to enter an analysis. */
const ANALYSIS = "analysis by named study staff";

/**
 * Study-wide findings. `canAct` is true for the research team, who can run and recompute analyses.
 * `role` is the signed-in role, used in the links to a participant's page.
 */
export function FindingsView({ state, act, busy, canAct, role }: { state: State; act: Act; busy: boolean; canAct: boolean; role: Role }) {
  const findings = [...state.findings].reverse();
  const linked = state.participants.filter(
    (person) =>
      !person.manifest.withdrawal &&
      person.manifest.consent.permitted_uses.includes(ANALYSIS) &&
      person.manifest.items.some((item) => item.kind === "derived dataset" && item.status === "active"),
  ).length;

  return (
    <>
      <div className="heading">
        <h1>Findings</h1>
        <span className="heading-actions">
          <a className="button secondary" href="/api/exclusions">
            <DownloadIcon /> Exclusion manifest
          </a>
          {canAct && (
            <button
              className="button"
              disabled={busy || linked === 0}
              onClick={() => act("/api/findings", {}, (result) => ({ kind: "ok", text: `${result.finding} computed` }))}
            >
              <ChartIcon /> Run analysis
            </button>
          )}
        </span>
      </div>
      {findings.length === 0 && (
        <div className="empty">
          <ChartIcon size={40} />
        </div>
      )}
      {findings.map((finding) => (
        <FindingBlock key={finding.id} finding={finding} people={state.participants} act={act} busy={busy} canAct={canAct} role={role} />
      ))}
    </>
  );
}

/** One finding. A retired finding has no result, so it shows its inputs without the chart and the counts. */
function FindingBlock({ finding, people, act, busy, canAct, role }: { finding: Finding; people: Person[]; act: Act; busy: boolean; canAct: boolean; role: Role }) {
  const itemOf = (participant: string, id: string) => people.find((person) => person.id === participant)?.manifest.items.find((one) => one.id === id);
  const { result } = finding;
  const counts = result?.conversations_in_30_days_before_a_visit ?? {};
  const platforms = Object.keys(counts);
  const largest = Math.max(1, ...platforms.map((platform) => counts[platform]));

  return (
    <Block
      title={finding.id}
      side={
        <span className="actions">
          {finding.status === "outdated" && canAct && (
            <button
              className="button warning"
              disabled={busy}
              onClick={() =>
                act("/api/findings/recompute", { finding: finding.id }, (done) => ({
                  kind: "ok",
                  text: done.finding ? `${finding.id} retired, ${done.finding} computed` : `${finding.id} retired`,
                }))
              }
            >
              <ChartIcon /> Recompute
            </button>
          )}
          <FindingTag status={finding.status} />
        </span>
      }
    >
      <div className={`split${finding.status === "retired" ? " retired" : ""}`}>
        {result && (
          <div>
            <p className="quiet">Conversations in the 30 days before a hospital visit</p>
            <div className="bars">
              {platforms.flatMap((platform) => [
                <span key={`${platform}-name`}>{platform}</span>,
                <span key={`${platform}-bar`} className="bar-track">
                  <span className="bar-fill" style={{ width: `${(counts[platform] / largest) * 100}%` }} />
                </span>,
                <span key={`${platform}-count`} className="bar-value">
                  {counts[platform]}
                </span>,
                <span key={`${platform}-mean`} className="quiet">
                  {result.mean_conversations_per_visit[platform].toFixed(2)} per visit
                </span>,
              ])}
            </div>
          </div>
        )}
        <ul className="inputs">
          {finding.inputs.map((input) => {
            const item = itemOf(input.participant, input.item);
            const gone = item?.status === "deleted";
            return (
            <li key={input.participant}>
              <DatasetIcon size={16} />
              <a className={`input-file${gone ? " gone" : ""}`} href={`#${role}/${input.participant}/${encodeURIComponent(input.item)}`}>
                {item ? fileName(item.path) : input.item}
              </a>
              {gone && <span className="quiet">deleted</span>}
              <span className="mono quiet">{input.participant}</span>
              <span className="mono quiet" title={input.sha256}>
                {shortHash(input.sha256, 20)}
              </span>
            </li>
            );
          })}
        </ul>
      </div>
      <div className="finding-meta">
        {result && (
          <>
            <span className="with-icon" title="Participants">
              <PeopleIcon size={15} /> {result.participants}
            </span>
            <span className="with-icon" title="Hospital visits">
              <RecordIcon size={15} /> {result.clinical_visits}
            </span>
          </>
        )}
        <span className="with-icon" title="Computed by">
          <PersonIcon size={15} /> {finding.created_by}
        </span>
        <span className="mono">{finding.created}</span>
        {finding.replaces && <span>replaces {finding.replaces}</span>}
        {finding.retired_on && <span>retired {finding.retired_on}</span>}
      </div>
    </Block>
  );
}
