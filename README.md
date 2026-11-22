# Generative AI and adolescent health: dataset analysis and provenance toolkit

This repository holds two independent pieces of work on how adolescents use generative AI chatbots in connection with their health, and on how a research study can account for chatbot data that families donate to it.

| Folder | What it is | Where to start |
|---|---|---|
| [data_analysis](data_analysis/) | A descriptive analysis of Reddit posts (provided with the challenge) about generative AI and health written by teenagers and parents. The scripts count which chatbot platforms the posts name, which health topics they mention, and the ages the authors state. | [data_analysis/README.md](data_analysis/README.md) |
| [provenance_toolkit](provenance_toolkit/) | A data provenance toolkit for a hospital research study that receives adolescents' donated chatbot exports and links them to hospital visit records. It records where each file came from, what was made from it, who used it and under which consent, and what was deleted on withdrawal, and it lets the stored files and the activity log be checked with cryptographic hashes. | [provenance_toolkit/README.md](provenance_toolkit/README.md) |

## How the two relate

The dataset analysis describes the setting: which platforms adolescents and parents mention and which health topics come up when they write about generative AI. The provenance toolkit addresses a question that follows once such conversations are donated for research: how a family, a research team and an auditor can each see what happened to a donated file, and how the record of it can be verified.

## Running the provenance toolkit

The toolkit needs Python for the engine and the server, and Node.js to build the interface. The commands below are for macOS and Linux and are run from the repository folder. The Windows commands and the required versions are in [provenance_toolkit/README.md](provenance_toolkit/README.md).

```
cd provenance_toolkit
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd frontend
npm ci
npm run build
cd ..
python backend/server.py
```

The last command starts the server and prints its address. Open that address in a browser and choose a role. The folder provenance_toolkit/sample_data holds placeholder chat exports and hospital records to upload.

## Running the dataset analysis

The analysis needs Python, and matplotlib for the figures. The dataset file was provided with the challenge and is not included here. To run the scripts, place it at data_analysis/data/teen_ya_genai_health_final.csv. What each script writes is described in [data_analysis/README.md](data_analysis/README.md).

```
cd data_analysis
pip install matplotlib
python code/analyze_posts.py
python code/sensitivity_analysis.py
python code/make_figures.py
```
