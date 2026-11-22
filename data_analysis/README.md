# Dataset analysis

Descriptive analysis of Reddit posts about generative AI and health, written by teenagers and parents. The scripts count which chatbot platforms the posts name, which health topics they mention, and the ages the authors state.

## Structure

| Path | Description |
|---|---|
| code/common.py | File paths, names and file helpers used by the other scripts. |
| code/analyze_posts.py | Labels each post and computes the summary. |
| code/sensitivity_analysis.py | Recounts the topics under stricter matching rules. |
| code/make_figures.py | Draws the figures from the labels. |
| results/summary.md | Counts and shares. |
| results/sensitivity.md | Topic counts under stricter rules, and the number of posts each keyword accounts for. |
| results/figures/ | Figures for platforms, health topics and stated age. |

## Data

The dataset is not included in this repository. It consists of 361 Reddit posts collected by Boston Children's Hospital from teen-focused and parenting subreddits, dated January 2023 to July 2026 and filtered for mentions of generative AI and of health topics. A row is one post. The file has no author column, so one person may have written several posts.

To run the scripts, place the file at:

```
data/teen_ya_genai_health_final.csv
```

The file needs the columns id, date, subreddit, group, platforms, title and selftext.

## Requirements

Python 3. Tested with Python 3.12. make_figures.py needs matplotlib (tested with 3.9). The other scripts use the standard library only.

## Usage

```
python code/analyze_posts.py
python code/sensitivity_analysis.py
python code/make_figures.py
```

| Script | Writes |
|---|---|
| analyze_posts.py | results/post_labels.csv (one row of labels per post) and results/summary.md |
| sensitivity_analysis.py | results/sensitivity.md |
| make_figures.py | results/figures/*.png, read from results/post_labels.csv |

make_figures.py has to run after analyze_posts.py. The text and CSV outputs are the same on every system. The figures are identical pixel for pixel only with the same matplotlib version and fonts.

## Method

**Platforms.** Taken from the platforms column of the dataset as provided. A post that names two platforms counts toward both.

**Health topics.** Seven health areas are used: mental and emotional health, sexual and reproductive health, skin and appearance, body image and eating, fitness and nutrition, physical symptoms and medical care, and substances. Each has a list of keywords, given in section 5 of results/summary.md. A post counts toward a topic if its title or body contains at least one keyword as a whole word. A post can count toward several topics. A count shows that the topic is mentioned in the post. It does not show that the topic is the main subject.

**Suicide or self-harm.** Counted with its own keyword list. The count includes mentions about another person and statements such as "I am not suicidal". Every keyword in this list is also in the mental and emotional health list.

**Age.** A post has a stated age if the author writes their own age in the first person, for example "I'm 15", "I'm 17m" or "I (15M)". Ages 10 to 24 are accepted. An age that follows a word such as "until" or "when" is skipped, and so is a number followed by a unit, as in "I'm 20 minutes late". The rule is strict and misses some statements, for example an age written as a word.

**Shares.** Each share is a count divided by all posts in the file. The age table is the exception: its base is the posts that state an age.

**Sensitivity analysis.** For each topic the posts are recounted under two stricter rules: the post must contain at least two different keywords of the topic, and the keyword on which the most posts rest alone is removed. For mental and emotional health, posts that contain a clinical term, such as depression, anxiety or therapy, are separated from posts that contain only words for everyday feelings, such as lonely or stressed. These counts show how the results change under these specific rules. They are not bounds.

## Limitations

1. The topic labels come from keyword matching and were not checked against human annotation. The topic shares are approximate, and their error is not measured.
2. Mental and emotional health is defined broadly and includes posts that mention loneliness, sadness, stress, crying, venting, coping or addiction.
3. The dataset was built with a health keyword filter, so the topic shares partly reflect how the keyword lists overlap with that filter.
4. The posts describe chatbot use. They are not chat logs.
5. The posts come from a small number of subreddits. The shares describe this set of posts and are not rates for teenagers in general.
6. Most posts do not state an age. The age results describe only those that do.
7. The last year in the dataset is partial, so the posts per year do not show a trend.
