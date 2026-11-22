"""Web server for the provenance toolkit.

Usage:
    python backend/server.py

Serves the interface and its API on this machine only, at the address printed on start.
The API calls the
functions in toolkit.py and returns, with each result, the state the caller may see.

A caller first chooses one of three roles, and the server decides from the role
what the caller may do. The role stands for the person that the sign-in of the system
hosting the toolkit would identify.
    family     donates, changes its permissions, gives the participant's own consent
               at 18, asks to withdraw and checks a receipt.
    study      the research team. Receives, links, requests access, analyses and
               carries out withdrawals.
    auditor    the auditor. Verifies and downloads reports. May not
               change a donation.
Every role sees every donation, by participant number.

Folders, all in the folder storage next to the backend folder:
    storage/incoming/    donations that families have submitted and the study has not yet received
    storage/study/       the study's storage
    storage/witness/     the auditor's seals and ledger checkpoints, kept apart from the study's storage
The uses a study permits and the platforms it accepts are read from study_protocol.json.
"""

import base64
import binascii
import hashlib
import re
import secrets
import shutil
import sys
import threading
from datetime import date, datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import toolkit
from toolkit import ToolkitError

ROOT = Path(__file__).resolve().parent.parent
PARTICIPANT_ID = re.compile(r"P-[0-9]{4}")
FILE_NAME = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9._ -]{0,98}[A-Za-z0-9])?")
# Names that Windows reserves for devices, whatever the extension.
DEVICE_NAMES = {"CON", "PRN", "AUX", "NUL", *(f"COM{n}" for n in range(1, 10)), *(f"LPT{n}" for n in range(1, 10))}
MAX_FILES = 20
MAX_FILE_BYTES = 10 * 1024 * 1024
SESSION_COOKIE = "session"
# The name written to the log for each role. A hospital would pass the name of the person
# from its own sign-in service.
ROLE_NAMES = {"family": "Family", "study": "Research team", "auditor": "Auditor"}
MODALITIES = {
    "text": {".json", ".txt", ".html", ".htm", ".csv", ".md"},
    "image": {".png", ".jpg", ".jpeg", ".gif", ".webp"},
    "audio": {".mp3", ".wav", ".m4a", ".ogg"},
}


class UploadedFile(BaseModel):
    name: str
    platform: str
    account_holder: str
    content: str  # base64
    sha256: str  # fingerprint computed on the sender's device


class Donation(BaseModel):
    files: list[UploadedFile]
    exported: str
    completeness: str
    participant_turns_18: str
    parental_permission: bool
    child_assent: bool


class Participant(BaseModel):
    participant: str


class Recompute(BaseModel):
    finding: str


class Encounter(BaseModel):
    date: str
    type: str


class Link(BaseModel):
    participant: str
    encounters: list[Encounter]


class Use(BaseModel):
    participant: str
    item: str
    purpose: str


class WithdrawalRequest(BaseModel):
    participant: str
    requested_by: str


class Withdrawal(BaseModel):
    participant: str
    identity_confirmed: bool


class ReceiptCode(BaseModel):
    participant: str
    code: str


class Permissions(BaseModel):
    participant: str
    permitted: list[str]
    requested_by: str


class RoleChoice(BaseModel):
    role: str


def bad_request(message):
    return HTTPException(status_code=400, detail=message)


def iso_date(text, name):
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError:
        raise bad_request(f"{name} has to be a date in the form YYYY-MM-DD.") from None


def create_app(study, incoming, witness, protocol_file, today=lambda: date.today().isoformat(), interface=None):
    """Return the application.

    study: folder used as the study's storage.
    incoming: folder for donations that have been submitted and not yet received.
    witness: folder in which the auditor keeps its seals.
    protocol_file: JSON file with the study's permitted uses, prohibited uses and platforms.
    today: function returning the current date as YYYY-MM-DD.
    interface: folder with the built interface, served at /. None serves the API only.
    """
    app = FastAPI(title="Provenance toolkit", docs_url="/api/docs", redoc_url=None, openapi_url="/api/openapi.json")
    one_at_a_time = threading.Lock()
    protocol = toolkit.read_json(protocol_file)

    @app.exception_handler(ToolkitError)
    def refused(request, error):
        return JSONResponse(status_code=400, content={"detail": str(error)})

    def waiting():
        """Return the ids of donations that were submitted and not yet received."""
        return sorted(path.name for path in incoming.glob("P-*") if path.is_dir()) if incoming.exists() else []

    def well_formed(participant):
        if not PARTICIPANT_ID.fullmatch(participant):
            raise bad_request("A participant number has the form P-0000.")
        return participant

    def received(participant):
        """Return the participant id if the study has received that donation."""
        if well_formed(participant) not in toolkit.participants(study):
            raise HTTPException(status_code=404, detail=f"The study holds no donation from {participant}.")
        return participant

    def read_optional(path):
        return toolkit.read_json(path) if path.exists() else None

    # Sessions

    sessions = {}

    def session_of(request):
        return sessions.get(request.cookies.get(SESSION_COOKIE, ""))

    def signed_in(request, *roles):
        """Return the caller's session. Refuse a caller with no session or with a role not in `roles`."""
        session = session_of(request)
        if session is None:
            raise HTTPException(status_code=401, detail="Choose a role first.")
        if roles and session["role"] not in roles:
            raise HTTPException(status_code=403, detail="This action is not open to your role.")
        return session

    def open_session(response, role):
        token = secrets.token_urlsafe(32)
        sessions[token] = {"role": role, "name": ROLE_NAMES[role]}
        response.set_cookie(SESSION_COOKIE, token, httponly=True, samesite="strict")
        return sessions[token]

    def next_participant():
        known = toolkit.participants(study) + waiting()
        return f"P-{max((int(name[2:]) for name in known), default=0) + 1:04d}"

    def state(session):
        """Return everything the interface shows, read from storage at this moment."""
        submitted = []
        for participant in waiting():
            form = toolkit.read_json(incoming / participant / "donation" / "donation_form.json")
            folder = incoming / participant / "donation"
            submitted.append({
                "id": participant,
                "submitted": form["submitted"],
                "completeness": form["completeness"],
                "consent": toolkit.read_json(incoming / participant / "consent.json"),
                "files": [{**entry, "bytes": (folder / entry["file"]).stat().st_size} for entry in form["files"]],
            })
        people = []
        for participant in toolkit.participants(study):
            manifest = toolkit.load_manifest(study, participant)
            held = toolkit.seals(witness, participant)
            people.append({
                "id": participant,
                "manifest": manifest,
                "pending_request": toolkit.pending_request(study, participant),
                "report": read_optional(study / "reports" / f"{participant}_verification.json"),
                "storage": toolkit.scan_storage(study, manifest),
                "broken_links": toolkit.broken_links(manifest["events"]),
                "seals": held,
                "seal_mismatches": [mark["index"] for mark in toolkit.seal_mismatches(manifest["events"], held)],
            })
        results = [{**finding, "status": toolkit.finding_status(study, finding)} for finding in toolkit.findings(study)]
        leaves = toolkit.ledger(study)
        root = toolkit.ledger_root(leaves)
        held_checkpoints = toolkit.checkpoints(witness)
        return {
            "session": session,
            "today": today(),
            "scanned_at": datetime.now().strftime("%H:%M:%S"),
            "protocol": protocol,
            "waiting": submitted,
            "participants": people,
            "findings": results,
            "ledger": {"leaves": leaves, "root": root},
            "checkpoints": held_checkpoints,
        }

    def result(session, **extra):
        """Return the result of an action, followed by the state read afterwards."""
        return {**extra, **state(session)}

    @app.get("/api/session")
    def get_session(request: Request):
        return {"session": session_of(request)}

    @app.post("/api/role")
    def post_role(body: RoleChoice, response: Response):
        """Start acting in one of the three roles. Return the state."""
        with one_at_a_time:
            if body.role not in ROLE_NAMES:
                raise bad_request("Choose a role.")
            return state(open_session(response, body.role))

    @app.post("/api/leave-role")
    def post_leave_role(request: Request, response: Response):
        sessions.pop(request.cookies.get(SESSION_COOKIE, ""), None)
        response.delete_cookie(SESSION_COOKIE)
        return {"session": None}

    @app.get("/api/state")
    def get_state(request: Request):
        with one_at_a_time:
            return state(signed_in(request))

    @app.post("/api/donate")
    def post_donate(body: Donation, request: Request):
        """Store a family's submitted donation and consent until the study receives it."""
        with one_at_a_time:
            session = signed_in(request, "family")
            if not 1 <= len(body.files) <= MAX_FILES:
                raise bad_request(f"Add between 1 and {MAX_FILES} files.")
            if not (body.parental_permission and body.child_assent):
                raise bad_request("A donation needs both the parent's permission and the participant's agreement.")
            completeness = " ".join(body.completeness.split())[:500] or "No statement given."
            exported = iso_date(body.exported, "The export date")
            turns_18 = iso_date(body.participant_turns_18, "The date the participant turns 18")
            if turns_18 <= today():
                raise bad_request("This form is for a participant under 18. An adult consents in their own name.")
            decoded, names = [], set()
            for upload in body.files:
                name = Path(upload.name).name
                reserved = name.lower() == "donation_form.json" or name.split(".")[0].upper() in DEVICE_NAMES
                if not FILE_NAME.fullmatch(name) or reserved:
                    raise bad_request(f"The file name '{upload.name}' cannot be used. Use letters, digits, spaces, "
                                      "dots, dashes and underscores, starting and ending with a letter or digit.")
                if name.lower() in names:
                    raise bad_request(f"Two files are named {name}.")
                names.add(name.lower())
                if upload.platform not in protocol["platforms"]:
                    raise bad_request(f"Choose a platform for {name}.")
                if upload.account_holder not in ("participant", "someone else"):
                    raise bad_request(f"Say whose account {name} came from.")
                try:
                    content = base64.b64decode(upload.content, validate=True)
                except (binascii.Error, ValueError):
                    raise bad_request(f"{name} could not be read.") from None
                if not 0 < len(content) <= MAX_FILE_BYTES:
                    raise bad_request(f"{name} is empty or larger than 10 MB.")
                fingerprint = hashlib.sha256(content).hexdigest()
                if upload.sha256 != fingerprint:
                    raise bad_request(f"{name} arrived with fingerprint {fingerprint}, "
                                      f"which differs from the one computed on your device.")
                extension = Path(name).suffix.lower()
                modality = next((kind for kind, endings in MODALITIES.items() if extension in endings), "other")
                if modality == "text":
                    try:
                        content.decode("utf-8-sig")
                    except UnicodeDecodeError:
                        raise bad_request(f"{name} is not UTF-8 text. Export it again as UTF-8.") from None
                decoded.append((name, content, {
                    "file": name, "platform": upload.platform, "holder": protocol["platforms"][upload.platform],
                    "modality": modality, "exported": exported, "export_method": "account data export",
                    "account_holder": upload.account_holder, "sha256": fingerprint,
                }))

            participant = next_participant()
            folder = incoming / participant / "donation"
            folder.mkdir(parents=True)
            for name, content, _ in decoded:
                (folder / name).write_bytes(content)
            toolkit.write_json(folder / "donation_form.json", {
                "participant": participant, "submitted": today(), "completeness": completeness,
                "files": [entry for _, _, entry in decoded],
            })
            toolkit.write_json(incoming / participant / "consent.json", {
                "participant": participant,
                "study_protocol": protocol["study_protocol"],
                "parental_permission": {"given": True, "date": today()},
                "child_assent": {"given": True, "date": today()},
                "participant_turns_18": turns_18,
                "permitted_uses": protocol["permitted_uses"],
                "prohibited_uses": protocol["prohibited_uses"],
            })
            return result(session, participant=participant)

    @app.post("/api/intake")
    def post_intake(body: Participant, request: Request):
        with one_at_a_time:
            session = signed_in(request, "study")
            participant = well_formed(body.participant)
            if participant not in waiting():
                raise HTTPException(status_code=404, detail=f"No donation from {participant} is waiting.")
            toolkit.intake(study, incoming / participant / "donation", incoming / participant / "consent.json",
                           today(), session["name"])
            shutil.rmtree(incoming / participant)
            return result(session)

    @app.post("/api/link")
    def post_link(body: Link, request: Request):
        with one_at_a_time:
            session = signed_in(request, "study")
            participant = received(body.participant)
            if not 1 <= len(body.encounters) <= 200:
                raise bad_request("Enter at least one visit from the health record.")
            encounters = [{"date": iso_date(visit.date, "A visit date"),
                           "type": " ".join(visit.type.split())[:80] or "visit"} for visit in body.encounters]
            record = incoming / f"{participant}_clinical_record.json"
            toolkit.write_json(record, {"participant": participant,
                                        "encounters": sorted(encounters, key=lambda visit: visit["date"])})
            try:
                toolkit.link(study, participant, record, today(), session["name"])
            finally:
                record.unlink(missing_ok=True)
            return result(session)

    @app.post("/api/use")
    def post_use(body: Use, request: Request):
        with one_at_a_time:
            session = signed_in(request, "study")
            participant = received(body.participant)
            consent = toolkit.load_manifest(study, participant)["consent"]
            if body.purpose not in toolkit.offered_uses(consent) + consent["prohibited_uses"]:
                raise bad_request("Choose one of the purposes listed in the consent.")
            permitted = toolkit.record_use(study, participant, body.item, body.purpose, today(), session["name"])
            return result(session, permitted=permitted)

    @app.post("/api/findings")
    def post_finding(request: Request):
        with one_at_a_time:
            session = signed_in(request, "study")
            finding = toolkit.build_finding(study, today(), session["name"])
            return result(session, finding=finding["id"])

    @app.post("/api/findings/recompute")
    def post_recompute(body: Recompute, request: Request):
        with one_at_a_time:
            session = signed_in(request, "study")
            if not re.fullmatch(r"F-[0-9]{4}", body.finding):
                raise bad_request("A finding number has the form F-0000.")
            finding = toolkit.recompute_finding(study, body.finding, today(), session["name"])
            return result(session, finding=finding["id"] if finding else None)

    @app.post("/api/verify")
    def post_verify(body: Participant, request: Request):
        with one_at_a_time:
            session = signed_in(request, "auditor")
            participant = received(body.participant)
            results = toolkit.verify(study, participant, today(), witness)
            toolkit.save_report(study, participant, today(), results)
            log_checks = [entry for entry in results if entry["check"].startswith("The activity log")
                          or entry["check"].startswith("The log matches")
                          or entry["check"].startswith("The study ledger")]
            if all(entry["passed"] for entry in log_checks):
                toolkit.seal(witness, toolkit.load_manifest(study, participant), today())
                toolkit.checkpoint(witness, study, today())
            return result(session)

    @app.post("/api/permissions")
    def post_permissions(body: Permissions, request: Request):
        with one_at_a_time:
            session = signed_in(request, "family")
            toolkit.update_permissions(study, received(body.participant), body.permitted,
                                       body.requested_by, today())
            return result(session)

    @app.post("/api/renew-consent")
    def post_renew_consent(body: Participant, request: Request):
        with one_at_a_time:
            session = signed_in(request, "family")
            toolkit.renew_consent(study, received(body.participant), today())
            return result(session)

    @app.post("/api/request-withdrawal")
    def post_request(body: WithdrawalRequest, request: Request):
        with one_at_a_time:
            session = signed_in(request, "family")
            toolkit.request_withdrawal(study, received(body.participant), body.requested_by, today())
            return result(session)

    @app.post("/api/withdraw")
    def post_withdraw(body: Withdrawal, request: Request):
        with one_at_a_time:
            session = signed_in(request, "study")
            participant = received(body.participant)
            asked = toolkit.pending_request(study, participant)
            if asked is None:
                raise bad_request("There is no withdrawal request to process.")
            toolkit.withdraw(study, participant, asked["requested_by"], today(), session["name"],
                             body.identity_confirmed)
            return result(session)

    @app.post("/api/check-receipt")
    def post_check_receipt(body: ReceiptCode, request: Request):
        with one_at_a_time:
            session = signed_in(request, "family", "auditor")
            checks = toolkit.check_receipt(study, received(body.participant), body.code, witness)
            return result(session, receipt_checks=checks, genuine=all(entry["passed"] for entry in checks))

    @app.get("/api/exclusions")
    def get_exclusions(request: Request):
        """Return the fingerprints of all items deleted on withdrawal, as a file to download."""
        signed_in(request, "study", "auditor")
        content = {"study_protocol": protocol["study_protocol"], "generated": today(),
                   "excluded": toolkit.exclusions(study)}
        return JSONResponse(content, headers={
            "Content-Disposition": 'attachment; filename="exclusion_manifest.json"'})

    @app.get("/api/report/{participant}")
    def get_report(participant: str, request: Request):
        """Return the latest verification report of a participant, as a file to download."""
        signed_in(request, "auditor")
        report = read_optional(study / "reports" / f"{received(participant)}_verification.json")
        if report is None:
            raise HTTPException(status_code=404, detail=f"{participant} has not been verified.")
        return JSONResponse(report, headers={
            "Content-Disposition": f'attachment; filename="{participant}_verification.json"'})

    @app.get("/api/fhir/{participant}")
    def get_fhir(participant: str, request: Request):
        signed_in(request)
        return toolkit.fhir_bundle(toolkit.load_manifest(study, received(participant)))

    if interface is not None and interface.is_dir():
        app.mount("/", StaticFiles(directory=interface, html=True), name="interface")
    return app


STORAGE = ROOT / "storage"
app = create_app(STORAGE / "study", STORAGE / "incoming", STORAGE / "witness", ROOT / "study_protocol.json",
                 interface=ROOT / "frontend" / "out")

if __name__ == "__main__":
    import uvicorn

    if not (ROOT / "frontend" / "out").is_dir():
        print("The interface has not been built. Only the API is available, documented under /api/docs.",
              file=sys.stderr)
    uvicorn.run(app, host="127.0.0.1", port=8000)
