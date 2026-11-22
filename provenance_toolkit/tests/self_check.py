"""System check for the provenance toolkit.

Usage:
    python tests/self_check.py

Runs the whole scenario on a fresh temporary study with the files in tests/fixtures/:
three donations, intake, linkage to the hospital record, a refused use, a finding,
verification, a withdrawal and a recomputed finding. Each result is compared
with a value computed here by separate code: fingerprints, conversation counts,
the finding, the log chain and the ledger root. The check then alters a stored
file, edits a log entry, rewrites the history and adds a stray file, and
confirms that verification reports each one. Nothing outside the temporary
folder is read or changed, apart from reading tests/fixtures/.

Prints two lines per check, the result and a detail, and exits with status 1 if any check fails.
"""

import hashlib
import json
import re
import shutil
import sys
import tempfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

import toolkit  # noqa: E402
from toolkit import ToolkitError  # noqa: E402

STAFF = "System check"
REFUSED_PURPOSE = "training or fine-tuning of any model"


def file_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def chain_hash(entry):
    """The hash of a log entry, computed here from its fields."""
    fields = ("action", "actor", "date", "index", "item", "previous", "purpose") + (("state",) if "state" in entry else ())
    text = "{" + ",".join(json.dumps(field) + ":" + json.dumps(entry[field]) for field in fields) + "}"
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def tree_root(leaves):
    """The Merkle root over a list of entry hashes, computed here as RFC 6962 defines it."""
    def subtree(start, end):
        if end - start == 1:
            return hashlib.sha256(b"\x00" + leaves[start].encode("utf-8")).digest()
        split = 1
        while split * 2 < end - start:
            split *= 2
        return hashlib.sha256(b"\x01" + subtree(start, start + split) + subtree(start + split, end)).digest()
    return subtree(0, len(leaves)).hex() if leaves else hashlib.sha256(b"").hexdigest()


def conversations_before(export, visit, window=30):
    """Count the conversations in an export that started on the visit day or in the `window` days before it."""
    started = [date.fromisoformat(conversation["started"][:10]) for conversation in json.loads(export.read_text(encoding="utf-8"))["conversations"]]
    return sum(1 for day in started if 0 <= (date.fromisoformat(visit) - day).days <= window)


# Rules of the FHIR R5 Provenance resource that a record written here has to meet: required elements,
# the form of an instant, the codes allowed for the role of an entity, and the rule that a Reference
# carries a reference, an identifier or a display.
FHIR_INSTANT = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})")
FHIR_ENTITY_ROLES = {"revision", "quotation", "source", "instantiates", "removal"}


def fhir_faults(record):
    """Return the ways in which a record breaks those rules."""
    faults = []

    def reference(value, name):
        if not isinstance(value, dict) or not any(value.get(part) for part in ("reference", "identifier", "display")):
            faults.append(f"{name} is not a reference")

    if record.get("resourceType") != "Provenance":
        faults.append("resourceType is not Provenance")
    if not re.fullmatch(r"[A-Za-z0-9.-]{1,64}", str(record.get("id", ""))):
        faults.append("id is not a FHIR id")
    if not record.get("target"):
        faults.append("target is missing")
    for target in record.get("target", []):
        reference(target, "target")
    if "recorded" in record and not FHIR_INSTANT.fullmatch(record["recorded"]):
        faults.append("recorded is not an instant")
    if not record.get("agent"):
        faults.append("agent is missing")
    for agent in record.get("agent", []):
        reference(agent.get("who"), "agent.who")
    for entity in record.get("entity", []):
        if entity.get("role") not in FHIR_ENTITY_ROLES:
            faults.append(f"entity.role {entity.get('role')} is not an allowed code")
        reference(entity.get("what"), "entity.what")
    if "patient" in record:
        reference(record["patient"], "patient")
    return faults


def failing(results):
    return [result["check"] for result in results if not result["passed"]]


def run():
    """Run every check. Return a list of {group, check, passed, detail}."""
    results = []
    group = ["Intake"]

    def check(name, test):
        try:
            detail = test()
            results.append({"group": group[0], "check": name, "passed": True, "detail": detail})
        except AssertionError as problem:
            results.append({"group": group[0], "check": name, "passed": False, "detail": str(problem) or "The expected result was not obtained."})
        except Exception as problem:  # a check that cannot run counts as failed
            results.append({"group": group[0], "check": name, "passed": False, "detail": f"{type(problem).__name__}: {problem}"})

    with tempfile.TemporaryDirectory() as folder:
        work = Path(folder)
        study, witness = work / "study", work / "witness"
        day = date.today().isoformat()
        fixtures = ROOT / "tests" / "fixtures"
        form = toolkit.read_json(fixtures / "donation" / "donation_form.json")
        consent = toolkit.read_json(fixtures / "consent.json")
        visits = toolkit.read_json(fixtures / "clinical_record.json")["encounters"]
        donated = {"P-0001": [entry["file"] for entry in form["files"]], "P-0002": ["chatgpt_export.json"],
                   "P-0003": ["chatgpt_export.json"]}

        def prepare(participant, name, assent=True, wrong_fingerprint=False):
            """Write a donation folder, a consent file and a hospital record for one participant."""
            donation = work / name / "donation"
            donation.mkdir(parents=True)
            entries = []
            for entry in form["files"]:
                if entry["file"] in donated[participant]:
                    shutil.copyfile(fixtures / "donation" / entry["file"], donation / entry["file"])
                    fingerprint = "0" * 64 if wrong_fingerprint else file_hash(donation / entry["file"])
                    entries.append({**entry, "sha256": fingerprint})
            toolkit.write_json(donation / "donation_form.json", {**form, "participant": participant, "files": entries})
            toolkit.write_json(work / name / "consent.json",
                               {**consent, "participant": participant, "child_assent": {"given": assent, "date": day}})
            toolkit.write_json(work / name / "clinical_record.json", {"participant": participant, "encounters": visits})
            return work / name

        def refused(action):
            try:
                action()
            except ToolkitError as reason:
                return str(reason)
            raise AssertionError("The action was accepted.")

        def verify(participant):
            return toolkit.verify(study, participant, day, witness)

        def no_assent():
            source = prepare("P-0001", "without_assent", assent=False)
            return refused(lambda: toolkit.intake(study, source / "donation", source / "consent.json", day, STAFF))
        check("A donation without the participant's agreement is refused", no_assent)

        def changed_in_transit():
            source = prepare("P-0001", "changed", wrong_fingerprint=True)
            return refused(lambda: toolkit.intake(study, source / "donation", source / "consent.json", day, STAFF))
        check("A file that differs from the fingerprint taken at submission is refused", changed_in_transit)

        sources = {participant: prepare(participant, participant) for participant in donated}

        def intake():
            count = 0
            for participant, source in sources.items():
                manifest = toolkit.intake(study, source / "donation", source / "consent.json", day, STAFF)
                for item in manifest["items"]:
                    original = file_hash(fixtures / "donation" / Path(item["path"]).name)
                    assert item["sha256"] == original == file_hash(study / item["path"]), f"{item['path']} has a different fingerprint"
                    count += 1
            return f"{count} files stored. Each fingerprint equals the SHA-256 of the original file."
        check("Stored files carry the fingerprint of the original file", intake)

        group[0] = "Linkage and analysis"

        def linkage():
            rows = 0
            for participant, source in sources.items():
                toolkit.link(study, participant, source / "clinical_record.json", day, STAFF)
                linked = toolkit.read_json(study / "research_store" / participant / "linked_dataset.json")
                for row in linked["rows"]:
                    for platform, count in row["conversations_in_prior_30_days"].items():
                        name = next(entry["file"] for entry in form["files"]
                                    if entry["platform"] == platform and entry["modality"] == "text")
                        expected = conversations_before(fixtures / "donation" / name, row["encounter_date"])
                        assert count == expected, f"{participant} {platform} {row['encounter_date']}: {count}, recount {expected}"
                        rows += 1
            return f"{rows} counts of conversations in the 30 days before a visit equal a separate recount."
        check("The linked dataset counts conversations correctly", linkage)

        def redaction():
            source, target = work / "with_identifiers.json", work / "with_identifiers.redacted.json"
            toolkit.write_json(source, {"conversations": [{"started": "2025-01-05", "create_time": 1736035200, "messages": [
                {"role": "user", "text": "Write to kid.name+1@example.org or call (617) 555-0142."},
                {"role": "user", "text": "My page is https://example.org/u/kid, my other number is +1 617-555-0199."}]}]})
            removed = toolkit.write_redacted(source, target)
            text = target.read_text(encoding="utf-8")
            assert removed == {"web address": 1, "email address": 1, "phone number": 2}, f"counted {removed}"
            for identifier in ("example.org", "555-0142", "555-0199"):
                assert identifier not in text, f"{identifier} is still in the redacted copy"
            kept = json.loads(text)["conversations"][0]
            assert kept["started"] == "2025-01-05" and kept["create_time"] == 1736035200, "a date or a number was changed"
            for participant in donated:
                manifest = toolkit.load_manifest(study, participant)
                items = {item["id"]: item for item in manifest["items"]}
                linked = next(item for item in manifest["items"] if item["kind"] == "derived dataset")
                parents = [items[parent]["kind"] for parent in linked["derived_from"]]
                assert "donated export" not in parents and "redacted copy" in parents, f"{participant} was linked from the original export"
            return "An email address, two phone numbers and a web address are removed; dates and numbers are kept. Linkage reads the redacted copies."

        def same_platform():
            source = prepare("P-0001", "two_files")
            extra = source / "donation" / "second_chatgpt_export.json"
            shutil.copyfile(fixtures / "donation" / "chatgpt_export.json", extra)
            other = work / "other_study"
            both = toolkit.read_json(source / "donation" / "donation_form.json")
            first = next(entry for entry in both["files"] if entry["file"] == "chatgpt_export.json")
            both["files"].append({**first, "file": extra.name, "sha256": file_hash(extra)})
            toolkit.write_json(source / "donation" / "donation_form.json", both)
            toolkit.intake(other, source / "donation", source / "consent.json", day, STAFF)
            toolkit.link(other, "P-0001", source / "clinical_record.json", day, STAFF)
            rows = toolkit.read_json(other / "research_store" / "P-0001" / "linked_dataset.json")["rows"]
            for row in rows:
                expected = 2 * conversations_before(fixtures / "donation" / "chatgpt_export.json", row["encounter_date"])
                assert row["conversations_in_prior_30_days"]["ChatGPT"] == expected, f"{row} against {expected}"
            return "Two exports of one platform give twice the count of one, on every visit."
        check("Several files of one platform are counted together", same_platform)
        check("Email addresses, phone numbers and web addresses are removed before linkage", redaction)

        def refused_use():
            permitted = toolkit.record_use(study, "P-0001", "P-0001-item-001", REFUSED_PURPOSE, day, STAFF)
            last = toolkit.load_manifest(study, "P-0001")["events"][-1]
            assert permitted is False and last["action"] == "refused" and last["purpose"] == REFUSED_PURPOSE
            return f"'{REFUSED_PURPOSE}' was refused and the attempt is entry {last['index']} of the log."
        check("A use outside the consent is refused and logged", refused_use)

        def narrowed():
            use = lambda: toolkit.record_use(study, "P-0003", "P-0003-item-001", toolkit.ANALYSIS_PURPOSE, day, STAFF)
            assert use() is True, "analysis was refused while it was permitted"
            toolkit.update_permissions(study, "P-0003", [toolkit.LINKAGE_PURPOSE], "parent", day)
            assert use() is False, "analysis was allowed after the family switched it off"
            assert not failing(verify("P-0003")), "the earlier, permitted use is now reported: " + ", ".join(failing(verify("P-0003")))
            refused(lambda: toolkit.update_permissions(study, "P-0003", [toolkit.LINKAGE_PURPOSE, REFUSED_PURPOSE], "parent", day))
            refused(lambda: toolkit.update_permissions(study, "P-0003", [], "parent", day))
            return ("After the change analysis is refused, and the use made before it still counts as permitted. "
                    "A forbidden purpose cannot be switched on, and linkage cannot be switched off once made.")
        check("A permission switched off by the family stops that use from then on", narrowed)

        def recount(participants):
            totals, count = {}, 0
            for participant in participants:
                for visit in visits:
                    count += 1
                    for entry in form["files"]:
                        if entry["modality"] == "text" and entry["file"] in donated[participant]:
                            totals[entry["platform"]] = totals.get(entry["platform"], 0) + conversations_before(
                                fixtures / "donation" / entry["file"], visit["date"])
            return count, totals

        def finding():
            result = toolkit.build_finding(study, day, STAFF)["result"]
            count, totals = recount(["P-0001", "P-0002"])
            assert result["participants"] == 2, "a participant who switched analysis off was included"
            assert result["clinical_visits"] == count and result["conversations_in_30_days_before_a_visit"] == dict(sorted(totals.items()))
            means = {platform: round(total / count, 2) for platform, total in sorted(totals.items())}
            assert result["mean_conversations_per_visit"] == means
            return f"{count} visits, totals {dict(sorted(totals.items()))}, equal to a separate recount from the export files."
        check("The finding equals an independent recount", finding)

        group[0] = "Records"

        def chain():
            entries = 0
            for participant in donated:
                previous = "0" * 64
                for entry in toolkit.load_manifest(study, participant)["events"]:
                    assert entry["previous"] == previous and entry["hash"] == chain_hash(entry), f"{participant} entry {entry['index']}"
                    previous = entry["hash"]
                    entries += 1
            return f"{entries} log entries rehashed here. Every hash and every link to the previous entry agrees."
        check("Every log entry hash can be recomputed", chain)

        def ledger_root():
            leaves = toolkit.ledger(study)
            logged = sum(len(toolkit.load_manifest(study, participant)["events"]) for participant in donated)
            root = tree_root([leaf["hash"] for leaf in leaves])
            assert len(leaves) == logged and toolkit.ledger_root(leaves) == root
            return f"{len(leaves)} leaves, root {root}, equal to a separate Merkle computation."
        check("The ledger root equals an independent computation", ledger_root)

        def clean():
            total = 0
            for participant in donated:
                outcome = verify(participant)
                assert not failing(outcome), f"{participant}: " + ", ".join(failing(outcome))
                total += len(outcome)
                toolkit.seal(witness, toolkit.load_manifest(study, participant), day)
            mark = toolkit.checkpoint(witness, study, day)
            return f"{total} verification checks passed. Checkpoint taken at {mark['size']} entries."
        check("Verification passes on untouched records", clean)

        # Each change made to the records here is undone afterwards.
        group[0] = "Tampering"

        def expect(participant, *names):
            failed = failing(verify(participant))
            missing = [name for name in names if name not in failed]
            assert not missing, "Not reported: " + ", ".join(missing)
            return "Reported by: " + ", ".join(failed) + "."

        def altered_file():
            path = study / "research_store" / "P-0001" / "donated" / "chatgpt_export.json"
            original = path.read_bytes()
            path.write_bytes(original.replace(b"Placeholder", b"placeholder", 1))
            try:
                return expect("P-0001", "No file was altered")
            finally:
                path.write_bytes(original)
        check("A stored file changed by one character is detected", altered_file)

        def stray_file():
            path = study / "research_store" / "P-0001" / "copy_of_export.json"
            path.write_text("{}", encoding="utf-8")
            try:
                return expect("P-0001", "Every file is recorded")
            finally:
                path.unlink()
        check("A file added outside the system is detected", stray_file)

        manifest_file = toolkit.manifest_path(study, "P-0001")
        ledger_file = study / "ledger.json"

        def edited_entry():
            original = manifest_file.read_bytes()
            manifest = json.loads(original)
            entry = next(entry for entry in manifest["events"] if entry["action"] == "refused")
            entry["action"] = "use"
            toolkit.write_json(manifest_file, manifest)
            try:
                return expect("P-0001", "The activity log is intact")
            finally:
                manifest_file.write_bytes(original)
        check("An edited log entry is detected", edited_entry)

        def edited_consent():
            original = manifest_file.read_bytes()
            manifest = json.loads(original)
            manifest["consent"]["permitted_uses"].append(REFUSED_PURPOSE)
            manifest["consent"]["participant_turns_18"] = "2099-01-01"
            toolkit.write_json(manifest_file, manifest)
            try:
                return expect("P-0001", "The record matches the log")
            finally:
                manifest_file.write_bytes(original)
        check("A consent changed without a log entry is detected", edited_consent)

        def removed_item():
            original = manifest_file.read_bytes()
            manifest = json.loads(original)
            gone = manifest["items"].pop(2)
            path = study / gone["path"]
            content = path.read_bytes()
            path.unlink()
            toolkit.write_json(manifest_file, manifest)
            try:
                return expect("P-0001", "The record matches the log")
            finally:
                manifest_file.write_bytes(original)
                path.write_bytes(content)
        check("An item removed together with its file is detected", removed_item)

        def rewritten_history():
            originals = manifest_file.read_bytes(), ledger_file.read_bytes()
            manifest = json.loads(originals[0])
            next(entry for entry in manifest["events"] if entry["action"] == "refused")["action"] = "use"
            previous = "0" * 64
            for entry in manifest["events"]:
                entry["previous"] = previous
                entry["hash"] = previous = chain_hash(entry)
            leaves = json.loads(originals[1])
            for leaf in leaves:
                if leaf["participant"] == "P-0001":
                    leaf["hash"] = manifest["events"][leaf["index"]]["hash"]
            toolkit.write_json(manifest_file, manifest)
            toolkit.write_json(ledger_file, leaves)
            try:
                assert not toolkit.broken_links(manifest["events"]), "The rewritten chain should be consistent."
                return expect("P-0001", "The log matches the auditor's seals", "The study ledger is intact")
            finally:
                manifest_file.write_bytes(originals[0])
                ledger_file.write_bytes(originals[1])
        check("A history rewritten with every hash recomputed is detected", rewritten_history)

        def restored():
            assert not failing(verify("P-0001")), ", ".join(failing(verify("P-0001")))
            return "With every change undone, verification passes again."
        check("Verification passes again once the records are restored", restored)

        group[0] = "Withdrawal"

        def identity():
            toolkit.request_withdrawal(study, "P-0002", "parent", day)
            return refused(lambda: toolkit.withdraw(study, "P-0002", "parent", day, STAFF, False))
        check("A withdrawal without a confirmed identity is refused", identity)

        def frozen():
            assert toolkit.record_use(study, "P-0002", "P-0002-item-001", toolkit.LINKAGE_PURPOSE, day, STAFF) is False
            return "A permitted purpose is refused while the withdrawal request waits."
        check("No use starts while a withdrawal request is waiting", frozen)

        def withdrawal():
            manifest = toolkit.withdraw(study, "P-0002", "parent", day, STAFF, True)
            store = study / "research_store" / "P-0002"
            left = [path.name for path in store.rglob("*") if path.is_file()] if store.exists() else []
            assert not left, "Research files remain: " + ", ".join(left)
            research = [item for item in manifest["items"] if item["kind"] != "clinical record"]
            clinical = [item for item in manifest["items"] if item["kind"] == "clinical record"]
            assert all(item["status"] == "deleted" for item in research)
            assert all(item["status"] == "access-restricted" and (study / item["path"]).is_file() for item in clinical)
            return f"{len(research)} research files are gone from storage. The hospital record is kept and restricted."
        check("Withdrawal removes every research file and keeps the hospital record", withdrawal)

        def receipt():
            code = toolkit.load_manifest(study, "P-0002")["withdrawal"]["receipt_code"]
            genuine = toolkit.check_receipt(study, "P-0002", code, witness)
            wrong = toolkit.check_receipt(study, "P-0002", "0000-0000-0000-0000", witness)
            assert not failing(genuine), ", ".join(failing(genuine))
            assert failing(wrong), "A wrong code was accepted."
            return f"Code {code} is confirmed. The code 0000-0000-0000-0000 is rejected."
        check("The receipt code is confirmed and a wrong code is rejected", receipt)

        def recomputed():
            old = toolkit.findings(study)[0]
            assert toolkit.finding_status(study, old) == "outdated", "The finding was not marked outdated."
            new = toolkit.recompute_finding(study, old["id"], day, STAFF)
            assert [entry["participant"] for entry in new["inputs"]] == ["P-0001"]
            assert not (study / old["path"]).exists(), "The retired finding file remains."
            assert toolkit.findings(study)[0]["result"] is None, "The retired finding keeps a result computed with the withdrawn data."
            count, totals = recount(["P-0001"])
            assert new["result"]["clinical_visits"] == count
            assert new["result"]["conversations_in_30_days_before_a_visit"] == dict(sorted(totals.items()))
            return f"{old['id']} was marked outdated and retired. {new['id']} uses P-0001 only and equals a separate recount."
        check("A finding that used withdrawn data is retired and recomputed without it", recomputed)

        def checkpoints_hold():
            leaves, held = toolkit.ledger(study), toolkit.checkpoints(witness)
            assert held and not toolkit.checkpoint_mismatches(leaves, held)
            assert tree_root([leaf["hash"] for leaf in leaves[:held[0]["size"]]]) == held[0]["root"]
            return f"The ledger grew from {held[0]['size']} to {len(leaves)} entries and still begins with the checkpointed ones."
        check("The earlier checkpoint still holds after later entries", checkpoints_hold)

        def after_withdrawal():
            total = 0
            for participant in donated:
                outcome = verify(participant)
                assert not failing(outcome), f"{participant}: " + ", ".join(failing(outcome))
                total += len(outcome)
            return f"{total} verification checks passed across all participants."
        check("Verification passes after the withdrawal", after_withdrawal)

        group[0] = "Standard export"

        def fhir():
            count, removals = 0, 0
            for participant in donated:
                manifest = toolkit.load_manifest(study, participant)
                bundle = toolkit.fhir_bundle(manifest)
                assert bundle["resourceType"] == "Bundle" and bundle["type"] == "collection"
                assert len(bundle["entry"]) == len(manifest["items"]), f"{participant}: one record per item is expected"
                for entry in bundle["entry"]:
                    faults = fhir_faults(entry["resource"])
                    assert not faults, f"{entry['resource'].get('id')}: " + "; ".join(faults)
                    removals += sum(1 for entity in entry["resource"].get("entity", []) if entity["role"] == "removal")
                    count += 1
            assert removals == 3, f"{removals} removal entities for the three deleted items of P-0002"
            return f"{count} Provenance records meet the R5 rules checked here: required elements, instants, references and entity role codes."
        check("The lineage export follows the FHIR R5 Provenance rules", fhir)

        group[0] = "Permission updates"

        def outdated_by_permission():
            current = next(finding for finding in toolkit.findings(study) if toolkit.finding_status(study, finding) == "current")
            toolkit.update_permissions(study, "P-0001", [toolkit.LINKAGE_PURPOSE], "participant", day)
            assert toolkit.finding_status(study, current) == "outdated", "the finding still counts as current"
            last = toolkit.load_manifest(study, "P-0001")["events"][-1]
            assert last["action"] == "finding marked outdated" and last["item"] == current["id"]
            assert toolkit.recompute_finding(study, current["id"], day, STAFF) is None, "a finding was computed with no permitted data"
            return f"{current['id']} became outdated when P-0001 switched analysis off, and was retired. No participant permits analysis, so none was computed."
        check("A finding becomes outdated when a contributor switches analysis off", outdated_by_permission)

        def renewal():
            turns_18 = toolkit.load_manifest(study, "P-0001")["consent"]["participant_turns_18"]
            later = f"{int(turns_18[:4]) + 1}{turns_18[4:]}"
            valid = "Consent is still valid"
            assert valid in failing(toolkit.verify(study, "P-0001", later, witness)), "consent passed after 18 without renewal"
            use = lambda: toolkit.record_use(study, "P-0001", "P-0001-item-001", toolkit.LINKAGE_PURPOSE, later, STAFF)
            assert use() is False, "a use was allowed after 18 without the participant's own consent"
            early = refused(lambda: toolkit.renew_consent(study, "P-0001", day))
            toolkit.renew_consent(study, "P-0001", later)
            assert valid not in failing(toolkit.verify(study, "P-0001", later, witness)), "consent failed after renewal"
            assert use() is True, "a permitted use was refused after renewal"
            return f"Before 18: {early} From 18 uses are refused and verification fails until the participant consents, then both pass."
        check("Consent lapses at 18 until the participant renews it", renewal)

    return results


def main():
    results = run()
    for result in results:
        print(("pass  " if result["passed"] else "FAIL  ") + result["check"])
        print("      " + result["detail"])
    failed = sum(1 for result in results if not result["passed"])
    print(f"\n{len(results) - failed} of {len(results)} checks passed.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
