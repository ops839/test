# Sybill Slack JSON → XLSX Classifier

Browser-based web app that parses Sybill meeting summaries from Slack export JSON files,
classifies each meeting to a client, and exports a single XLSX file with one sheet per client.

100% client-side. No backend, no OAuth, no API calls, no LLMs. Built for **Blu Mountain RevOps**.

## How it works

1. **Drop JSON files.** The app only processes messages whose `blocks` contain a block with
   `block_id` starting with `outcome$$` (the Sybill Magic Summary format).
2. **Parse each message.** Extracts meeting title, outcome summary, action items, attendees,
   and date. HTML entities are decoded before classification.
3. **Classify deterministically** (stop at first match):
   1. Title contains a known client name (case-insensitive substring). *Exception:* if
      `Infinite Renewals` appears alongside another known client, the other client wins.
   2. Any attendee's email domain matches the domain-to-client map.
   3. Any attendee has a business email (not `blumountain.me`, not a personal domain)
      but nothing matched → **uncertain**, surfaced in the review UI.
   4. All attendees are BM or personal domains → **internal**, skipped.
4. **Review uncertain meetings.** Per-row dropdown (32 clients + Internal + Skip), checkboxes
   for multi-select bulk skip, "Confirm All" to finalize. Anything left undecided is skipped.
5. **Download XLSX.** One sheet per client (sheet name truncated to Excel's 31-char limit),
   columns `Meeting Date | Meeting Name | Attendees | Summary | Action Items`, rows sorted by
   date descending.

## Personal email domains treated as internal

`gmail`, `googlemail`, `yahoo`, `ymail`, `hotmail`, `outlook`, `live`, `msn`, `icloud`, `me`,
`protonmail`, `aol`.

## Running locally

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## Companion tool: Slack Backfill

A second browser-only tool lives at [`slack-backfill/`](slack-backfill/) and is
served at `/slack-backfill/` once deployed. It ingests a slackdump v3+ ZIP,
generates Claude AI summaries of daily Slack channel activity, and appends rows
to an existing client engagement log XLSX. The Anthropic API key is held in
memory only, never written to localStorage.

## Deployment

GitHub Actions publishes the production build to GitHub Pages on push to `main`.

## Tech stack

- React + Vite
- Tailwind CSS
- SheetJS (`xlsx`) for XLSX generation
- All processing runs in your browser. Files never leave your machine.
