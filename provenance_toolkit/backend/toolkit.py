"""Provenance toolkit for donated chatbot data.

Usage:
    python backend/toolkit.py intake   --study STUDY --donation DIR --consent FILE --date YYYY-MM-DD --staff NAME
    python backend/toolkit.py link     --study STUDY --participant ID --clinical FILE --date YYYY-MM-DD --staff NAME
    python backend/toolkit.py use      --study STUDY --participant ID --item ITEM --purpose TEXT --date YYYY-MM-DD --staff NAME
    python backend/toolkit.py verify   --study STUDY --participant ID --date YYYY-MM-DD [--witness DIR]
    python backend/toolkit.py request  --study STUDY --participant ID --requested-by participant|parent --date YYYY-MM-DD
    python backend/toolkit.py withdraw --study STUDY --participant ID --requested-by participant|parent --date YYYY-MM-DD --staff NAME --identity-confirmed
    python backend/toolkit.py fhir     --study STUDY --participant ID

STUDY is the folder that stands in for the study's storage:
    research_store/    donated files and datasets derived from them
    clinical_record/   the health record, kept under record retention law
    manifests/         one lineage manifest per participant
    ledger.json        one leaf per log entry of the whole study, in the order written
    receipts/          one receipt per withdrawal
    requests/          withdrawal requests waiting to be processed
    reports/           results of verification runs
    findings/          results of analyses across participants, with the data each one used
    fhir/              the manifest items as FHIR R5 Provenance resources, one Bundle per participant

The activity log in each manifest is a hash chain: every entry stores the hash
of the entry before it, so a later edit, insertion or removal breaks the chain.
An auditor keeps seals, which are copies of the latest entry hash, in a folder
of its own (WITNESS). A log that was rewritten and re-chained no longer matches
the seals taken before the rewrite.

The ledger lists the hash of every log entry of the study in the order written.
Its Merkle tree root is one value that covers the whole study. A checkpoint is
the size and root of the ledger at one moment. Anyone who kept a checkpoint can
recompute the root over the first `size` leaves and see whether the earlier
records are still the same.
"""

import argparse
import hashlib
import json
import re
import shutil
import sys
from datetime import date, datetime, timezone
from pathlib import Path

MANIFEST_VERSION = "0.3"
RESEARCH_RETENTION = "research copy: delete on withdrawal"
CLINICAL_RETENTION = "clinical record: kept under record retention law, access restricted on withdrawal"
REQUESTERS = ("participant", "parent")
FIRST_LINK = "0" * 64
LOGGED_FIELDS = ("index", "date", "actor", "action", "item", "purpose", "previous")


class ToolkitError(Exception):
    """A request that the toolkit refuses, with the reason as its message."""


def sha256_of(path):
    """Return the SHA-256 fingerprint of a file as hexadecimal text."""
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(65536), b""):
            digest.update(block)
    return digest.hexdigest()


def read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise ToolkitError(f"File not found: {path}") from None
    except json.JSONDecodeError as error:
        raise ToolkitError(f"{path} is not valid JSON: {error}") from None


def write_json(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(content, f, indent=2)
        f.write("\n")


def manifest_path(study, participant):
    return study / "manifests" / f"{participant}.json"


def load_manifest(study, participant):
    if not manifest_path(study, participant).exists():
        raise ToolkitError(f"There is no manifest for {participant}.")
    return read_json(manifest_path(study, participant))


def participants(study):
    """Return the ids of all participants with a manifest."""
    return sorted(path.stem for path in (study / "manifests").glob("*.json"))


def state_hash(manifest):
    """Return the hash of everything in the manifest except the activity log: consent, items and withdrawal."""
    content = {key: value for key, value in manifest.items() if key != "events"}
    return hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def save_manifest(study, manifest):
    """Write the manifest to the study's storage.

    The newest log entry is given the hash of the rest of the manifest as it is saved, so the consent
    and the item records are tied to the log and a later change to them shows.
    """
    events = manifest["events"]
    if events and "state" not in events[-1]:
        events[-1]["state"] = state_hash(manifest)
        events[-1]["hash"] = entry_hash(events[-1])
    path = manifest_path(study, manifest["participant"])
    write_json(path, manifest)
    extend_ledger(study, manifest)


# Activity log


def entry_hash(entry):
    """Return the hash of a log entry.

    It covers the entry's content, the hash of the entry before it and, where the entry has one, the
    hash of the rest of the manifest.
    """
    content = {field: entry[field] for field in LOGGED_FIELDS}
    if "state" in entry:
        content["state"] = entry["state"]
    return hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def log(manifest, day, actor, action, item, purpose):
    """Append an entry to the activity log, chained to the entry before it."""
    events = manifest["events"]
    entry = {"index": len(events), "date": day, "actor": actor, "action": action, "item": item, "purpose": purpose,
             "previous": events[-1]["hash"] if events else FIRST_LINK}
    entry["hash"] = entry_hash(entry)
    events.append(entry)


def broken_links(events):
    """Return the positions of log entries whose own hash or link to the previous entry is wrong."""
    broken = []
    for position, entry in enumerate(events):
        expected_previous = events[position - 1].get("hash") if position else FIRST_LINK
        intact = (all(field in entry for field in LOGGED_FIELDS) and entry["index"] == position
                  and entry["previous"] == expected_previous and entry.get("hash") == entry_hash(entry))
        if not intact:
            broken.append(position)
    return broken


def seals(witness, participant):
    """Return the seals the auditor holds for a participant, oldest first."""
    path = witness / f"{participant}.json"
    return read_json(path) if path.exists() else []


def seal(witness, manifest, day):
    """Record the hash of the latest log entry in the auditor's own folder. Return the seal."""
    events = manifest["events"]
    held = seals(witness, manifest["participant"])
    latest = {"date": day, "index": events[-1]["index"], "hash": events[-1]["hash"]}
    if not held or (held[-1]["index"], held[-1]["hash"]) != (latest["index"], latest["hash"]):
        held.append(latest)
        write_json(witness / f"{manifest['participant']}.json", held)
    return held[-1]


def seal_mismatches(events, held):
    """Return the seals that the log no longer matches."""
    return [mark for mark in held
            if mark["index"] >= len(events) or events[mark["index"]].get("hash") != mark["hash"]]


# Study ledger


def ledger(study):
    """Return the study ledger: one leaf per log entry of any participant, in the order the entries were written."""
    path = study / "ledger.json"
    return read_json(path) if path.exists() else []


def leaf_hash(entry_hash_text):
    return hashlib.sha256(b"\x00" + entry_hash_text.encode("utf-8")).digest()


def merkle_root(hashes):
    """Return the root of the Merkle tree over a list of leaf hashes. The tree is shaped as in RFC 6962."""
    if not hashes:
        return hashlib.sha256(b"").digest()
    if len(hashes) == 1:
        return hashes[0]
    split = 1
    while split * 2 < len(hashes):
        split *= 2
    return hashlib.sha256(b"\x01" + merkle_root(hashes[:split]) + merkle_root(hashes[split:])).digest()


def ledger_root(leaves, size=None):
    """Return the root over the first `size` leaves of the ledger, or over all of them."""
    chosen = leaves if size is None else leaves[:size]
    return merkle_root([leaf_hash(str(leaf["hash"])) for leaf in chosen]).hex()


def extend_ledger(study, manifest):
    """Append to the ledger the log entries of this manifest that it does not hold yet."""
    leaves = ledger(study)
    known = sum(1 for leaf in leaves if leaf["participant"] == manifest["participant"])
    added = manifest["events"][known:]
    if added:
        leaves += [{"participant": manifest["participant"], "index": entry["index"], "hash": entry["hash"]}
                   for entry in added]
        write_json(study / "ledger.json", leaves)


def ledger_problems(study):
    """Return the ways in which the ledger and the activity logs disagree."""
    logs = {participant: load_manifest(study, participant)["events"] for participant in participants(study)}
    counted, problems = {}, []
    for position, leaf in enumerate(ledger(study)):
        events = logs.get(leaf["participant"], [])
        expected = counted.get(leaf["participant"], 0)
        if leaf["index"] != expected or expected >= len(events) or events[expected].get("hash") != leaf["hash"]:
            problems.append(f"leaf {position} ({leaf['participant']} entry {leaf['index']}) does not match the log")
        counted[leaf["participant"]] = expected + 1
    problems += [f"{participant} has log entries that are not in the ledger"
                 for participant, events in logs.items() if len(events) != counted.get(participant, 0)]
    return problems


def checkpoints(witness):
    """Return the ledger checkpoints the auditor holds, oldest first."""
    path = witness / "checkpoints.json"
    return read_json(path) if path.exists() else []


def checkpoint(witness, study, day):
    """Record the size and root of the ledger in the auditor's own folder."""
    leaves = ledger(study)
    held = checkpoints(witness)
    latest = {"date": day, "size": len(leaves), "root": ledger_root(leaves)}
    if not held or (held[-1]["size"], held[-1]["root"]) != (latest["size"], latest["root"]):
        held.append(latest)
        write_json(witness / "checkpoints.json", held)
    return held[-1]


def checkpoint_mismatches(leaves, held):
    """Return the checkpoints that the ledger no longer extends."""
    return [mark for mark in held
            if mark["size"] > len(leaves) or ledger_root(leaves, mark["size"]) != mark["root"]]


# Intake, linking and use


def new_item(study, item_id, stored, kind, modality, source, derived_from, activity, day, staff, retention):
    fingerprint = sha256_of(stored)
    return {
        "id": item_id,
        "path": stored.relative_to(study).as_posix(),
        "sha256": fingerprint,
        "bytes": stored.stat().st_size,
        "kind": kind,
        "modality": modality,
        "source": source,
        "derived_from": derived_from,
        "activity": activity,
        "recorded": day,
        "recorded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "recorded_by": staff,
        "retention": retention,
        "status": "active",
    }


def intake(study, donation, consent_file, day, staff):
    """Copy a donation into the research store and write the participant's lineage manifest."""
    form = read_json(donation / "donation_form.json")
    consent = read_json(consent_file)
    participant = form["participant"]
    if consent["participant"] != participant:
        raise ToolkitError("The consent and the donation form name different participants.")
    if not (consent["parental_permission"]["given"] and consent["child_assent"]["given"]):
        raise ToolkitError("Intake needs both parental permission and the participant's assent.")
    if manifest_path(study, participant).exists():
        raise ToolkitError(f"A manifest for {participant} already exists.")
    missing = [entry["file"] for entry in form["files"] if not (donation / entry["file"]).is_file()]
    if missing:
        raise ToolkitError("The donation form lists files that are not in the donation folder: " + ", ".join(missing))
    changed = [entry["file"] for entry in form["files"]
               if entry.get("sha256") and sha256_of(donation / entry["file"]) != entry["sha256"]]
    if changed:
        raise ToolkitError("Files that no longer match the fingerprint taken at submission: " + ", ".join(changed))

    holders = sorted({(entry["holder"], entry["platform"]) for entry in form["files"]})
    manifest = {
        "manifest_version": MANIFEST_VERSION,
        "participant": participant,
        "consent": {**consent, "consent_file_sha256": sha256_of(consent_file)},
        "completeness": form["completeness"],
        "items": [],
        "events": [],
        "external_copies": [
            {"holder": holder, "platform": platform,
             "what": "the original conversations and any copy or model derived from them",
             "status": "outside the study's control; deletion cannot be verified by the study"}
            for holder, platform in holders
        ],
        "withdrawal": None,
    }
    for number, entry in enumerate(form["files"], start=1):
        stored = study / "research_store" / participant / "donated" / entry["file"]
        stored.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(donation / entry["file"], stored)
        source = {key: entry[key] for key in ("platform", "holder", "exported", "export_method", "account_holder")}
        item = new_item(study, f"{participant}-item-{number:03d}", stored, "donated export", entry["modality"],
                        source, [], "intake", day, staff, RESEARCH_RETENTION)
        manifest["items"].append(item)
        log(manifest, day, staff, "intake", item["id"], f"receive donation, fingerprint {item['sha256']}")
    save_manifest(study, manifest)
    return manifest


def require_active(manifest):
    if manifest["withdrawal"]:
        raise ToolkitError(f"{manifest['participant']} withdrew on {manifest['withdrawal']['date']}.")


def conversation_dates(path):
    """Return the start date of each conversation in an export file, as YYYY-MM-DD.

    Two layouts are read: an object with a "conversations" list whose entries have a
    "started" date, and a list of conversations whose entries have a "create_time" in
    seconds since 1970. A file in any other layout gives an empty list.
    """
    try:
        with open(path, encoding="utf-8-sig") as f:
            content = json.load(f)
    except (OSError, ValueError, RecursionError):
        return []
    conversations = content.get("conversations", []) if isinstance(content, dict) else content
    dates = []
    for conversation in conversations if isinstance(conversations, list) else []:
        if not isinstance(conversation, dict):
            continue
        try:
            if isinstance(conversation.get("started"), str):
                dates.append(date.fromisoformat(conversation["started"][:10]).isoformat())
            elif isinstance(conversation.get("create_time"), (int, float)):
                dates.append(datetime.fromtimestamp(conversation["create_time"], timezone.utc).date().isoformat())
        except (ValueError, OverflowError, OSError):
            continue
    return dates


# Identifiers removed from text before linkage: web addresses that start with http, https or www, email
# addresses, and phone numbers written as three, three and four digits with separators. Web addresses come
# first, because they can contain an address that looks like an email. A phone number needs separators,
# so that a plain run of digits such as a timestamp is left alone. Names, postal addresses and numbers in
# other formats are not removed.
IDENTIFIERS = (
    ("web address", re.compile(r"(?:https?://|www\.)[^\s\"<>]*[^\s\"<>.,;:!?)]", re.IGNORECASE)),
    ("email address", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")),
    ("phone number", re.compile(r"(?<![\w+])(?:\+?\d{1,3}[ .-])?(?:\(\d{3}\)[ .-]?|\d{3}[ .-])\d{3}[ .-]\d{4}(?!\w)")),
)


def redact(text, removed):
    """Return `text` with each identifier replaced by a note of its kind. Count the replacements in `removed`."""
    for kind, pattern in IDENTIFIERS:
        text, count = pattern.subn(f"[{kind} removed]", text)
        removed[kind] = removed.get(kind, 0) + count
    return text


def write_redacted(source, target):
    """Write a copy of a text file with identifiers removed. Return the number removed, by kind.

    In a JSON file only the text values are changed, so the structure, the keys and the numbers stay as
    they were. Any other text file is treated as one piece of text, with its line endings kept. The file
    has to be UTF-8.
    """
    removed = {kind: 0 for kind, _ in IDENTIFIERS}
    try:
        with open(source, encoding="utf-8-sig", newline="") as f:
            text = f.read()
    except UnicodeDecodeError:
        raise ToolkitError(f"{source.name} is not UTF-8 text, so identifiers cannot be removed from it.") from None

    def walk(value):
        if isinstance(value, str):
            return redact(value, removed)
        if isinstance(value, list):
            return [walk(entry) for entry in value]
        if isinstance(value, dict):
            return {key: walk(entry) for key, entry in value.items()}
        return value

    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        content = walk(json.loads(text))
    except (ValueError, RecursionError):
        removed = {kind: 0 for kind, _ in IDENTIFIERS}
        with open(target, "w", encoding="utf-8", newline="") as f:
            f.write(redact(text, removed))
    else:
        write_json(target, content)
    return removed


def link(study, participant, clinical_file, day, staff):
    """Redact the chats, register the clinical record and build the dataset that links them.

    If a step fails, the files written so far are removed and the manifest is left as it was.
    """
    manifest = load_manifest(study, participant)
    require_active(manifest)
    consent = manifest["consent"]
    if LINKAGE_PURPOSE not in consent["permitted_uses"]:
        raise ToolkitError("The consent does not permit linking the chats to the hospital record.")
    blocked = use_blocked(study, manifest, day)
    if blocked:
        raise ToolkitError(f"The record cannot be linked: {blocked}.")
    if any(item["kind"] == "clinical record" for item in manifest["items"]):
        raise ToolkitError(f"The clinical record of {participant} is already linked.")
    record = read_json(clinical_file)
    if record["participant"] != participant:
        raise ToolkitError("The clinical record belongs to a different participant.")

    written = []
    try:
        return write_linkage(study, manifest, record, clinical_file, day, staff, written)
    except Exception:
        for path in written:
            path.unlink(missing_ok=True)
        raise


def write_linkage(study, manifest, record, clinical_file, day, staff, written):
    """Carry out a linkage. Every file created is added to `written`."""
    participant = manifest["participant"]
    clinical = study / "clinical_record" / f"{participant}.json"
    clinical.parent.mkdir(parents=True, exist_ok=True)
    written.append(clinical)
    shutil.copyfile(clinical_file, clinical)
    number = len(manifest["items"])

    def next_id():
        nonlocal number
        number += 1
        return f"{participant}-item-{number:03d}"

    # Identifiers are removed from each text export before linkage. Linkage reads the redacted copies.
    chats = [item for item in manifest["items"] if item["kind"] == "donated export" and item["modality"] == "text"]
    redacted = {}
    for item in chats:
        original = study / item["path"]
        copy = study / "research_store" / participant / "redacted" / f"{original.stem}.redacted{original.suffix}"
        written.append(copy)
        removed = write_redacted(original, copy)
        redacted[item["id"]] = new_item(study, next_id(), copy, "redacted copy", "text",
                                        {"platform": "study", "holder": "study team"}, [item["id"]],
                                        "redaction", day, staff, RESEARCH_RETENTION)
        redacted[item["id"]]["removed"] = removed

    clinical_item = new_item(study, next_id(), clinical, "clinical record", "structured",
                             {"platform": "hospital health record", "holder": "hospital"}, [], "registration",
                             day, staff, CLINICAL_RETENTION)
    clinical_item["contains_phi"] = True

    # The linked dataset counts, for each clinical encounter and platform, the conversations started on the
    # day of the encounter or in the 30 days before it. Several files of one platform are added together.
    started = {item["id"]: conversation_dates(study / redacted[item["id"]]["path"]) for item in chats}
    rows = []
    for encounter in record["encounters"]:
        visit = date.fromisoformat(encounter["date"])
        counts = {}
        for item in chats:
            gaps = [(visit - date.fromisoformat(day_started)).days for day_started in started[item["id"]]]
            platform = item["source"]["platform"]
            counts[platform] = counts.get(platform, 0) + sum(1 for gap in gaps if 0 <= gap <= 30)
        rows.append({"encounter_date": encounter["date"], "encounter_type": encounter["type"],
                     "conversations_in_prior_30_days": counts})
    linked = study / "research_store" / participant / "linked_dataset.json"
    written.append(linked)
    write_json(linked, {"participant": participant, "rows": rows})
    linked_item = new_item(study, next_id(), linked, "derived dataset", "structured",
                           {"platform": "study", "holder": "study team"},
                           [redacted[item["id"]]["id"] for item in chats] + [clinical_item["id"]], "linkage", day, staff,
                           RESEARCH_RETENTION)
    linked_item["contains_phi"] = True

    manifest["items"] += [*redacted.values(), clinical_item, linked_item]
    for item in redacted.values():
        log(manifest, day, staff, "redaction", item["id"],
            f"remove identifiers, {sum(item['removed'].values())} removed, fingerprint {item['sha256']}")
    log(manifest, day, staff, "registration", clinical_item["id"],
        f"register clinical record, fingerprint {clinical_item['sha256']}")
    log(manifest, day, staff, "linkage", linked_item["id"],
        f"build linked dataset, fingerprint {linked_item['sha256']}")
    save_manifest(study, manifest)
    return manifest


def record_use(study, participant, item_id, purpose, day, staff):
    """Log one use of an item. Return True if the consent permits the purpose, False if it was refused."""
    manifest = load_manifest(study, participant)
    require_active(manifest)
    if not any(entry["id"] == item_id for entry in manifest["items"]):
        raise ToolkitError(f"{participant} has no item {item_id}.")
    blocked = use_blocked(study, manifest, day)
    permitted = purpose in manifest["consent"]["permitted_uses"] and blocked is None
    log(manifest, day, staff, "use" if permitted else "refused", item_id, f"{purpose} ({blocked})" if blocked else purpose)
    save_manifest(study, manifest)
    return permitted


# Permissions


LINKAGE_PURPOSE = "linkage to the health record for this study"
ANALYSIS_PURPOSE = "analysis by named study staff"


def use_blocked(study, manifest, day):
    """Return the reason no use of a donation may start on `day`, or None if uses may go ahead.

    Uses stop while a withdrawal request is waiting, and from the day the participant turns 18 until
    the participant has given their own consent.
    """
    consent = manifest["consent"]
    if pending_request(study, manifest["participant"]):
        return "a withdrawal request is waiting"
    if day >= consent["participant_turns_18"] and not consent.get("renewed_at_18"):
        return "the participant has turned 18 and has not yet given their own consent"
    return None


def offered_uses(consent):
    """Return the purposes offered to the family at donation. It may permit any of these and no others."""
    return consent.get("offered_uses", consent["permitted_uses"])


def permitted_at(consent, index):
    """Return the purposes the consent permitted when log entry `index` was written."""
    permitted = offered_uses(consent)
    for update in consent.get("updates", []):
        if update["log_index"] < index:
            permitted = update["permitted"]
    return permitted


def update_permissions(study, participant, permitted, requested_by, day):
    """Change which of the offered purposes the family permits. The change applies to every later use."""
    if requested_by not in REQUESTERS:
        raise ToolkitError("A change of permissions has to come from the participant or a parent.")
    manifest = load_manifest(study, participant)
    require_active(manifest)
    consent = manifest["consent"]
    offered = offered_uses(consent)
    unknown = [use for use in permitted if use not in offered]
    if unknown:
        raise ToolkitError("A family can permit only the purposes offered at donation, not: " + "; ".join(unknown))
    chosen = [use for use in offered if use in permitted]
    if chosen == consent["permitted_uses"]:
        raise ToolkitError("The permissions are already as requested.")
    linked = any(item["kind"] == "derived dataset" and item["status"] == "active" for item in manifest["items"])
    if LINKAGE_PURPOSE in offered and LINKAGE_PURPOSE not in chosen and linked:
        raise ToolkitError("The chats are already linked to the hospital record. Undoing the linkage needs a withdrawal.")
    stops_analysis = ANALYSIS_PURPOSE in consent["permitted_uses"] and ANALYSIS_PURPOSE not in chosen
    restores_analysis = ANALYSIS_PURPOSE not in consent["permitted_uses"] and ANALYSIS_PURPOSE in chosen
    affected = findings_using(study, participant, ("current",)) if stops_analysis else []

    consent["offered_uses"] = offered
    consent["permitted_uses"] = chosen
    consent.setdefault("updates", []).append({"date": day, "by": requested_by, "permitted": chosen,
                                              "log_index": len(manifest["events"])})
    log(manifest, day, requested_by, "permissions updated", "all", "permitted: " + ("; ".join(chosen) or "none"))
    for finding in affected:
        log(manifest, day, requested_by, "finding marked outdated", finding["id"], "consent for analysis was withdrawn")
    save_manifest(study, manifest)
    if restores_analysis:
        marked = {event["item"] for event in manifest["events"] if event["action"] == "finding marked outdated"}
        again = [finding for finding in findings_using(study, participant, ("current",)) if finding["id"] in marked]
        for finding in again:
            log(manifest, day, requested_by, "finding current again", finding["id"], "consent for analysis was given again")
        if again:
            save_manifest(study, manifest)
    return manifest


def renew_consent(study, participant, day):
    """Record the participant's own consent, on or after the day they turn 18."""
    manifest = load_manifest(study, participant)
    require_active(manifest)
    consent = manifest["consent"]
    if day < consent["participant_turns_18"]:
        raise ToolkitError(f"Consent can be renewed from {consent['participant_turns_18']}, "
                           "the day the participant turns 18.")
    if consent.get("renewed_at_18"):
        raise ToolkitError("Consent has already been renewed.")
    consent["renewed_at_18"] = day
    log(manifest, day, "participant", "consent renewed", "all", "the participant, now an adult, consents in their own name")
    save_manifest(study, manifest)
    return manifest


# Findings


def findings(study):
    """Return the record of every finding, oldest first."""
    path = study / "findings" / "index.json"
    return read_json(path) if path.exists() else []


def finding_status(study, finding):
    """Return "retired", "outdated" if a contributor has since withdrawn or stopped permitting analysis, or "current"."""
    if finding["status"] == "retired":
        return "retired"

    def excluded(participant):
        manifest = load_manifest(study, participant)
        return manifest["withdrawal"] or ANALYSIS_PURPOSE not in manifest["consent"]["permitted_uses"]

    return "outdated" if any(excluded(entry["participant"]) for entry in finding["inputs"]) else "current"


def findings_using(study, participant, statuses=("current", "outdated")):
    """Return the findings that used a participant's data and have one of the given statuses."""
    return [finding for finding in findings(study)
            if any(entry["participant"] == participant for entry in finding["inputs"])
            and finding_status(study, finding) in statuses]


class NoContributors(ToolkitError):
    """No participant has a linked dataset that may be analysed."""


def build_finding(study, day, staff, replaces=None):
    """Analyse the linked datasets of all participants whose consent permits it, and record the finding."""
    contributors = []
    for participant in participants(study):
        manifest = load_manifest(study, participant)
        linked = next((item for item in manifest["items"]
                       if item["kind"] == "derived dataset" and item["status"] == "active"), None)
        if manifest["withdrawal"] or linked is None:
            continue
        permitted = (ANALYSIS_PURPOSE in manifest["consent"]["permitted_uses"]
                     and use_blocked(study, manifest, day) is None)
        if not permitted:
            continue
        fingerprint = sha256_of(study / linked["path"])
        if fingerprint != linked["sha256"]:
            raise ToolkitError(f"The linked dataset of {participant} differs from its record. "
                               "Run the verification before analysing.")
        contributors.append((manifest, linked))
    if not contributors:
        raise NoContributors("No participant has a linked dataset that may be analysed.")

    visits, totals = 0, {}
    for manifest, linked in contributors:
        for row in read_json(study / linked["path"])["rows"]:
            visits += 1
            for platform, count in row["conversations_in_prior_30_days"].items():
                totals[platform] = totals.get(platform, 0) + count
    result = {
        "participants": len(contributors),
        "clinical_visits": visits,
        "conversations_in_30_days_before_a_visit": dict(sorted(totals.items())),
        "mean_conversations_per_visit": {platform: round(count / visits, 2) if visits else 0
                                         for platform, count in sorted(totals.items())},
    }

    index = findings(study)
    finding_id = f"F-{len(index) + 1:04d}"
    inputs = [{"participant": manifest["participant"], "item": linked["id"], "sha256": linked["sha256"]}
              for manifest, linked in contributors]
    path = study / "findings" / f"{finding_id}.json"
    write_json(path, {"id": finding_id, "created": day, "created_by": staff, "purpose": ANALYSIS_PURPOSE,
                      "inputs": inputs, "result": result})
    fingerprint = sha256_of(path)
    for manifest, linked in contributors:
        log(manifest, day, staff, "use", linked["id"], ANALYSIS_PURPOSE)
        log(manifest, day, staff, "included in finding", finding_id, f"finding fingerprint {fingerprint}")
        save_manifest(study, manifest)
    index.append({"id": finding_id, "created": day, "created_by": staff, "purpose": ANALYSIS_PURPOSE,
                  "path": path.relative_to(study).as_posix(), "sha256": fingerprint, "inputs": inputs,
                  "result": result, "status": "current", "replaces": replaces, "retired_on": None})
    write_json(study / "findings" / "index.json", index)
    return index[-1]


def recompute_finding(study, finding_id, day, staff):
    """Compute a finding again from the participants whose data may be analysed, then retire the old one.

    Return the new finding, or None if no participant remains. The new finding is computed first, so a
    failure leaves the old one in place. The retired finding keeps its inputs and loses its result.
    """
    old = next((finding for finding in findings(study) if finding["id"] == finding_id), None)
    if old is None:
        raise ToolkitError(f"There is no finding {finding_id}.")
    if old["status"] == "retired":
        raise ToolkitError(f"{finding_id} is already retired.")
    try:
        new = build_finding(study, day, staff, replaces=finding_id)
    except NoContributors:
        new = None

    index = findings(study)
    old = next(finding for finding in index if finding["id"] == finding_id)
    path = study / old["path"]
    path.unlink(missing_ok=True)
    old["status"], old["retired_on"], old["result"] = "retired", day, None
    write_json(study / "findings" / "index.json", index)
    for entry in old["inputs"]:
        manifest = load_manifest(study, entry["participant"])
        log(manifest, day, staff, "finding retired", finding_id, "recomputed from the data that may still be analysed")
        save_manifest(study, manifest)
    return new


# Verification


def scan_storage(study, manifest):
    """Read the participant's files from storage and compare each with its manifest entry."""
    participant = manifest["participant"]
    recorded = {item["path"]: item for item in manifest["items"]}
    folders = [study / "research_store" / participant, study / "clinical_record"]
    paths = [path for path in folders[0].rglob("*") if path.is_file()] if folders[0].exists() else []
    clinical = folders[1] / f"{participant}.json"
    if clinical.is_file():
        paths.append(clinical)
    files = []
    for path in sorted(paths):
        relative = path.relative_to(study).as_posix()
        item = recorded.get(relative)
        fingerprint = sha256_of(path)
        files.append({
            "path": relative,
            "bytes": path.stat().st_size,
            "sha256": fingerprint,
            "item": item["id"] if item else None,
            "recorded_sha256": item["sha256"] if item else None,
            "matches": bool(item) and item["sha256"] == fingerprint,
        })
    return files


def verify(study, participant, day, witness=None):
    """Run the verification checklist. Return a list of {check, passed, detail}."""
    manifest = load_manifest(study, participant)
    consent, items, events = manifest["consent"], manifest["items"], manifest["events"]
    by_id = {item["id"]: item for item in items}
    results = []

    def check(name, passed, detail):
        results.append({"check": name, "passed": bool(passed), "detail": detail})

    both = consent["parental_permission"]["given"] and consent["child_assent"]["given"]
    dated = consent["parental_permission"].get("date") and consent["child_assent"].get("date")
    check("Consent is complete", both and dated,
          "Parental permission and assent are recorded with dates." if both and dated
          else "Parental permission or assent is missing or undated.")

    store = study / "research_store" / participant
    on_disk = {path.relative_to(study).as_posix() for path in store.rglob("*") if path.is_file()} if store.exists() else set()
    recorded = {item["path"] for item in items if item["status"] == "active"}
    unrecorded = sorted(on_disk - recorded)
    check("Every file is recorded", not unrecorded,
          f"{len(on_disk)} files in the research store, all in the manifest." if not unrecorded
          else "Files with no manifest entry: " + ", ".join(unrecorded))

    altered = []
    for item in items:
        if item["status"] == "deleted":
            continue
        path = study / item["path"]
        if not path.is_file():
            altered.append(f"{item['id']} is missing")
        elif sha256_of(path) != item["sha256"]:
            altered.append(f"{item['id']} has a different fingerprint")
    check("No file was altered", not altered,
          "Every stored file matches its recorded fingerprint." if not altered else "; ".join(altered))

    def traces_back(item_id, seen=()):
        item = by_id.get(item_id)
        if item is None or item_id in seen:
            return False
        if not item["derived_from"]:
            return item["kind"] in ("donated export", "clinical record")
        return all(traces_back(parent, seen + (item_id,)) for parent in item["derived_from"])

    untraced = [item["id"] for item in items if not traces_back(item["id"])]
    check("Every dataset can be traced", not untraced,
          "Every item leads back to a donated file or the clinical record." if not untraced
          else "Items with a broken lineage: " + ", ".join(untraced))

    uses = [event for event in events if event["action"] == "use"]
    not_permitted = [event for event in uses if event["purpose"] not in permitted_at(consent, event["index"])]
    refused = sum(1 for event in events if event["action"] == "refused")
    check("Every use was allowed", not not_permitted,
          f"Uses logged: {len(uses)}, all permitted by the consent. Requests refused: {refused}."
          if not not_permitted else "Uses outside the consent: " + "; ".join(event["purpose"] for event in not_permitted))

    adult = day >= consent["participant_turns_18"]
    renewed = bool(consent.get("renewed_at_18"))
    check("Consent is still valid", not adult or renewed or bool(manifest["withdrawal"]),
          f"The participant turns 18 on {consent['participant_turns_18']}." if not adult
          else ("Consent was renewed at 18." if renewed else
                "The participant has turned 18 and no renewed consent is recorded."))

    broken = broken_links(events)
    check("The activity log is intact", not broken,
          f"All {len(events)} entries are chained correctly." if not broken
          else "The chain breaks at entry " + ", ".join(str(position) for position in broken[:5]) + ".")

    held = seals(witness, participant) if witness is not None else []
    if held:
        mismatched = seal_mismatches(events, held)
        check("The log matches the auditor's seals", not mismatched,
              f"The log agrees with all {len(held)} seals held by the auditor." if not mismatched
              else f"The log was changed after it was sealed on {mismatched[0]['date']} at entry {mismatched[0]['index']}.")

    unlogged = []
    for item in items:
        first = next((event for event in events if event["item"] == item["id"]), None)
        if first is None or item["sha256"] not in first["purpose"]:
            unlogged.append(item["id"])
    check("Fingerprints match the log", not unlogged,
          f"The fingerprint of each of the {len(items)} items is the one written to the log when it was recorded."
          if not unlogged else "Items whose fingerprint differs from the log: " + ", ".join(unlogged))

    if events and "state" in events[-1]:
        unchanged = state_hash(manifest) == events[-1]["state"]
        check("The record matches the log", unchanged,
              "The consent, the item records and the withdrawal record are as they were when the last log entry was written."
              if unchanged else "The consent, an item record or the withdrawal record was changed without a log entry.")

    leaves = ledger(study)
    problems = ledger_problems(study)
    if witness is not None:
        problems += [f"the ledger no longer extends the auditor's checkpoint of size {mark['size']} taken on {mark['date']}"
                     for mark in checkpoint_mismatches(leaves, checkpoints(witness))]
    check("The study ledger is intact", not problems,
          f"All {len(leaves)} log entries of the study are in the ledger. Root {ledger_root(leaves)}."
          if not problems else "; ".join(problems[:5]))

    if manifest["withdrawal"]:
        research = [item for item in items if item["kind"] != "clinical record"]
        clinical = [item for item in items if item["kind"] == "clinical record"]
        problems = []
        if on_disk:
            problems.append(f"{len(on_disk)} research files remain")
        if any(item["status"] != "deleted" for item in research):
            problems.append("a research item is not marked deleted")
        for item in clinical:
            if not (study / item["path"]).is_file():
                problems.append("the clinical record is missing")
            if item["status"] != "access-restricted":
                problems.append("the clinical record is not access-restricted")
        receipt = study / manifest["withdrawal"]["receipt"]
        if not receipt.is_file():
            problems.append("the receipt is missing")
        elif sha256_of(receipt) != manifest["withdrawal"]["receipt_sha256"]:
            problems.append("the receipt was changed after it was issued")
        if not any(event["action"] == "receipt issued" and manifest["withdrawal"]["receipt_sha256"] in event["purpose"]
                   for event in events):
            problems.append("the receipt fingerprint is not the one in the log")
        check("Withdrawal was carried out", not problems,
              "No research file remains, the clinical record is kept and restricted, and the receipt is unchanged."
              if not problems else "; ".join(problems))
        used = findings_using(study, participant, ("current", "outdated", "retired"))
        if used:
            pending = [finding["id"] for finding in used if finding["status"] != "retired"]
            check("Findings were recomputed", not pending,
                  f"All {len(used)} findings that used this data were retired and recomputed without it."
                  if not pending else "Findings that still include this data: " + ", ".join(pending))
    return results


def save_report(study, participant, day, results):
    """Save the results of a verification run."""
    write_json(study / "reports" / f"{participant}_verification.json",
               {"participant": participant, "date": day, "passed": all(result["passed"] for result in results),
                "results": results})


# Withdrawal


def request_path(study, participant):
    return study / "requests" / f"{participant}.json"


def pending_request(study, participant):
    """Return the waiting withdrawal request of a participant, or None."""
    path = request_path(study, participant)
    return read_json(path) if path.exists() else None


def request_withdrawal(study, participant, requested_by, day):
    """Record a withdrawal request made by the participant or a parent."""
    if requested_by not in REQUESTERS:
        raise ToolkitError("A withdrawal has to be requested by the participant or a parent.")
    manifest = load_manifest(study, participant)
    require_active(manifest)
    if pending_request(study, participant):
        raise ToolkitError(f"A withdrawal request for {participant} is already waiting.")
    write_json(request_path(study, participant), {"participant": participant, "requested_by": requested_by,
                                                  "date": day})
    log(manifest, day, requested_by, "withdrawal requested", "all", "withdrawal")
    save_manifest(study, manifest)


def receipt_text(manifest):
    """Return the withdrawal receipt as Markdown."""
    withdrawal = manifest["withdrawal"]
    lines = [
        f"# Withdrawal receipt for participant {manifest['participant']}",
        "",
        f"Requested by the {withdrawal['requested_by']} on {withdrawal['date']}. Carried out by {withdrawal['staff']}.",
        "",
        "## 1. Deleted",
        "",
        "These files were removed from the study's storage. The fingerprint identifies exactly which file was removed.",
        "",
        "| File | Kind | Fingerprint (SHA-256) |",
        "|---|---|---|",
    ]
    lines += [f"| {item['path'].split('/')[-1]} | {item['kind']} | {item['sha256']} |"
              for item in manifest["items"] if item["status"] == "deleted"]
    lines += ["", "## 2. Kept by law, with access restricted", ""]
    kept = [item for item in manifest["items"] if item["status"] == "access-restricted"]
    if kept:
        lines += ["The hospital has to keep the clinical record under record retention law. "
                  "It is no longer available to the study.", "", "| File | Fingerprint (SHA-256) |", "|---|---|"]
        lines += [f"| {item['path'].split('/')[-1]} | {item['sha256']} |" for item in kept]
    else:
        lines += ["Nothing. No clinical record had been linked."]
    lines += [
        "",
        "## 3. Cannot verify",
        "",
        "These organisations hold their own copies. The study cannot check whether they have deleted them. "
        "A deletion request has to be sent to each of them directly.",
        "",
        "| Organisation | Platform | What they hold |",
        "|---|---|---|",
    ]
    lines += [f"| {copy['holder']} | {copy['platform']} | {copy['what']} |" for copy in manifest["external_copies"]]
    lines += ["", "Results already published from the study cannot be recalled."]
    if withdrawal.get("findings"):
        lines += [
            "",
            "## 4. Findings that used this data",
            "",
            "These study findings were computed with this data. The study has to compute each one again without it.",
            "",
            "| Finding | Computed on |",
            "|---|---|",
        ]
        lines += [f"| {finding['id']} | {finding['created']} |" for finding in withdrawal["findings"]]
    return "\n".join(lines) + "\n"


def receipt_code(fingerprint):
    """Return the short code printed on a receipt: the first 16 characters of its fingerprint, in groups of four."""
    start = fingerprint[:16].upper()
    return "-".join(start[position:position + 4] for position in range(0, 16, 4))


def withdraw(study, participant, requested_by, day, staff, identity_confirmed):
    """Delete the research copies, restrict the clinical record and write the receipt."""
    if requested_by not in REQUESTERS:
        raise ToolkitError("A withdrawal has to be requested by the participant or a parent.")
    if not identity_confirmed:
        raise ToolkitError("Confirm the identity of the person asking before processing a withdrawal.")
    manifest = load_manifest(study, participant)
    require_active(manifest)

    log(manifest, day, staff, "withdrawal started", "all", f"requested by the {requested_by}, identity confirmed")
    for item in manifest["items"]:
        if item["status"] != "active":
            continue
        if item["kind"] == "clinical record":
            item["status"] = "access-restricted"
            item["restricted_on"] = day
            log(manifest, day, staff, "access restricted", item["id"], "kept under record retention law")
            continue
        path = study / item["path"]
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
        if path.exists():
            raise ToolkitError(f"{item['path']} could not be deleted. The files deleted before it are recorded.")
        item["status"] = "deleted"
        item["deleted_on"] = day
        log(manifest, day, staff, "deleted", item["id"], f"file removed and confirmed absent, fingerprint {item['sha256']}")
        save_manifest(study, manifest)
    store = study / "research_store" / participant
    for folder in sorted((path for path in store.rglob("*") if path.is_dir()), reverse=True) if store.is_dir() else []:
        if not any(folder.iterdir()):
            folder.rmdir()
    if store.is_dir() and not any(store.iterdir()):
        store.rmdir()

    receipt = study / "receipts" / f"{participant}_withdrawal.md"
    affected = [{"id": finding["id"], "created": finding["created"]} for finding in findings_using(study, participant)]
    for finding in affected:
        log(manifest, day, staff, "finding marked outdated", finding["id"], "used data that has been withdrawn")
    manifest["withdrawal"] = {"date": day, "requested_by": requested_by, "staff": staff, "identity_confirmed": True,
                              "receipt": receipt.relative_to(study).as_posix(), "findings": affected}
    receipt.parent.mkdir(parents=True, exist_ok=True)
    with open(receipt, "w", encoding="utf-8", newline="\n") as f:
        f.write(receipt_text(manifest))
    manifest["withdrawal"]["receipt_sha256"] = sha256_of(receipt)
    manifest["withdrawal"]["receipt_code"] = receipt_code(manifest["withdrawal"]["receipt_sha256"])
    log(manifest, day, staff, "receipt issued", "all", f"receipt fingerprint {manifest['withdrawal']['receipt_sha256']}")
    save_manifest(study, manifest)
    request_path(study, participant).unlink(missing_ok=True)
    return manifest


def check_receipt(study, participant, code, witness=None):
    """Check a receipt code against the study's records. Return a list of {check, passed, detail}."""
    manifest = load_manifest(study, participant)
    withdrawal = manifest["withdrawal"]
    if not withdrawal:
        raise ToolkitError(f"{participant} has not withdrawn, so there is no receipt.")
    results = []

    def check(name, passed, detail):
        results.append({"check": name, "passed": bool(passed), "detail": detail})

    typed = "".join(character for character in code.upper() if character.isalnum())
    issued = withdrawal["receipt_sha256"].upper()
    check("The code belongs to this receipt", len(typed) >= 16 and issued.startswith(typed),
          "The code matches the fingerprint of the receipt that was issued."
          if len(typed) >= 16 and issued.startswith(typed) else "The code does not match the receipt that was issued.")

    receipt = study / withdrawal["receipt"]
    unchanged = receipt.is_file() and sha256_of(receipt) == withdrawal["receipt_sha256"]
    check("The receipt has not been changed", unchanged,
          "The stored receipt still has the fingerprint it was issued with." if unchanged
          else "The stored receipt is missing or differs from the one that was issued.")

    events = manifest["events"]
    entered = any(event["action"] == "receipt issued" and withdrawal["receipt_sha256"] in event["purpose"]
                  for event in events)
    intact = not broken_links(events)
    check("The receipt is entered in the sealed log", entered and intact,
          "The activity log holds the receipt's fingerprint and the log is intact." if entered and intact
          else "The activity log does not hold this receipt, or the log has been changed.")

    held = seals(witness, participant) if witness is not None else []
    if held:
        mismatched = seal_mismatches(events, held)
        check("The log matches the auditor's seals", not mismatched,
              f"The log agrees with all {len(held)} seals held by the auditor." if not mismatched
              else "The log was changed after the auditor sealed it.")
    return results


# FHIR


def exclusions(study):
    """Return the fingerprint of every item deleted on withdrawal.

    A dataset or model pipeline compares the fingerprint of each input with this list
    before using it, so that withdrawn data is kept out of later datasets.
    """
    excluded = []
    for participant in participants(study):
        manifest = load_manifest(study, participant)
        if manifest["withdrawal"]:
            excluded += [{"participant": participant, "item": item["id"], "kind": item["kind"],
                          "sha256": item["sha256"], "withdrawn": manifest["withdrawal"]["date"]}
                         for item in manifest["items"] if item["status"] == "deleted"]
    return excluded


def fhir_reference(item):
    """Return a FHIR logical reference to a stored item: its fingerprint as identifier, its path as display text."""
    return {"type": "DocumentReference", "identifier": {"type": {"text": "SHA-256"}, "value": item["sha256"]},
            "display": item["path"]}


def fhir_records(manifest):
    """Return one FHIR R5 Provenance resource for each manifest item.

    target is the item, by fingerprint. occurredDateTime is the study date of the activity and recorded is
    the moment the item was written, where the manifest holds it. Each item a dataset was derived from is
    an entity with role source. A deleted item names itself as an entity with role removal.
    """
    by_id = {item["id"]: item for item in manifest["items"]}
    records = []
    for item in manifest["items"]:
        agents = [{"type": {"text": "recorder"}, "who": {"display": item["recorded_by"]}}]
        if item["source"].get("holder"):
            agents.append({"type": {"text": "source"}, "who": {"type": "Organization", "display": item["source"]["holder"]}})
        record = {
            "resourceType": "Provenance",
            "id": item["id"],
            "target": [fhir_reference(item)],
            "occurredDateTime": item["recorded"],
        }
        if item.get("recorded_at"):
            record["recorded"] = item["recorded_at"]
        record.update({
            "policy": [f"Consent/{manifest['participant']}"],
            "activity": {"text": item["activity"]},
            "patient": {"type": "Patient", "identifier": {"value": manifest["participant"]}},
            "agent": agents,
        })
        entities = [{"role": "source", "what": fhir_reference(by_id[parent])}
                    for parent in item["derived_from"] if parent in by_id]
        if item["status"] == "deleted":
            entities.append({"role": "removal", "what": fhir_reference(item)})
        if entities:
            record["entity"] = entities
        records.append(record)
    return records


def fhir_bundle(manifest):
    """Return the Provenance resources of a manifest as one FHIR Bundle of type collection."""
    return {"resourceType": "Bundle", "type": "collection",
            "entry": [{"resource": record} for record in fhir_records(manifest)]}


def main():
    parser = argparse.ArgumentParser(description="Provenance toolkit for donated chatbot data.")
    commands = parser.add_subparsers(dest="command", required=True)

    def command(name, *options):
        sub = commands.add_parser(name)
        sub.add_argument("--study", type=Path, required=True)
        for option in options:
            sub.add_argument(option, required=True, type=Path if option in ("--donation", "--consent", "--clinical") else str)
        return sub

    command("intake", "--donation", "--consent", "--date", "--staff")
    command("link", "--participant", "--clinical", "--date", "--staff")
    command("use", "--participant", "--item", "--purpose", "--date", "--staff")
    command("verify", "--participant", "--date").add_argument("--witness", type=Path)
    command("request", "--participant", "--requested-by", "--date")
    command("withdraw", "--participant", "--requested-by", "--date", "--staff").add_argument(
        "--identity-confirmed", action="store_true")
    command("fhir", "--participant")
    args = parser.parse_args()

    try:
        if args.command == "intake":
            manifest = intake(args.study, args.donation, args.consent, args.date, args.staff)
            print(f"Intake of {len(manifest['items'])} files for {manifest['participant']}.")
        elif args.command == "link":
            link(args.study, args.participant, args.clinical, args.date, args.staff)
            print(f"Linked the clinical record of {args.participant}.")
        elif args.command == "use":
            allowed = record_use(args.study, args.participant, args.item, args.purpose, args.date, args.staff)
            print("Use logged." if allowed else "Refused: the consent does not permit this purpose.")
            sys.exit(0 if allowed else 1)
        elif args.command == "verify":
            results = verify(args.study, args.participant, args.date, args.witness)
            save_report(args.study, args.participant, args.date, results)
            for result in results:
                print(f"{'PASS' if result['passed'] else 'FAIL'}  {result['check']}: {result['detail']}")
            passed = all(result["passed"] for result in results)
            if passed and args.witness:
                seal(args.witness, load_manifest(args.study, args.participant), args.date)
            sys.exit(0 if passed else 1)
        elif args.command == "request":
            request_withdrawal(args.study, args.participant, args.requested_by, args.date)
            print(f"Withdrawal request recorded for {args.participant}.")
        elif args.command == "withdraw":
            manifest = withdraw(args.study, args.participant, args.requested_by, args.date, args.staff,
                                args.identity_confirmed)
            print(f"Withdrawal complete. Receipt: {manifest['withdrawal']['receipt']}, "
                  f"code {manifest['withdrawal']['receipt_code']}")
        elif args.command == "fhir":
            output = args.study / "fhir" / f"{args.participant}_provenance.json"
            write_json(output, fhir_bundle(load_manifest(args.study, args.participant)))
            print(f"Wrote {output.relative_to(args.study).as_posix()}")
    except ToolkitError as error:
        sys.exit(str(error))


if __name__ == "__main__":
    main()
