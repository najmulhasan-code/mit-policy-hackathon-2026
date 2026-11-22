export type Consent = {
  participant: string;
  study_protocol: string;
  parental_permission: { given: boolean; date: string };
  child_assent: { given: boolean; date: string };
  participant_turns_18: string;
  permitted_uses: string[];
  prohibited_uses: string[];
  /** The purposes offered at donation. Set once the family has changed its permissions. */
  offered_uses?: string[];
  updates?: { date: string; by: string; permitted: string[]; log_index: number }[];
  renewed_at_18?: string;
};

export type Item = {
  id: string;
  path: string;
  sha256: string;
  bytes: number;
  kind: "donated export" | "redacted copy" | "derived dataset" | "clinical record";
  modality: string;
  source: { platform: string; holder: string; exported?: string; export_method?: string; account_holder?: string };
  derived_from: string[];
  activity: string;
  recorded: string;
  recorded_by: string;
  retention: string;
  status: "active" | "deleted" | "access-restricted";
  contains_phi?: boolean;
  /** For a redacted copy: the number of direct identifiers removed, by kind. */
  removed?: Record<string, number>;
};

/**
 * One entry of the activity log. `hash` covers the entry and `previous`, the hash of the entry before it.
 * `state` is the hash of the rest of the manifest, carried by the newest entry of each save.
 */
export type LogEntry = {
  index: number;
  date: string;
  actor: string;
  action: string;
  item: string;
  purpose: string;
  previous: string;
  hash: string;
  state?: string;
};

export type ExternalCopy = { holder: string; platform: string; what: string; status: string };

export type Withdrawal = {
  date: string;
  requested_by: string;
  staff: string;
  identity_confirmed: boolean;
  receipt: string;
  receipt_sha256: string;
  receipt_code: string;
  findings: { id: string; created: string }[];
};

export type Manifest = {
  manifest_version: string;
  participant: string;
  consent: Consent;
  completeness: string;
  items: Item[];
  events: LogEntry[];
  external_copies: ExternalCopy[];
  withdrawal: Withdrawal | null;
};

export type Check = { check: string; passed: boolean; detail: string };

export type Report = { participant: string; date: string; passed: boolean; results: Check[] };

/** A file as found in storage at the moment the state was read, with its fingerprint recomputed. */
export type StoredFile = {
  path: string;
  bytes: number;
  sha256: string;
  item: string | null;
  recorded_sha256: string | null;
  matches: boolean;
};

/** A copy of a log entry's hash, kept by the auditor. */
export type Seal = { date: string; index: number; hash: string };

export type Person = {
  id: string;
  manifest: Manifest;
  pending_request: null | { participant: string; requested_by: string; date: string };
  report: Report | null;
  storage: StoredFile[];
  broken_links: number[];
  seals: Seal[];
  seal_mismatches: number[];
};

export type DonatedFile = {
  file: string;
  platform: string;
  holder: string;
  modality: string;
  exported: string;
  export_method: string;
  account_holder: string;
  sha256?: string;
  bytes: number;
};

/** A donation a family has submitted and the study has not yet received. */
export type Waiting = { id: string; submitted: string; completeness: string; consent: Consent; files: DonatedFile[] };

/** The study's settings, read from study_protocol.json. */
export type Protocol = {
  study_protocol: string;
  study_name: string;
  permitted_uses: string[];
  prohibited_uses: string[];
  platforms: Record<string, string>;
};

/** The result of an analysis across participants, with the data that went into it. A retired finding has no result. */
export type Finding = {
  id: string;
  created: string;
  created_by: string;
  purpose: string;
  path: string;
  sha256: string;
  inputs: { participant: string; item: string; sha256: string }[];
  result: {
    participants: number;
    clinical_visits: number;
    conversations_in_30_days_before_a_visit: Record<string, number>;
    mean_conversations_per_visit: Record<string, number>;
  } | null;
  status: "current" | "outdated" | "retired";
  replaces: string | null;
  retired_on: string | null;
};

/** One log entry of the study, in the order written. */
export type Leaf = { participant: string; index: number; hash: string };

/** The size and root of the ledger at one moment, kept by the auditor. */
export type Checkpoint = { date: string; size: number; root: string };

/** The role this browser chose, and the name written to the log for it. */
export type Session = { role: Role; name: string };

export type State = {
  session: Session;
  today: string;
  scanned_at: string;
  protocol: Protocol;
  waiting: Waiting[];
  participants: Person[];
  findings: Finding[];
  ledger: { leaves: Leaf[]; root: string };
  checkpoints: Checkpoint[];
};

/** The state after a request, with the values that request returned. */
export type Result = State & {
  permitted?: boolean;
  receipt_checks?: Check[];
  genuine?: boolean;
  participant?: string;
  finding?: string | null;
};

export type Role = "family" | "study" | "auditor";

/** Where a donation stands, derived from the records. */
export type Stage = "submitted" | "active" | "requested" | "withdrawn";

export function stageOf(person: Person | null): Stage {
  if (!person) return "submitted";
  if (person.manifest.withdrawal) return "withdrawn";
  return person.pending_request ? "requested" : "active";
}

export const STAGE_LABEL: Record<Stage, string> = {
  submitted: "Submitted",
  active: "Active",
  requested: "Withdrawal requested",
  withdrawn: "Withdrawn",
};

export const ROLE_LABEL: Record<Role, string> = { family: "Family", study: "Research team", auditor: "Auditor" };

/** What a donation is waiting for, and whose turn it is. */
export function nextStep(person: Person | null): { text: string; role: Role } | null {
  if (!person) return { text: "Receive the donation", role: "study" };
  if (person.manifest.withdrawal) return person.report && person.report.date >= person.manifest.withdrawal.date ? null : { text: "Verify the withdrawal", role: "auditor" };
  if (person.pending_request) return { text: "Carry out the withdrawal", role: "study" };
  if (!person.manifest.items.some((item) => item.kind === "clinical record")) return { text: "Link the hospital record", role: "study" };
  if (!person.report) return { text: "Verify", role: "auditor" };
  return null;
}

export type Notice = { kind: "ok" | "error"; text: string };

/** Sends one request to the server. `done` is the notice to show, or a function that builds it from the result. */
export type Act = (path: string, body: object, done: string | ((result: Result) => Notice)) => Promise<Result | null>;

/** `person` is set once the study has received the donation; `waiting` before that. */
export type ViewProps = { state: State; person: Person | null; waiting: Waiting | null; act: Act; busy: boolean };
