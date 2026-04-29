# /full-backfill/ — Implementation Spec

A merged browser-only tool that ingests Sybill notification JSON exports
**and** slackdump v3+ exports, classifies/summarizes, and writes the
result into Airtable. Replaces the workflows of `/test/` (Sybill XLSX
classifier) and `/slack-backfill/` (slackdump XLSX summarizer) **without
removing either**. All three apps coexist.

This document is the contract for the build-out session. Once approved,
work executes in 6 phases, each with its own commit and verification gate.

---

## 1. Decisions captured during interview

| Topic | Decision | Notes |
|---|---|---|
| Coexistence | All three apps live | `/test/`, `/slack-backfill/`, `/full-backfill/` all build and deploy. No deletions. Vite multi-page input gains a third entry. |
| Airtable wipe policy | **Hard wipe per client table, then insert.** | For every client table the tool writes to, delete all existing rows first, then insert the freshly classified set. Manual edits in Airtable are lost; tool is the source of truth on each run. |
| Sybill cutoff | 365 days, hardcoded constant | `const SYBILL_CUTOFF_DAYS = 365` in `lib/cutoffs.js`. Messages older are dropped silently with a count surfaced in the UI. |
| Slack cutoff | **30 days**, hardcoded constant | `const SLACK_CUTOFF_DAYS = 30`. Updated from the 21-day default used in `/slack-backfill/`. Older day-buckets are loaded into the channel-matches view but not summarized or written to Airtable. |
| Channel mapping cache | Keyed by export fingerprint + folder name | localStorage shape: `{ exportId: { folderName: choice } }`. `exportId = sha1(sortedFolderNames.join('|'))`. Re-uploading the same export restores its mappings; different exports start clean. |
| Airtable shape | One table per client | Mirrors the existing per-sheet XLSX layout. Hard wipe is per-table. Adding a client = creating a table at runtime — see "Missing tables" below for what the tool actually does. |
| Cutoff configurability | Hardcoded constants | No Settings UI. Edit `lib/cutoffs.js` to change. |
| Partial AI failure | Save partial + "Retry failed" button | Successful summaries persist to localStorage. UI shows failure count and a button to re-run only the failed indices. Separate "Continue with partial" button writes what succeeded and leaves failed buckets out of Airtable. |
| Anthropic concurrency | 16 workers | Well below the Tier 3+ ceiling for 500-1000 buckets, leaves headroom on output-token-per-minute limits. Exponential backoff on 429/5xx, max 5 retries. |
| Airtable PAT handling | Hardcoded in source | User confirmed repo and Pages deploy are private. PAT lives in `lib/secrets.js` (gitignored — see "Secrets handling" below). |
| Anthropic key handling | Hardcoded in source (same file) | Same secrets file for parity. |
| Missing client tables | Halt and surface the list | Before any wipe, the tool reads the base schema. If any target client lacks a table, abort with a message: "These clients have no table: [...]. Create them in Airtable then rerun." Zero writes happen until every target table exists. |
| Crash recovery | Idempotent rerun via full-state checkpoint | All run state (parsed channels, mappings, AI summaries, Sybill assignments) is written to localStorage **before any Airtable mutation**. Rerun replays from checkpoint with fresh wipe. Tokens never re-spent unless the AI batch itself crashes mid-run, in which case the partial+retry flow handles it. |
| Sybill review UI | Keep the existing two-pane review | Reuse `src/components/ReviewPanel.jsx` and `src/lib/grouping.js` verbatim. Block Airtable writes until every uncertain group has an assignment (client / Internal / Skip). |
| Airtable schema | Mirror v2 XLSX exactly | Columns per client table: `Engagement Date` (date), `Type of Engagement` (single-select: `Meeting`, `Slack messages`), `Meeting Name` (text), `Attendees` (text), `Summary` (long text), `Action Items` (long text), `Slack Message` (long text). Tool halts if any client table is missing these columns by name. |

---

## 2. Secrets handling

Despite the user's "hardcode in source" instruction, **never commit
plaintext credentials**. The build-time hardcoding is achieved via a
gitignored secrets file:

```
full-backfill/
├── lib/
│   ├── secrets.template.js   ← committed; placeholder values
│   └── secrets.js            ← gitignored; real credentials, imported by app
```

Add `full-backfill/lib/secrets.js` to `.gitignore`. `secrets.template.js`:

```js
// Copy this file to secrets.js and fill in real values.
export const ANTHROPIC_API_KEY = 'sk-ant-...';
export const AIRTABLE_PAT = 'pat...';
export const AIRTABLE_BASE_ID = 'app...';
```

The app imports from `./lib/secrets.js`. If the file is missing, the
build fails with a clear error pointing at `secrets.template.js`. This
means:
- Public forks can't extract credentials (they don't exist in git).
- Locally and during private deploy, the build embeds the values.
- Rotation is a single-file edit.

If the user pushes back and insists on literal hardcoding, switch to
`import.meta.env.VITE_*` from `.env.local`. Same blast radius, more
boilerplate.

---

## 3. File layout

```
full-backfill/
├── SPEC.md                       ← this file
├── index.html
├── main.jsx
├── styles.css                    ← Tailwind import + bm-* theme tokens
├── App.jsx                       ← top-level state machine
├── components/
│   ├── SybillSourcePanel.jsx     ← Sybill JSON upload + parse
│   ├── SlackSourcePanel.jsx      ← slackdump ZIP/folder upload + parse
│   ├── SybillReview.jsx          ← thin wrapper around src/components/ReviewPanel.jsx
│   ├── ChannelMatchPanel.jsx     ← per-channel dropdown picker
│   ├── CostPreview.jsx           ← total/eligible/cost numbers
│   ├── RunPanel.jsx              ← AI summarization progress + retry
│   ├── AirtableWritePanel.jsx    ← preflight + wipe + write
│   └── Stat.jsx, Panel.jsx       ← shared layout primitives
├── lib/
│   ├── cutoffs.js                ← SYBILL_CUTOFF_DAYS, SLACK_CUTOFF_DAYS
│   ├── exportFingerprint.js      ← sha1 of sorted folder names
│   ├── secrets.template.js       ← committed placeholder
│   ├── secrets.js                ← gitignored
│   ├── airtable.js               ← Airtable REST client: list, schema, wipe, batch insert
│   ├── checkpoint.js             ← localStorage checkpoint reader/writer
│   └── pipeline.js               ← orchestrator: classify → review → summarize → write
└── test-pipeline.mjs             ← Node smoke test for the orchestrator
```

**Reused code (imported, not copied):**
- `../src/lib/parser.js` → `parseSybillMessages`
- `../src/lib/classifier.js` → `classifyMeeting`, `KNOWN_CLIENTS`
- `../src/lib/grouping.js` → `groupUncertain`
- `../src/components/ReviewPanel.jsx` → wrapped in `SybillReview.jsx`
- `../slack-backfill/lib/slackParser.js` → `parseSlackdumpZip`, `parseSlackdumpFolder`, `formatThreadBlock`, `buildPrompt`
- `../slack-backfill/lib/claude.js` → `callClaude`, `runWithConcurrency`, `MODELS`, `SYSTEM_PROMPT` (rebound to a higher concurrency cap)

Reusing imports across `src/` and `slack-backfill/` and `full-backfill/`
is a Vite pattern that already works because all three live in the same
project root. Adjust `vite.config.js` only to add the new HTML entry.

---

## 4. Phased commit plan

Each phase is a standalone commit. Verification gates: `npm run lint`
clean, `npm run build` succeeds with all three apps, `node
full-backfill/test-pipeline.mjs` passes (where applicable), all existing
smoke tests still pass.

### Phase 1: Scaffolding
**Commit:** `chore: scaffold /full-backfill/`

- Add `full-backfill/index.html`, `main.jsx`, `styles.css`, `App.jsx`
  with the bm-dark theme matching `/slack-backfill/`.
- Add `full-backfill/lib/secrets.template.js` and `.gitignore` line for
  `full-backfill/lib/secrets.js`.
- Add the third entry to `vite.config.js`:
  ```js
  fullBackfill: resolve(__dirname, 'full-backfill/index.html'),
  ```
- Update root `README.md` to mention the third tool.
- App.jsx renders an empty page with header, footer, and a placeholder
  "coming online" stub. No functional logic yet.

**Verification:** lint clean, `npm run build` produces
`dist/full-backfill/index.html` alongside the existing two, root README
updated.

### Phase 2: Dual source ingest
**Commit:** `feat: dual source ingest with cutoffs`

- `lib/cutoffs.js` with `SYBILL_CUTOFF_DAYS = 365`, `SLACK_CUTOFF_DAYS =
  30`, helper `cutoffDateStr(days)`.
- `components/SybillSourcePanel.jsx`: file drop zone (reuse pattern from
  `src/components/FileDropZone.jsx`), parses with
  `parseSybillMessages`, applies the 365-day cutoff, surfaces parsed
  count + dropped-by-cutoff count.
- `components/SlackSourcePanel.jsx`: ZIP + folder pickers (reuse from
  `slack-backfill/App.jsx`), parses with `parseSlackdumpZip` /
  `parseSlackdumpFolder`, applies the 30-day cutoff.
- `App.jsx`: top-level state holds `{ sybillMeetings, slackParsed,
  cutoffStats }`.
- No classification, no Airtable, no AI yet.

**Verification:** lint, build. New smoke test
`full-backfill/test-pipeline.mjs` covers cutoff filtering for both
sources using mock fixtures.

### Phase 3: Sybill classification + review
**Commit:** `feat: sybill classification + review reuse`

- New phase in `App.jsx`: after Sybill parse, run `classifyMeeting` over
  every meeting. Auto-classified meetings populate `assigned`. Uncertain
  meetings go through `groupUncertain`.
- `components/SybillReview.jsx` thin-wraps the existing
  `ReviewPanel.jsx`. Optional AI suggestions via `classifyGroups` from
  `src/lib/ai.js`, gated on hardcoded Anthropic key from secrets.
- Output of this phase: `sybillRows` array — one row per assigned
  meeting, with the v2 schema fields populated.
- The Sybill flow is unblocked from Slack: user can review while Slack
  data parses in the background.

**Verification:** lint, build, smoke tests for grouping + classifier
unchanged (they live in `src/`).

### Phase 4: Slack channel-mapping picker with fingerprinted cache
**Commit:** `feat: slack channel mapper with fingerprinted cache`

- `lib/exportFingerprint.js`: sha1 of `[...folderNames].sort().join('|')`.
  Use Web Crypto's `crypto.subtle.digest`.
- `components/ChannelMatchPanel.jsx`: per-channel dropdown lifted from
  `slack-backfill/App.jsx`. Options: `Pick one...`, `Unmatched`, every
  client name from `KNOWN_CLIENTS`, `Create new sheet: <folder>` (sheet
  here means Airtable table).
- localStorage shape: `{ exportId: { folderName: choice } }`. Hydrate on
  mount; persist on every choice change.
- "Continue" button gated on every channel having a non-empty choice.
- Output of this phase: `slackAssignments` — one entry per day-bucket
  with `{ targetClient, channelName, date, bucket }`.

**Verification:** lint, build. Smoke test: fingerprint stability across
identical inputs, cache scoping (same fingerprint loads, different
fingerprint stays empty).

### Phase 5: Airtable wipe-and-rewrite with checkpointing
**Commit:** `feat: airtable wipe-and-rewrite with checkpointing`

- `lib/airtable.js`: thin client around the Airtable REST API.
  - `getBaseSchema(baseId, pat)` → list of tables + their fields.
  - `wipeTable(baseId, tableName, pat)` → delete all records, batched at
    10 per request.
  - `insertRecords(baseId, tableName, rows, pat)` → batched 10 per
    request.
  - Rate limit: ≤5 req/sec/base. Implementation: a single shared token
    bucket (refill 5 tokens/sec). All requests wait on it. On 429 retry
    with exponential backoff up to 5 attempts.
- `lib/checkpoint.js`: `saveCheckpoint(state)` and `loadCheckpoint()`
  using key `full-backfill:checkpoint-v1`. Stores parsed channels,
  mappings, sybillRows, slackSummaries.
- `components/AirtableWritePanel.jsx`:
  1. Preflight: read base schema, list missing client tables, halt with
     surfaced list if any are missing.
  2. Show "About to wipe N tables, insert M rows" confirmation.
  3. Save checkpoint.
  4. Per client table: wipe, then insert. Display per-table progress.
  5. On any failure mid-write: keep checkpoint; user can rerun the
     phase, which restarts from the checkpointed state with a fresh
     wipe.
  6. On success: clear checkpoint.
- Hardcoded `AIRTABLE_BASE_ID` and `AIRTABLE_PAT` from
  `lib/secrets.js`.

**Verification:** lint, build. Smoke test mocks the Airtable client and
asserts: rate limit holds, halt-on-missing-table, wipe-then-insert
order, checkpoint roundtrip.

### Phase 6: AI Slack summarization wired into the write
**Commit:** `feat: slack ai summaries + write to airtable`

- `components/CostPreview.jsx` + `components/RunPanel.jsx` lifted from
  `slack-backfill/App.jsx`. Concurrency raised from 8 to 16. Default
  model Haiku 4.5.
- Cost preview shows: total day buckets, eligible (within 30-day
  cutoff), estimated input tokens, dollar estimates for Haiku 4.5 and
  Sonnet 4.6. User confirms before any API calls.
- Run produces `slackSummaries[bucketIdx] = { summary | error }`.
  Failures populate a `Retry failed` button.
- "Continue with partial" writes whatever succeeded; failed buckets are
  skipped from Airtable. Both options checkpoint.
- After run completes: rows from `sybillRows` and `slackRows` (built
  from `slackAssignments` + `slackSummaries` + threadText from
  `formatThreadBlock`) are merged per client and handed to the Airtable
  write panel.

**Verification:** lint, build, smoke test that exercises the full
pipeline against an Airtable mock: parse fixture, classify, summarize
(stubbed Claude), wipe-and-write, assert per-table row counts.

---

## 5. State machine in App.jsx

```
upload-sybill ──► sybill-classify ──► sybill-review (optional) ─┐
                                                                 ├──► merge ──► cost-preview ──► api-confirm ──► run ──► airtable-preflight ──► airtable-write ──► done
upload-slack ──► slack-channel-map ─────────────────────────────┘
```

Both upload branches run in parallel. Merge waits on both. Airtable
preflight halts the flow if tables are missing.

---

## 6. Reused code map

| Need | Source | Notes |
|---|---|---|
| Parse Sybill JSON | `src/lib/parser.js` | No changes |
| Classify meeting | `src/lib/classifier.js` | No changes |
| Group uncertain | `src/lib/grouping.js` | No changes |
| Review UI | `src/components/ReviewPanel.jsx` | Wrap, don't fork |
| AI classification (Sybill) | `src/lib/ai.js` | Pass Anthropic key from secrets, not settings |
| Parse slackdump | `slack-backfill/lib/slackParser.js` | No changes |
| Claude API client | `slack-backfill/lib/claude.js` | Concurrency knob raised to 16 |
| Format thread block | `slack-backfill/lib/slackParser.js` | No changes |
| XLSX builder | `slack-backfill/lib/xlsxBuilder.js` | **Not reused** — Airtable replaces XLSX |
| FileDropZone | `src/components/FileDropZone.jsx` | Reuse for Sybill panel |

---

## 7. Risks and open items left for execution session

1. **Airtable's table-creation API.** Phase 5 halts on missing tables.
   If the user later wants auto-create, that's a follow-up. The
   Airtable PAT must already have `schema:bases:read` scope or the
   preflight fails — surface that error clearly.
2. **`anthropic-dangerous-direct-browser-access` header.** Already in
   use in `/slack-backfill/`. Carries forward.
3. **One table per client** caps the tool at Airtable's ~1000-table
   limit per base. Not a concern at current scale (<50 clients).
4. **Single base assumption.** `AIRTABLE_BASE_ID` is one constant. If
   the engagement log spans multiple bases, this needs to become a
   per-client mapping.
5. **Time zones.** Cutoffs are computed in UTC. Sybill messages and
   Slack `ts` are both UTC-based. Should be fine but worth a
   double-check during execution.
6. **The Sybill `classifyGroups` AI call** uses Sonnet 4.6 today. Not
   touched in this rewrite. The Slack summarization concurrency knob
   doesn't apply to it (it's serial per-group already). If the user
   wants both speedups, that's a follow-up.
7. **Checkpoint expiry.** localStorage checkpoints have no TTL. Stale
   checkpoints from old runs could confuse the resume UI. Add a
   timestamp + 7-day expiry on read.

---

## 8. Verification gates per commit

After every phase commit:

```bash
npm run lint                      # clean
npm run build                     # all three apps build
node slack-backfill/test-mock.mjs # existing smoke tests pass
node slack-backfill/test-xlsx.mjs # existing smoke tests pass
node full-backfill/test-pipeline.mjs # phase-specific smoke tests pass (when applicable)
```

If any gate fails, the commit doesn't go out. Each commit is a deploy
candidate; main always builds.
