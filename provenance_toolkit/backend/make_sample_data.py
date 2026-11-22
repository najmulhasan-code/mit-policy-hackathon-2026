"""Generate sample files for trying the toolkit by hand.

Usage:
    python backend/make_sample_data.py

Output (all in sample_data/):
    chat_exports/chatgpt_export_01.json ... chatgpt_export_10.json
        ten exports in the list layout, each conversation with a "create_time" in seconds since 1970
    chat_exports/characterai_export_01.json ... characterai_export_10.json
        ten exports in the object layout, each conversation with a "started" date
    hospital_records/hospital_record_01.json ... hospital_record_04.json
        four records as an object with an "encounters" list
    hospital_records/hospital_record_05_fhir.json
        one record as a FHIR Bundle of Encounter resources

Nothing here comes from a real person. Message texts are numbered placeholders. Some messages
carry a made-up email address on example.org, a web address on example.org, or a phone number in
the 555-01xx range reserved for fiction, so that redaction has something to remove.
The random seed is fixed, so every run writes the same files.
"""

import json
import random
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SAMPLE_DIR = ROOT / "sample_data"

SEED = 20261122
EXPORTS_PER_PLATFORM = 10
EXPORT_DATE = date(2026, 11, 2)
FIRST_CHAT = date(2024, 11, 2)
VISIT_TYPES = ["well visit", "follow-up visit", "urgent care visit", "specialist visit"]


def write_json(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(content, f, indent=2)
        f.write("\n")


def identifier(rng, account):
    """Return one made-up identifier of a kind the redaction step removes."""
    kind = rng.choice(["email", "web", "phone"])
    if kind == "email":
        return f"Write to account{account:02d}.user{rng.randint(1, 99)}@example.org."
    if kind == "web":
        return f"My page is https://example.org/u/account{account:02d}/{rng.randint(100, 999)}."
    return f"Call me on 617-555-01{rng.randint(0, 99):02d}."


def messages(rng, account, number):
    """Return the placeholder messages of one conversation. About one conversation in six carries an identifier."""
    turns = []
    for turn in range(1, rng.randint(2, 8) + 1):
        role = "user" if turn % 2 else "assistant"
        turns.append({"role": role, "text": f"Placeholder {role} message {turn} of conversation {number}."})
    if rng.random() < 1 / 6:
        turns[0]["text"] += " " + identifier(rng, account)
    return turns


def chat_days(rng, count):
    """Return `count` conversation dates in the two years before the export, in order."""
    span = (EXPORT_DATE - FIRST_CHAT).days
    return sorted(FIRST_CHAT + timedelta(days=rng.randrange(span)) for _ in range(count))


def chatgpt_export(rng, account):
    """Return an export as a list of conversations with a title, a create_time and messages."""
    conversations = []
    for number, day in enumerate(chat_days(rng, rng.randint(20, 60)), start=1):
        started = datetime.combine(day, time(rng.randrange(7, 23), rng.randrange(60)), timezone.utc)
        conversations.append({"id": f"chatgpt-{account:02d}-{number:04d}", "title": f"Placeholder conversation {number}",
                              "create_time": int(started.timestamp()), "messages": messages(rng, account, number)})
    return conversations


def characterai_export(rng, account):
    """Return an export as an object with a conversations list, each with a started date and messages."""
    conversations = []
    for number, day in enumerate(chat_days(rng, rng.randint(15, 45)), start=1):
        conversations.append({"id": f"characterai-{account:02d}-{number:04d}", "character": f"Placeholder character {rng.randint(1, 5)}",
                              "started": day.isoformat(), "messages": messages(rng, account, number)})
    return {"platform": "Character.AI", "exported": EXPORT_DATE.isoformat(), "conversations": conversations}


def visits(rng):
    """Return two to four visits inside the period the exports cover, in order."""
    span = (EXPORT_DATE - FIRST_CHAT).days
    days = sorted(FIRST_CHAT + timedelta(days=rng.randrange(60, span)) for _ in range(rng.randint(2, 4)))
    return [{"date": day.isoformat(), "type": rng.choice(VISIT_TYPES)} for day in days]


def fhir_bundle(encounters):
    """Return the visits as a FHIR Bundle of Encounter resources."""
    return {"resourceType": "Bundle", "type": "collection", "entry": [
        {"resource": {"resourceType": "Encounter", "status": "completed",
                      "type": [{"text": visit["type"]}],
                      "actualPeriod": {"start": visit["date"]}, "period": {"start": visit["date"]}}}
        for visit in encounters]}


def generate(target):
    """Write the sample chat exports and hospital records into the folder target."""
    rng = random.Random(SEED)
    exports = target / "chat_exports"
    for account in range(1, EXPORTS_PER_PLATFORM + 1):
        write_json(exports / f"chatgpt_export_{account:02d}.json", chatgpt_export(rng, account))
    for account in range(1, EXPORTS_PER_PLATFORM + 1):
        write_json(exports / f"characterai_export_{account:02d}.json", characterai_export(rng, account))
    records = target / "hospital_records"
    for number in range(1, 5):
        write_json(records / f"hospital_record_{number:02d}.json", {"encounters": visits(rng)})
    write_json(records / "hospital_record_05_fhir.json", fhir_bundle(visits(rng)))


def main():
    generate(SAMPLE_DIR)
    print(f"Wrote {2 * EXPORTS_PER_PLATFORM} chat exports and 5 hospital records to {SAMPLE_DIR.relative_to(ROOT).as_posix()}/")


if __name__ == "__main__":
    main()
