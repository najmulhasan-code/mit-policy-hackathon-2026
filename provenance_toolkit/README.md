# Provenance toolkit

A data provenance toolkit for a hospital research study that receives adolescents' donated chatbot exports and links them to hospital visit records. For any donated file it answers where the file came from, what was done to it, what it was linked to, who used it and for which purpose, what the family permitted, and what was made from it. It also carries out a withdrawal and gives the family a receipt. The toolkit is a Python engine, a FastAPI server and a Next.js interface. The data files in the repository are generated placeholders.

## What it records

Each donation has one manifest, a JSON file with the consent, one entry per stored file, the activity log and the withdrawal record. It covers six parts of provenance.

| Part | What is recorded |
|---|---|
| Origin | For each donated file: the platform and whose account it came from, as declared by the family, the organisation holding the original, the export date, the date received and the SHA-256 fingerprint |
| Transformations | Each step that produced a new file, with its inputs, the actor, the date and the fingerprint of the output, and for a redacted copy the number of identifiers removed. Redaction removes email addresses, web addresses and phone numbers by rule and is not de-identification |
| Linkages | The hospital visit record and the dataset that links it to the redacted chats: per visit, the number of conversations per platform on the day of the visit and in the 30 days before it |
| Access and sharing | Every request to use a file: who asked, the purpose, the date and whether it was granted or refused |
| Permissions | Parental permission and assent with dates, the purposes permitted and prohibited, each later change by the family, the participant's own consent at 18, and the retention rule of each file |
| Derivatives | The datasets derived from the donation and the findings computed from them, each finding with its inputs by fingerprint and a status (current, outdated or retired) |

## How records are verified

| Mechanism | What it does |
|---|---|
| File fingerprint | Every stored file gets a SHA-256 fingerprint when it is recorded, and verification recomputes it |
| Hash-chained log | The hash of each log entry covers its content and the hash of the entry before it, so an edit, an insertion, or a removal before the last entry breaks the chain |
| Record state hash | On each save the newest log entry carries the hash of the rest of the manifest, which ties the consent, the file records and the withdrawal record to the log |
| Study ledger | The ledger lists the hash of every log entry of the study in the order written, and the root of the Merkle tree over it (shaped as in RFC 6962) covers the whole study. A removal of the last entries of a log shows here unless the ledger is shortened to match, which an earlier checkpoint catches |
| Seal and checkpoint | When the auditor verifies a donation through the server and the log checks pass, the auditor's folder receives a seal (the hash of the latest log entry) and a checkpoint (the size and root of the ledger). A log rewritten up to the latest sealed entry, with every hash recomputed, no longer matches them. An independent check requires the auditor's folder to be held by a separate party |

The browser recomputes the log entry hashes, the chain, the record state hash and the ledger root itself from the records the server returns.

## Roles

A role is chosen on the start page. Sign-in is left to the system that hosts the toolkit, so each role sees every donation of the study. The interface has four pages: Files, Findings (for the research team and the auditor), Withdrawals and Ledger.

| Role | What it does |
|---|---|
| Family | Donates chat exports with parental permission and the participant's assent, follows each file, changes its permissions, gives the participant's own consent at 18, requests a withdrawal and checks a receipt code |
| Research team | Receives donations, links the hospital visit record, requests access to a file for a stated purpose, runs the analysis and recomputes findings, and carries out requested withdrawals |
| Auditor | Runs the verification checklist, inspects the ledger, reads the findings and downloads the verification report and the exclusion manifest |

## Consent and withdrawal

A request to use a file is compared with the purposes the consent permits at that moment, and the decision is logged. The family can switch an offered purpose off and on again, and a change applies to every later use; linkage can no longer be switched off once the record is linked, which then needs a withdrawal. From the day the participant turns 18, new uses and linkage are refused and the participant's data is left out of new analyses until the participant consents in their own name. Findings computed earlier stay current. On withdrawal the research copies are deleted and each deletion is logged with the file's fingerprint, the hospital visit record is kept and marked access-restricted (a label in the record), findings that used the data are marked outdated until the research team recomputes them without it, and the family gets a receipt with a code that can be checked later. The fingerprints of the deleted files enter the exclusion manifest. Deletion covers the study's storage; the receipt lists the chatbot provider's copies as copies the study cannot check.

## Exports

| Export | Content |
|---|---|
| Manifest | The full record of one donation as JSON |
| FHIR R5 Provenance bundle | One Provenance resource per stored file, with its sources and, for a deleted file, its removal |
| Exclusion manifest | The fingerprints of all files deleted on withdrawal, for a later dataset or model pipeline to compare its inputs against. A fingerprint matches byte-identical copies only |
| Verification report | The result and detail of each check of the latest verification of a donation |
| Withdrawal receipt | What was deleted, what was kept with access restricted, which outside copies the study cannot check, and which findings used the data |

## Getting started

The toolkit needs Python 3.12 and Node.js 20.9 or later. Run all commands from this folder.

On macOS and Linux:

```
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd frontend
npm ci
npm run build
cd ..
python backend/server.py
```

On Windows, in Command Prompt or PowerShell, the first two commands are replaced by:

```
python -m venv .venv
.venv\Scripts\activate
```

The server prints its address; open it in a browser. It uses port 8000, which has to be free. Run-time data is written to the folder storage.

The folder sample_data holds twenty placeholder chat exports and five placeholder hospital records for trying the interface. The engine also has a command line, described at the top of backend/toolkit.py.

The sample files and the input files of the check are written with a fixed random seed, and the same files are written again by:

```
python backend/make_sample_data.py
python backend/make_example_donation.py
```

## Check

```
python tests/self_check.py
```

The check runs the whole scenario, from donation to withdrawal, on a temporary study with the files in tests/fixtures and compares the results with values computed by separate code. It then alters a stored file, adds a stray file, edits a log entry, changes the consent without a log entry and rewrites the history with every hash recomputed, and confirms that verification reports each one. It needs the Python standard library only and ends with the line "29 of 29 checks passed."
