"""Descriptive analysis of the BCH Reddit dataset on teens, generative AI and health.

Usage:
    python code/analyze_posts.py

Input:
    data/teen_ya_genai_health_final.csv    one Reddit post per row

Output:
    results/post_labels.csv    one row per post with the labels assigned here
    results/summary.md         counts and shares computed from those labels
"""

import datetime
import re
import sys
from collections import Counter

from common import (CRISIS, DATA_COLUMNS, DATA_FILE, HEALTH_TOPICS, LABELS_FILE, MAIN_PLATFORMS, ROOT,
                    SUMMARY_FILE, markdown_table, platform_names, read_table, write_rows, write_text)

# Keywords that count as a mention of suicide or self-harm.
# They are also part of the mental and emotional health list below.
CRISIS_KEYWORDS = [
    "suicid*", "kms", "kys", "kill myself", "killing myself", "killed myself", "kill yourself",
    "self harm*", "self-harm*", "selfharm*", "cut myself", "cutting myself", "cutting my", "caught cutting",
    "hurt myself", "harm myself", "harming myself", "shoot myself", "hang myself", "off myself",
    "end it all", "ending it all", "unalive*", "sewer slide",
]

# Topics follow the seven health areas in the BCH description of the dataset.
# Keywords match whole words. A trailing * allows any word ending.
TOPIC_KEYWORDS = {
    "Mental and emotional health": [
        "mental", "mentally", "depress*", "antidepress*", "anti-depress*", "anxi*", "panic attack*",
        "therap*", "lonel*", "stress*", "trauma*", "crisis", "vent", "vents", "vented", "venting", "cope",
        "copes", "coping", "cry", "crying", "cried", "sadness", "emotional*", "insecur*", "hate myself",
        "addict*",
    ] + CRISIS_KEYWORDS,
    "Sexual and reproductive health": [
        "sex", "sexual", "sexually", "sex abuse", "sa", "rape", "raped", "groped", "molest*", "pregnan*",
        "condom*", "birth control", "contracept*", "morning after pill", "my period", "her period",
        "had periods", "masturbat*", "porn*", "horny", "puberty",
    ],
    "Skin and appearance": [
        "acne", "pimple*", "skincare", "skin care", "my skin", "ugly", "attractive*", "good looking",
        "face rating",
    ],
    "Body image and eating": [
        "body image", "dysmorph*", "eating disorder*", "an ed", "anorexi*", "bulimi*", "binge eat*",
        "purge", "purging", "bmi", "calorie*", "overweight", "underweight", "lose weight", "losing weight",
        "lost weight", "weight loss", "fat", "chubby", "skinny",
    ],
    "Fitness and nutrition": [
        "workout*", "working out", "gym", "exercis*", "diet*", "nutrition*", "protein", "vitamin*",
        "fasting", "weightlifting",
    ],
    "Physical symptoms and medical care": [
        "symptom*", "injur*", "chest pain", "back pain", "migraine*", "headache*", "stomach bug",
        "stomach hurts", "doctor*", "hospital*", "the er", "surgery", "medication*", "meds", "prescri*",
    ],
    "Substances": [
        "alcohol*", "drunk", "weed", "nicotine", "vape*", "vaping", "cigarette*", "smoke", "smoked",
        "smoking", "drugs", "substance abuse", "sober",
    ],
}
if list(TOPIC_KEYWORDS) != HEALTH_TOPICS:
    raise ValueError("Topic names in TOPIC_KEYWORDS and in common.HEALTH_TOPICS differ.")

# Characters replaced before matching: typographic apostrophes and hyphens become
# plain ones, Reddit's _ and * markup becomes a space, and backslashes and soft
# hyphens are removed.
APOSTROPHES = [0x2018, 0x2019, 0x00B4, 0x02BC, 0x0060]
HYPHENS = [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2212]
CHARACTER_MAP = {code: "'" for code in APOSTROPHES}
CHARACTER_MAP.update({code: "-" for code in HYPHENS})
CHARACTER_MAP.update({ord("_"): " ", ord("*"): " ", ord("\\"): None, 0x00AD: None})

# The author's own age, 10 to 24. Forms accepted, in the order of the patterns below:
#   "I'm 15", "I am 15", "im 15m", "I'm 15yo", "I'm currently 17", "I'm now 19"
#   "I'm a 15 year old", "I'm an 18-year-old", "I'm a 13f"
#   "I'm f16"
#   "I (15M)", "me (15)", "I (F15)", "I've [17f]"
#   "I just turned 15", "I 15m"
# Skipped: an age after a word in NOT_NOW, which marks a future or conditional
# age, and a number followed by one of the words in NOT_AN_AGE.
AGE = r"(1[0-9]|2[0-4])"
SEX = r"(?:m|f|nb|male|female)"
NOT_NOW = ("till", "til", "until", "when", "once", "if", "before", "after", "unless")
FIRST_PERSON = "".join(f"(?<!{word} )" for word in NOT_NOW) + r"(?<![\w.])(?:i'm|im|i am) "
ADVERB = r"(?:(?:currently|only|just|now|still|already|literally|actually|fucking) )?"
NOT_AN_AGE = (r"(?! ?(?:%|/\d|\.\d|:\d|out of\b|next\b|soon\b|in \d|later\b|ago\b|years?[ -]old's"
              r"|years?\b(?! old)"
              r"|(?:percent|mins?|minutes?|secs?|seconds?|hours?|hrs?|days?|weeks?|months?|lbs?|pounds?|kgs?"
              r"|km|cm|ft|feet|inch|inches|miles?|meters?|metres?|steps?|pages?|dollars?|bucks?|times?"
              r"|messages?|k)\b))")
AGE_PATTERNS = [
    re.compile(FIRST_PERSON + ADVERB + AGE + r"(?: ?(?:m|f|nb|male|female|yo|y/o))?(?!\w)" + NOT_AN_AGE),
    re.compile(FIRST_PERSON + r"an? " + AGE + r"(?: ?" + SEX + r"(?!\w)|[ -]?(?:years?|yrs?|yo|y/o)(?!\w)"
               r"(?![ -]old's))"),
    re.compile(FIRST_PERSON + r"(?:an? )?(?:m|f) ?" + AGE + r"(?!\w)"),
    re.compile(r"(?<![\w.])(?:i|me|ive|i've) ?[\(\[] ?(?:" + AGE + r" ?,? ?" + SEX + r"?|(?:m|f|nb) ?,? ?"
               + AGE + r") ?[\)\]]" + NOT_AN_AGE),
    re.compile(r"(?<![\w.])i (?:just turned " + AGE + r"|" + AGE + r" ?(?:m|f))(?!\w)" + NOT_AN_AGE),
]

# An age and sex tag such as "16f" or "m17", with or without a first-person subject.
AGE_TAG = re.compile(r"(?<![\w'])(?:(?:1[0-9]|2[0-4]) ?[mf]|[mf] ?(?:1[0-9]|2[0-4]))(?!\w)")


def keyword_pattern(keywords):
    """Compile a list of keywords into one whole-word pattern.

    A match cannot start directly after a letter, digit or hyphen, so "mental"
    does not match inside "judge-mental".
    """
    parts = []
    for keyword in keywords:
        stem = re.escape(keyword.rstrip("*")).replace(r"\ ", r"\s+")
        parts.append(stem + (r"\w*" if keyword.endswith("*") else ""))
    return re.compile(r"(?<![\w-])(?:" + "|".join(parts) + r")(?!\w)")


def clean_text(post):
    """Title and body as one lower-case string with plain punctuation and single spaces."""
    text = (post["title"] + " " + post["selftext"]).lower().translate(CHARACTER_MAP)
    return " ".join(text.split())


def stated_age(text):
    """Return (age, matched words) for the earliest age statement, or (None, "")."""
    matches = [match for pattern in AGE_PATTERNS for match in [pattern.search(text)] if match]
    if not matches:
        return None, ""
    first = min(matches, key=lambda match: match.start())
    age = next(group for group in first.groups() if group)
    return int(age), first.group(0)


def check_input(posts):
    """Exit with a message if the rows of the data file cannot be analysed."""
    if not posts:
        sys.exit("The input file has no rows.")
    for column in ("id", "date", "group", "subreddit"):
        if any(not post[column].strip() for post in posts):
            sys.exit(f"The input file has an empty {column}.")
    if len({post["id"].strip() for post in posts}) != len(posts):
        sys.exit("Post ids in the input file are not unique.")
    for post in posts:
        try:
            if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", post["date"]):
                raise ValueError
            datetime.date.fromisoformat(post["date"])
        except ValueError:
            sys.exit(f"Post {post['id']} has a date that is not a valid YYYY-MM-DD date.")


def label_posts(posts):
    """Return one row of labels per post."""
    topic_patterns = {topic: keyword_pattern(words) for topic, words in TOPIC_KEYWORDS.items()}
    crisis_pattern = keyword_pattern(CRISIS_KEYWORDS)
    rows = []
    for post in posts:
        text = clean_text(post)
        age, age_words = stated_age(text)
        row = {
            "id": post["id"],
            "date": post["date"],
            "subreddit": post["subreddit"],
            "group": post["group"],
            "platforms": post["platforms"],
            "has_body_text": int(bool(post["selftext"].strip())),
            "stated_age": "" if age is None else age,
            "age_words": age_words,
            "age_tag_not_counted": int(age is None and bool(AGE_TAG.search(text))),
        }
        for topic, pattern in topic_patterns.items():
            row[topic] = int(bool(pattern.search(text)))
        row[CRISIS] = int(bool(crisis_pattern.search(text)))
        rows.append(row)
    return rows


def count_table(first_column, counts, total, by_name=False):
    """Table of counts and shares, largest first, or in name order when by_name is set."""
    order = sorted(counts.items()) if by_name else sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return markdown_table([first_column, "Posts", "Share"],
                          [(name, count, f"{100 * count / total:.1f}%") for name, count in order])


def build_summary(rows):
    """Return the text of results/summary.md."""
    total = len(rows)

    def share(count, of=total):
        return f"{100 * count / of:.1f}%"

    dates = [row["date"] for row in rows]
    no_body = sum(1 for row in rows if not row["has_body_text"])
    out = [
        "# Summary of the BCH Reddit dataset",
        "",
        f"The file has {total} posts dated {min(dates)} to {max(dates)}. "
        f"Shares are out of these {total} posts unless a different base is stated. "
        "A post is one submission. The file has no author column, so one person may have written several posts.",
        "",
        "## 1. Where the posts come from",
        "",
    ]
    out += count_table("Group", Counter(row["group"] for row in rows), total)
    out += [""]
    out += count_table("Subreddit", Counter(row["subreddit"] for row in rows), total)
    out += [""]
    out += count_table("Year", Counter(row["date"][:4] for row in rows), total, by_name=True)
    out += [
        "",
        f"The posts end on {max(dates)}, so {max(dates)[:4]} is a partial year.",
        "",
        f"{no_body} posts ({share(no_body)}) have a title and no body text.",
    ]

    named = [platform_names(row) for row in rows]
    platforms = Counter(name for names in named for name in set(names))
    unnamed = sum(1 for names in named if not names)
    other = sum(1 for names in named if any(name not in MAIN_PLATFORMS for name in names))
    out += [
        "",
        "## 2. Chatbot platforms named",
        "",
        "Platform names come from the platforms column of the dataset. The column was used as provided and "
        "was not checked against the text of the posts. A post can name more than one platform, so the rows "
        "add up to more than the number of posts.",
        "",
    ]
    out += count_table("Platform", platforms, total)
    out += [
        f"| No platform named | {unnamed} | {share(unnamed)} |",
        "",
        f"{other} posts ({share(other)}) name a platform other than {' or '.join(MAIN_PLATFORMS)}.",
    ]

    topic_counts = {topic: sum(row[topic] for row in rows) for topic in HEALTH_TOPICS}
    per_post = [sum(row[topic] for topic in HEALTH_TOPICS) for row in rows]
    two_or_more = sum(1 for count in per_post if count >= 2)
    no_topic = sum(1 for count in per_post if count == 0)
    crisis = sum(row[CRISIS] for row in rows)
    out += [
        "",
        "## 3. Health topics",
        "",
        "A post counts toward a topic if its title or body contains at least one of the topic's "
        "keywords as a whole word. The keywords are listed in section 5. A post can count toward several "
        "topics. The counts show that a topic is mentioned. They do not show that it is the main subject "
        "of the post.",
        "",
    ]
    out += count_table("Topic", topic_counts, total)
    out += [
        "",
        "Mental and emotional health is defined broadly. It includes posts that mention loneliness, sadness, "
        "stress, crying, venting, coping, addiction or using a chatbot as a therapist.",
        "",
        f"Posts matching two or more topics: {two_or_more} ({share(two_or_more)}). "
        f"Posts matching no topic: {no_topic} ({share(no_topic)}).",
        "",
        f"Posts that mention suicide or self-harm: {crisis} ({share(crisis)}). The count includes mentions "
        "about another person and statements such as \"I am not suicidal\". These posts are also counted "
        "under mental and emotional health.",
    ]

    ages = Counter(row["stated_age"] for row in rows if row["stated_age"] != "")
    stated = sum(ages.values())
    tags = sum(row["age_tag_not_counted"] for row in rows)
    bands = [("12 or younger", lambda age: age <= 12), ("13 to 17", lambda age: 13 <= age <= 17),
             ("18 to 24", lambda age: age >= 18)]
    band_rows = []
    for name, in_band in bands:
        count = sum(n for age, n in ages.items() if in_band(age))
        band_rows.append((name, count, share(count, stated) if stated else "n/a"))
    out += [
        "",
        "## 4. Age stated by the author",
        "",
        f"{stated} of {total} posts ({share(stated)}) contain a first-person statement of the author's age. "
        f"Shares in this table are out of those {stated} posts.",
        "",
    ]
    out += markdown_table(["Age", "Posts", "Share of posts with an age"], band_rows)
    out += [
        "",
        f"A further {tags} posts contain an age and sex tag such as \"16f\" that the rule does not attribute "
        "to the author. They are not counted.",
    ]

    out += ["", "## 5. Keywords used", ""]
    out += markdown_table(["Topic", "Keywords"],
                          [(topic, ", ".join(words)) for topic, words in TOPIC_KEYWORDS.items()]
                          + [(CRISIS, ", ".join(CRISIS_KEYWORDS))])
    out += ["", "A * at the end of a keyword means any word ending is accepted."]
    return "\n".join(out) + "\n"


def main():
    posts = read_table(DATA_FILE, DATA_COLUMNS)
    check_input(posts)
    rows = label_posts(posts)
    summary = build_summary(rows)
    write_rows(LABELS_FILE, rows)
    write_text(SUMMARY_FILE, summary)
    print(f"Labelled {len(rows)} posts.")
    print(f"Wrote {LABELS_FILE.relative_to(ROOT).as_posix()} and {SUMMARY_FILE.relative_to(ROOT).as_posix()}.")


if __name__ == "__main__":
    main()
