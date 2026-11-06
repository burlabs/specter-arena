---
inclusion: always
---

# Product

Specter Arena is a Kiro Crew app built for Kiroween 2026. It turns the work a user's agents do into a small cooperative game: each agent is represented by a Specter, and real, human-accepted outcomes drive progress.

Product rules that hold from the first session:

- Progress comes from recorded facts. A Crew tool approval is not acceptance; a draft PR, a CI result, a merge, and a human acceptance are separate facts.
- Fixtures never stand in for live data. The preview harness is labelled FIXTURE and is never shipped in the production bundle.
- Unknown progress stays indeterminate. The UI does not invent percentages.

FP-00 contains no gameplay. The UI is a stub shell and the backend answers only `/health`.
