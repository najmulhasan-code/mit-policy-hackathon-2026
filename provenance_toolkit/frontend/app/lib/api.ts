import type { Result, Session, State } from "./types";

/** An error message returned by the server, shown to the user as it is. */
export class Refused extends Error {}

/** The server does not know which role this browser chose. */
export class NoRole extends Error {}

async function parse(response: Response) {
  const body = await response.json().catch(() => null);
  if (response.ok) return body;
  if (response.status === 401) throw new NoRole();
  const detail = body?.detail;
  if (typeof detail === "string") throw new Refused(detail);
  throw new Refused("The request was not accepted.");
}

export async function getState(): Promise<State> {
  return parse(await fetch("/api/state", { cache: "no-store" }));
}

export async function post(path: string, body: object): Promise<Result> {
  return parse(
    await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  );
}

/** The role this browser chose, or null. */
export async function getSession(): Promise<Session | null> {
  return (await parse(await fetch("/api/session", { cache: "no-store" }))).session;
}

/** Start acting in a role. Returns the state. */
export const chooseRole = (role: string): Promise<State> => post("/api/role", { role });

export async function leaveRole() {
  await fetch("/api/leave-role", { method: "POST" });
}

/** The file name at the end of a stored path. */
export function fileName(path: string) {
  return path.split("/").pop() ?? path;
}

/** The first characters of a hash, for display. The full value goes in the title attribute. */
export function shortHash(hash: string, length = 12) {
  return hash.slice(0, length);
}

export function fileSize(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
