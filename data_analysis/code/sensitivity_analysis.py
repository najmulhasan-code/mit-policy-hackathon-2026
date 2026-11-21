"""Show how much the topic counts depend on the choice of keywords.

Usage:
    python code/sensitivity_analysis.py

Input:
    data/teen_ya_genai_health_final.csv

Output:
    results/sensitivity.md

For each topic the script recounts the posts under stricter rules and with
single keywords removed. It also gives the number of posts each keyword accounts for.
"""

from analyze_posts import CRISIS_KEYWORDS, TOPIC_KEYWORDS, check_input, clean_text, keyword_pattern
from common import CRISIS, DATA_COLUMNS, DATA_FILE, ROOT, markdown_table, read_table, write_text

SENSITIVITY_FILE = ROOT / "results" / "sensitivity.md"

# Mental and emotional health keywords that name a condition, a treatment or a crisis.
# The remaining keywords of that topic describe everyday feelings such as loneliness or stress.
CLINICAL_KEYWORDS = ["mental", "mentally", "depress*", "antidepress*", "anti-depress*", "anxi*", "panic attack*",
                     "therap*", "trauma*", "crisis"] + CRISIS_KEYWORDS


def keywords_found(texts, keywords):
    """For each text, return the set of keywords that match it."""
    patterns = {keyword: keyword_pattern([keyword]) for keyword in keywords}
    return [{keyword for keyword, pattern in patterns.items() if pattern.search(text)} for text in texts]


def main():
    posts = read_table(DATA_FILE, DATA_COLUMNS)
    check_input(posts)
    texts = [clean_text(post) for post in posts]
    total = len(texts)

    def share(count):
        return f"{100 * count / total:.1f}%"

    groups = dict(TOPIC_KEYWORDS)
    groups[CRISIS] = CRISIS_KEYWORDS
    found = {topic: keywords_found(texts, keywords) for topic, keywords in groups.items()}

    out = [
        "# Sensitivity of the topic counts to the keyword lists",
        "",
        f"All counts are out of {total} posts. The tables show how the counts in summary.md change under "
        "specific stricter matching rules. They measure dependence on the keyword lists. They are not bounds, "
        "and they do not measure whether a matched post is truly about the topic or how many posts on a topic "
        "use none of its keywords.",
        "",
        "## 1. Stricter rules",
        "",
        "All keywords: the count in summary.md, where one keyword is enough. "
        "Two or more keywords: the post must contain at least two different keywords of the topic. "
        "Without the top keyword: the count after removing the keyword on which the most posts rest alone. "
        "Different forms of a word, such as cry and crying, are separate keywords.",
        "",
    ]
    rule_rows = []
    for topic, keywords in groups.items():
        matched = [hits for hits in found[topic] if hits]
        full = len(matched)
        two_or_more = sum(1 for hits in matched if len(hits) >= 2)
        # Posts lost if a keyword is removed: those where it is the only keyword found.
        sole = {keyword: sum(1 for hits in matched if hits == {keyword}) for keyword in keywords}
        top = min(keywords, key=lambda keyword: (-sole[keyword], keyword))
        rule_rows.append((topic, f"{full} ({share(full)})", f"{two_or_more} ({share(two_or_more)})",
                          f"{full - sole[top]} ({share(full - sole[top])})", f"{top} ({sole[top]} posts)"))
    out += markdown_table(["Topic", "All keywords", "Two or more keywords", "Without the top keyword",
                           "Top keyword and posts that rest on it alone"], rule_rows)

    mental = "Mental and emotional health"
    clinical_set = set(CLINICAL_KEYWORDS)
    clinical = sum(1 for hits in found[mental] if hits & clinical_set)
    without_therapy = sum(1 for hits in found[mental] if hits & (clinical_set - {"therap*"}))
    everyday_only = sum(1 for hits in found[mental] if hits and not hits & clinical_set)
    out += [
        "",
        "## 2. Mental and emotional health: clinical terms and everyday feelings",
        "",
        "Clinical keywords name a condition, a treatment or a crisis: " + ", ".join(CLINICAL_KEYWORDS) + ". "
        "The other keywords of the topic describe everyday feelings. The keyword therap* also matches posts "
        "that call a chatbot a therapist, so the clinical count is given with and without it.",
        "",
    ]
    out += markdown_table(["Posts that contain", "Posts", "Share"], [
        ("At least one clinical keyword", clinical, share(clinical)),
        ("At least one clinical keyword other than therap*", without_therapy, share(without_therapy)),
        ("Everyday-feeling keywords only", everyday_only, share(everyday_only)),
        ("Either (the count in summary.md)", clinical + everyday_only, share(clinical + everyday_only)),
    ])

    out += [
        "",
        "## 3. Posts per keyword",
        "",
        "Posts: number of posts that contain the keyword. Only keyword: number of posts where it is the only "
        "keyword of its topic, so the post would leave the topic if the keyword were removed. Keywords found "
        "in no post are listed at the end of each topic.",
    ]
    for topic, keywords in groups.items():
        counts = [(keyword, sum(1 for hits in found[topic] if keyword in hits),
                   sum(1 for hits in found[topic] if hits == {keyword})) for keyword in keywords]
        used = sorted((row for row in counts if row[1]), key=lambda row: (-row[1], row[0]))
        unused = sorted(row[0] for row in counts if not row[1])
        out += ["", f"### {topic}", ""]
        out += markdown_table(["Keyword", "Posts", "Only keyword"], used)
        if unused:
            out += ["", "Found in no post: " + ", ".join(unused) + "."]

    write_text(SENSITIVITY_FILE, "\n".join(out) + "\n")
    print(f"Wrote {SENSITIVITY_FILE.relative_to(ROOT).as_posix()}")


if __name__ == "__main__":
    main()
