"""Draw the figures for the dataset summary.

Usage:
    python code/make_figures.py

Input:
    results/post_labels.csv    written by analyze_posts.py

Output:
    results/figures/chatbot_platforms.png
    results/figures/health_topics.png
    results/figures/stated_age.png
    results/figures/platforms_and_health_topics.png    the first two side by side

Each figure has a short descriptive title. Fuller captions are in README.md. Requires matplotlib.
"""

import sys
from collections import Counter

from common import CRISIS, HEALTH_TOPICS, LABELS_FILE, MAIN_PLATFORMS, ROOT, platform_names, read_table

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib import font_manager
    from matplotlib.offsetbox import AnnotationBbox, HPacker, TextArea
    from matplotlib.patches import Patch
except ImportError:
    sys.exit("This script needs matplotlib. Install it with: pip install matplotlib")

FIGURES_DIR = ROOT / "results" / "figures"
DPI = 600

# Teal for the main bars, amber for the highlighted row, grey for the remaining categories.
TEAL, AMBER = "#0f8b8d", "#f2a900"
INK, MUTED, LIGHT_GREY, GRID = "#1a1a1a", "#5c5c5c", "#b5b5b5", "#e3e3e3"

TITLE_STYLE = {"loc": "left", "fontsize": 11.5, "fontweight": "bold", "color": INK, "pad": 12}

installed_fonts = {font.name for font in font_manager.fontManager.ttflist}
plt.rcParams.update({
    "font.family": "Arial" if "Arial" in installed_fonts else "DejaVu Sans",
    "font.size": 10.5,
    "axes.edgecolor": INK,
    "axes.labelcolor": INK,
    "axes.linewidth": 0.8,
    "xtick.color": MUTED,
    "ytick.color": INK,
    "figure.facecolor": "white",
    "axes.facecolor": "white",
})


def horizontal_bars(ax, names, counts, colors, total, title):
    """Draw horizontal bars of count / total with the count and share written beside each bar."""
    shares = [100 * count / total for count in counts]
    positions = list(range(len(names), 0, -1))
    ax.barh(positions, shares, color=colors, height=0.66, zorder=2)
    for position, count, share in zip(positions, counts, shares):
        label = HPacker(pad=0, sep=5, align="center", children=[
            TextArea(str(count), textprops={"fontsize": 10.5, "fontweight": "bold", "color": INK}),
            TextArea(f"{share:.1f}%", textprops={"fontsize": 10, "color": MUTED}),
        ])
        ax.add_artist(AnnotationBbox(label, (share, position), xybox=(6, 0), boxcoords="offset points",
                                     box_alignment=(0, 0.5), frameon=False, pad=0))
    ax.set_yticks(positions)
    ax.set_yticklabels(names)
    ax.tick_params(axis="y", length=0, pad=6)
    ax.tick_params(axis="x", length=0, labelsize=9.5)
    for side in ("top", "right", "left", "bottom"):
        ax.spines[side].set_visible(False)
    ax.set_xlim(0, 100)
    ax.set_ylim(0.4, len(names) + 0.6)
    ax.set_xticks(range(0, 101, 20))
    ax.set_xlabel("Share of posts (%)", color=MUTED, labelpad=8)
    ax.set_title(f"{title} (n = {total})", **TITLE_STYLE)
    ax.grid(axis="x", color=GRID, linewidth=0.8, zorder=0)
    ax.set_axisbelow(True)


def platform_panel(ax, rows):
    """Bars for the two main platforms, all other platforms together, and posts naming none."""
    named = [platform_names(row) for row in rows]
    names = list(MAIN_PLATFORMS.values()) + ["Another platform", "No platform named"]
    counts = [sum(1 for post in named if key in post) for key in MAIN_PLATFORMS]
    counts.append(sum(1 for post in named if any(name not in MAIN_PLATFORMS for name in post)))
    counts.append(sum(1 for post in named if not post))
    horizontal_bars(ax, names, counts, [TEAL, TEAL, TEAL, LIGHT_GREY], len(rows),
                    "Chatbot platforms named in posts")


def topic_panel(ax, rows):
    """Bars for the seven health topics, largest first, then suicide or self-harm."""
    counts = {topic: sum(int(row[topic]) for row in rows) for topic in HEALTH_TOPICS}
    order = sorted(counts, key=lambda topic: (-counts[topic], topic))
    names = order + [f"{CRISIS}\n(part of mental and emotional health)"]
    values = [counts[topic] for topic in order] + [sum(int(row[CRISIS]) for row in rows)]
    horizontal_bars(ax, names, values, [TEAL] * len(order) + [AMBER], len(rows),
                    "Health topics mentioned in posts")


def age_figure(rows, ages):
    """Bar chart of the number of posts per stated age."""
    span = range(min(ages), max(ages) + 1)
    fig, ax = plt.subplots(figsize=(6.4, 3.6), dpi=DPI)
    bars = ax.bar(list(span), [ages.get(age, 0) for age in span],
                  color=[TEAL if 13 <= age <= 17 else LIGHT_GREY for age in span], width=0.7, zorder=2)
    for bar, age in zip(bars, span):
        if ages.get(age, 0):
            ax.annotate(str(ages[age]), (bar.get_x() + bar.get_width() / 2, bar.get_height()), xytext=(0, 4),
                        textcoords="offset points", ha="center", va="bottom", fontsize=10.5, fontweight="bold",
                        color=INK)
    ax.set_xticks(list(span))
    ax.tick_params(axis="x", length=0, colors=INK, pad=6)
    ax.tick_params(axis="y", length=0, labelsize=9.5)
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.set_xlabel("Age stated by the author (years)", color=MUTED, labelpad=8)
    ax.set_ylabel("Number of posts", color=MUTED, labelpad=8)
    ax.set_ylim(0, max(ages.values()) + 3)
    ax.grid(axis="y", color=GRID, linewidth=0.8, zorder=0)
    ax.set_axisbelow(True)
    ax.set_title(f"Age stated in posts (n = {sum(ages.values())} of {len(rows)})", **TITLE_STYLE)
    ax.legend(handles=[Patch(color=TEAL, label="Age 13 to 17"), Patch(color=LIGHT_GREY, label="Other ages")],
              frameon=False, loc="upper right", fontsize=9.5, handlelength=1.2, handleheight=1.0)
    return fig


def save(fig, name):
    """Save a figure as PNG and close it."""
    path = FIGURES_DIR / name
    try:
        # Leaving out the software field keeps the file free of the matplotlib version number.
        fig.savefig(path, dpi=DPI, facecolor="white", bbox_inches="tight", pad_inches=0.12,
                    metadata={"Software": None})
    except OSError:
        sys.exit(f"Cannot write {path.name}. Close the file if it is open in another program.")
    plt.close(fig)
    print(f"Wrote {path.relative_to(ROOT).as_posix()}")


def main():
    if not LABELS_FILE.exists():
        sys.exit("results/post_labels.csv not found. Run code/analyze_posts.py first.")
    rows = read_table(LABELS_FILE, ["platforms", "stated_age", CRISIS] + HEALTH_TOPICS)
    usable = rows and all(row[column] in ("0", "1") for row in rows for column in [CRISIS] + HEALTH_TOPICS)
    if not usable:
        sys.exit("results/post_labels.csv is empty or has unexpected values. Run code/analyze_posts.py again.")
    FIGURES_DIR.mkdir(parents=True, exist_ok=True)

    fig, ax = plt.subplots(figsize=(6.4, 2.5), dpi=DPI)
    platform_panel(ax, rows)
    save(fig, "chatbot_platforms.png")

    fig, ax = plt.subplots(figsize=(6.4, 3.9), dpi=DPI)
    topic_panel(ax, rows)
    save(fig, "health_topics.png")

    ages = Counter(int(row["stated_age"]) for row in rows if row["stated_age"])
    if ages:
        save(age_figure(rows, ages), "stated_age.png")
    else:
        print("No post states an age, so stated_age.png was not drawn.")

    fig, (left, right) = plt.subplots(1, 2, figsize=(13.2, 3.9), dpi=DPI, gridspec_kw={"wspace": 0.72})
    platform_panel(left, rows)
    topic_panel(right, rows)
    for ax, letter in ((left, "a"), (right, "b")):
        ax.set_title(f"{letter}   {ax.get_title(loc='left')}", **TITLE_STYLE)
    save(fig, "platforms_and_health_topics.png")


if __name__ == "__main__":
    main()
