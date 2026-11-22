import { useSyncExternalStore } from "react";
import { fileName } from "./api";
import type { Person, Waiting } from "./types";

/**
 * One donated file as the lists show it. `key` names the file in an address: the item id once the study has
 * received the donation, the file name before that. `mark` is the class of its state mark.
 */
export type FileEntry = { key: string; name: string; platform: string; sha256: string; mark: "" | "ok" | "no" | "off"; state: string };

/** The donated files of a donation, in the order recorded. */
export function filesOf(person: Person | null, waiting: Waiting | null): FileEntry[] {
  if (!person) {
    return (waiting?.files ?? []).map((file) => ({ key: file.file, name: file.file, platform: file.platform, sha256: file.sha256 ?? "", mark: "", state: "submitted" }));
  }
  return person.manifest.items
    .filter((item) => item.kind === "donated export")
    .map((item) => {
      const stored = person.storage.find((file) => file.path === item.path);
      const base = { key: item.id, name: fileName(item.path), platform: item.source.platform, sha256: item.sha256 };
      if (item.status === "deleted") return { ...base, mark: "off" as const, state: "deleted" };
      if (!stored) return { ...base, mark: "no" as const, state: "missing from storage" };
      if (!stored.matches) return { ...base, mark: "no" as const, state: "altered" };
      return { ...base, mark: "ok" as const, state: "stored" };
    });
}

/** The address of a donation page. The file is named in it when the donation has more than one. */
export function fileAddress(role: string, participant: string, files: FileEntry[], file: FileEntry | null) {
  return `${role}/${participant}${file && files.length > 1 ? `/${encodeURIComponent(file.key)}` : ""}`;
}

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function read() {
  const part = window.location.hash.slice(1).split("/")[2] ?? "";
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/** The third part of the address: on a donation page, the file or other item that is chosen. Empty when none is named. */
export function useSelection(): string {
  return useSyncExternalStore(subscribe, read, () => "");
}
