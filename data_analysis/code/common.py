"""Paths, names and file helpers shared by the scripts in this folder."""

import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "data" / "teen_ya_genai_health_final.csv"
LABELS_FILE = ROOT / "results" / "post_labels.csv"
SUMMARY_FILE = ROOT / "results" / "summary.md"

# Columns of the data file that the scripts read.
DATA_COLUMNS = ["id", "date", "subreddit", "group", "platforms", "title", "selftext"]

# The seven health topics and the separate suicide or self-harm label.
# Each name is also a column of results/post_labels.csv.
HEALTH_TOPICS = [
    "Mental and emotional health",
    "Sexual and reproductive health",
    "Skin and appearance",
    "Body image and eating",
    "Fitness and nutrition",
    "Physical symptoms and medical care",
    "Substances",
]
CRISIS = "Suicide or self-harm"

# Platforms reported on their own, as written in the platforms column, with the name used in the figures.
MAIN_PLATFORMS = {"ChatGPT": "ChatGPT", "CharacterAI": "Character.AI"}


def platform_names(row):
    """Return the platforms named in one row of the data or labels file."""
    return [name.strip() for name in row["platforms"].split(",") if name.strip()]


def read_table(path, required_columns):
    """Read a comma-separated UTF-8 file into a list of dicts. Exit with a message if it cannot be used."""
    try:
        with open(path, encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            rows = list(reader)
            columns = reader.fieldnames or []
    except FileNotFoundError:
        sys.exit(f"File not found: {path.name}")
    except UnicodeDecodeError:
        sys.exit(f"{path.name} is not saved as UTF-8.")
    except (OSError, csv.Error) as error:
        sys.exit(f"Cannot read {path.name}: {error}")
    if not columns:
        sys.exit(f"{path.name} is empty.")
    if len(set(columns)) != len(columns):
        sys.exit(f"{path.name} has a repeated column name.")
    missing = [column for column in required_columns if column not in columns]
    if missing:
        sys.exit(f"{path.name} is missing the columns: {', '.join(missing)}.")
    for number, row in enumerate(rows, start=2):
        # DictReader marks extra cells with a None key and missing cells with a None value.
        if None in row or None in row.values():
            sys.exit(f"{path.name}, line {number}: the number of cells differs from the header.")
    return rows


def write_text(path, text):
    """Write text with the same line endings on every operating system."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
    except OSError:
        sys.exit(f"Cannot write {path.name}. Close the file if it is open in another program.")


def write_rows(path, rows):
    """Write a list of dicts as a comma-separated UTF-8 file."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=list(rows[0]), lineterminator="\n")
            writer.writeheader()
            writer.writerows(rows)
    except OSError:
        sys.exit(f"Cannot write {path.name}. Close the file if it is open in another program.")


def markdown_table(header, body):
    """Return the lines of a Markdown table."""
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    lines += ["| " + " | ".join(str(cell) for cell in line) + " |" for line in body]
    return lines
