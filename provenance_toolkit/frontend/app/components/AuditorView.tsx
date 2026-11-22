"use client";

import type { ViewProps } from "../lib/types";
import { stageOf } from "../lib/types";
import { DownloadIcon, SealIcon } from "./Icons";
import { DonationTabs } from "./DonationTabs";
import { Lineage } from "./Lineage";
import { Block, CheckList, ConsentBlock, DetailHead } from "./Shared";

export function AuditorView({ state, person, waiting, act, busy }: ViewProps) {
  if (!person) {
    if (!waiting) return null;
    return (
      <>
        <DetailHead role="auditor" id={waiting.id} stage="submitted" person={null} waiting={waiting} />
        <Lineage person={null} waiting={waiting} findings={state.findings} />
        <ConsentBlock consent={waiting.consent} completeness={waiting.completeness} />
      </>
    );
  }

  const { report } = person;
  const passed = report ? report.results.filter((result) => result.passed).length : 0;

  return (
    <>
      <DetailHead role="auditor" id={person.id} stage={stageOf(person)} person={person}>
        <a className="icon-button" href={`/api/fhir/${person.id}`} target="_blank" rel="noreferrer" aria-label="Lineage records in FHIR Provenance form" title="FHIR Provenance records">
          <DownloadIcon />
        </a>
        <button
          className="button"
          disabled={busy}
          onClick={() =>
            act("/api/verify", { participant: person.id }, (result) => {
              const latest = result.participants.find((entry) => entry.id === person.id)?.report;
              return latest?.passed ? { kind: "ok", text: "Verification passed, checkpoint recorded" } : { kind: "error", text: "Verification failed" };
            })
          }
        >
          <SealIcon /> Verify
        </button>
      </DetailHead>
      <DonationTabs person={person} findings={state.findings} role="auditor">

      <Lineage person={person} waiting={null} findings={state.findings} />

      {report && (
        <Block
          title="Verification"
          side={
            <span className="actions">
              <span className="quiet mono">{report.date}</span>
              <a className="icon-button" href={`/api/report/${person.id}`} aria-label="Download the verification report" title="Verification report">
                <DownloadIcon />
              </a>
            </span>
          }
        >
          <div className="score">
            <span className={`score-number ${report.passed ? "good" : "bad"}`}>
              {passed}/{report.results.length}
            </span>
            <span className="segments" aria-hidden="true">
              {report.results.map((result) => (
                <span key={result.check} className={result.passed ? "" : "no"} title={result.check} />
              ))}
            </span>
          </div>
          <CheckList checks={report.results} />
        </Block>
      )}
      </DonationTabs>
    </>
  );
}
