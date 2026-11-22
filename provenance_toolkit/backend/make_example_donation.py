"""Generate a made-up donation for the checks.

Usage:
    python backend/make_example_donation.py

Output (all in tests/fixtures/):
    donation/chatgpt_export.json        placeholder conversations
    donation/characterai_export.json    placeholder conversations
    donation/uploaded_image_0001.png    a small grey image
    donation/donation_form.json         what the participant states about each file
    consent.json                        parental permission, assent and permitted uses
    clinical_record.json                placeholder health record

Nothing here comes from a real person. Message texts are numbered placeholders.
The random seed is fixed, so every run writes the same files.
"""

import json
import random
import struct
import zlib
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURES_DIR = ROOT / "tests" / "fixtures"

SEED = 20261121
PARTICIPANT = "P-0001"
EXPORT_DATE = date(2026, 11, 2)
FIRST_CHAT = date(2024, 11, 2)


def write_json(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(content, f, indent=2)
        f.write("\n")


def placeholder_conversations(rng, platform, count):
    """Return conversations spread over two years, each with numbered placeholder messages."""
    conversations = []
    span = (EXPORT_DATE - FIRST_CHAT).days
    for number in range(1, count + 1):
        day = FIRST_CHAT + timedelta(days=rng.randrange(span))
        messages = []
        for turn in range(1, rng.randint(2, 6) + 1):
            role = "user" if turn % 2 else "assistant"
            messages.append({"role": role, "text": f"Placeholder {role} message {turn} of conversation {number}."})
        conversations.append({"id": f"{platform.lower()}-{number:04d}", "started": day.isoformat(),
                              "messages": messages})
    return sorted(conversations, key=lambda conversation: (conversation["started"], conversation["id"]))


def grey_png(size=16, level=128):
    """Return the bytes of a small grey PNG image."""
    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    row = b"\x00" + bytes([level]) * size
    header = struct.pack(">IIBBBBB", size, size, 8, 0, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(row * size, 9))
            + chunk(b"IEND", b""))


def generate(target):
    """Write the example donation, consent and clinical record into the folder target."""
    rng = random.Random(SEED)
    donation = target / "donation"

    write_json(donation / "chatgpt_export.json",
               {"platform": "ChatGPT", "exported": EXPORT_DATE.isoformat(),
                "conversations": placeholder_conversations(rng, "ChatGPT", 40)})
    write_json(donation / "characterai_export.json",
               {"platform": "Character.AI", "exported": EXPORT_DATE.isoformat(),
                "conversations": placeholder_conversations(rng, "CharacterAI", 25)})
    donation.mkdir(parents=True, exist_ok=True)
    (donation / "uploaded_image_0001.png").write_bytes(grey_png())

    write_json(donation / "donation_form.json", {
        "participant": PARTICIPANT,
        "files": [
            {"file": "chatgpt_export.json", "platform": "ChatGPT", "holder": "OpenAI", "modality": "text",
             "exported": EXPORT_DATE.isoformat(), "export_method": "account data export",
             "account_holder": "participant"},
            {"file": "characterai_export.json", "platform": "Character.AI", "holder": "Character Technologies",
             "modality": "text", "exported": EXPORT_DATE.isoformat(), "export_method": "account data export",
             "account_holder": "participant"},
            {"file": "uploaded_image_0001.png", "platform": "ChatGPT", "holder": "OpenAI", "modality": "image",
             "exported": EXPORT_DATE.isoformat(), "export_method": "account data export",
             "account_holder": "participant"},
        ],
        "completeness": "Participant reports deleting some conversations before the export. "
                        "The export is not a complete record of the account.",
    })

    write_json(target / "consent.json", {
        "participant": PARTICIPANT,
        "study_protocol": "EXAMPLE-PROTOCOL-0001",
        "parental_permission": {"given": True, "date": "2026-11-05"},
        "child_assent": {"given": True, "date": "2026-11-05"},
        "participant_turns_18": "2029-03-14",
        "permitted_uses": ["linkage to the health record for this study", "analysis by named study staff"],
        "prohibited_uses": ["training or fine-tuning of any model", "sharing outside the study team",
                            "commercial use"],
    })

    write_json(target / "clinical_record.json", {
        "participant": PARTICIPANT,
        "encounters": [{"date": "2025-06-10", "type": "placeholder visit"},
                       {"date": "2026-02-18", "type": "placeholder visit"}],
    })


def main():
    generate(FIXTURES_DIR)
    print(f"Wrote the example donation, consent and clinical record to {FIXTURES_DIR.relative_to(ROOT).as_posix()}/")


if __name__ == "__main__":
    main()
