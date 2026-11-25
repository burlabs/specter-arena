# Judge access

Specters of the Abyss is a Kiro Crew app. It runs inside a Kiro Crew installation, so there is no hosted web address to open. This page says how to run the real app, what is supplementary, and what never appears in this repository.

## The real app (default and only supported path)

1. Install Kiro Crew 0.13.1 or later on macOS or Linux. The tested host is 0.13.1; the manifest minimum is 0.12.0 (`app.json` `minKiroCrewVersion`).
2. Download the release artifact and its checksum from the GitHub Release page for the tagged commit, named on the Release page and, once published, in `docs/release/release-record.md`.
3. Follow `docs/release/install.md` from "Verify and extract" to "Check it works".
4. You need at least one Crew bot for a populated roster, network access to PyPI on first enable.

This is the same artifact the maintainer tested, identified by the commit and sha256 in the release record.

## What a working run shows

A roster of the bots you pick, a named Specter for each bot once you assign one (the app walks you through it, or randomizes), a showcase of the 11 heroes, tasks the app observes and closes by itself, XP credited automatically when a task ends cleanly, a read-only arena with an evidence inspector, and a Data tab. XP reflects observed activity; nobody accepts anything. "Open Bots in Crew" opens the Bots page; Crew has no route for an app to open one bot's chat or an approval.

## Supplementary material (not the app)

- A FIXTURE preview of the interface may be shown in the demo or linked from the submission. It runs on built-in sample data, is labelled FIXTURE on screen, and is never the live app.
- Prerecorded footage in the demo is labelled as prerecorded.

## Hosted demo Crew

Not offered. If the maintainer sets one up it must be a separate Crew installation (fresh operating-system user or virtual machine) with harmless bots and work only. Its address and any login go only in the private field of the submission form, never in this repository or its releases.

## Credentials

This repository and its releases contain no credentials. Judge-only instructions, if any, are in the private submission field.

## Eligibility

Whether this arrangement satisfies the rules' working-app requirement is the organizers' decision, not a guarantee.
