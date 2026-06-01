# DedupManager — Design Spec

**Date:** 2026-06-01
**Status:** Approved for planning

## 1. Problem & Goals

A 3-person team does cold outreach across LinkedIn, email, and Reddit. The pain:
two people unknowingly approach the same person. We want a shared, always-on
dedup ledger that:

- Surfaces a warning when someone we're about to contact has already been
  approached (by whom, when, via which channel, current status).
- Works **where we already are** — auto-detecting the person on LinkedIn /
  Reddit / Gmail and running dedup continuously while browsing ("active mode").
- Auto-extracts the contact's details when adding, which we **verify/edit before
  committing** (never saved silently).
- Lets us search the whole history back.
- Has a **tweakable matching engine** so we can dial dedup strictness up/down
  without code changes.
- Costs $0, runs on no servers, and keeps the raw data in a Google Sheet we can
  open anytime.

### Non-goals (v1)
- Not a CRM. No pipeline management, no email sending, no auto-sync from
  inboxes/LinkedIn.
- No verified/tamper-proof identity (trusted 3-person team; honor-system
  attribution is acceptable).
- No audit trail beyond the append-only log.

## 2. Architecture

```
   ┌─────────────────────────────────────────────────────────┐
   │  Chrome Extension  (primary surface)                     │
   │                                                          │
   │  content scripts: linkedin.com / reddit.com / mail.google.com
   │     ├─ extract identifier + name + company from page     │
   │     ├─ run matcher LOCALLY against synced log → badge    │
   │     └─ "Add" → prefilled, editable confirm popup         │
   │                                                          │
   │  shared matching engine  (normalize + matches)           │
   │  local cache of log + settings (refreshed every few min) │
   │  identity: locally-chosen teammate name                  │
   └───────────────┬──────────────────────────────────────────┘
                   │ HTTPS (append / update / read), shared API key
                   ▼
   ┌─────────────────────────────────────────────────────────┐
   │  Google Apps Script Web App  (script.google.com/.../exec)│
   │   doGet  → read log, read settings                       │
   │   doPost → append row, update status                     │
   │   serves the Web UI (search / manual add / settings / stats)
   └───────────────┬──────────────────────────────────────────┘
                   ▼
   ┌─────────────────────────────────────────────────────────┐
   │  Google Sheet  (source of truth)                         │
   │   Contacts tab  ·  Settings tab                          │
   └─────────────────────────────────────────────────────────┘
```

Two clients (extension + web UI) over one thin Apps Script API over one Sheet.
The **matching engine** is duplicated as identical logic in the extension (JS)
and the web app (Apps Script `.gs`), both driven by the same Settings values, so
strictness is consistent everywhere.

## 3. Data Model

### `Contacts` tab (append-only — one row per outreach attempt)
The same person legitimately appears more than once; that *is* the duplicate we
want surfaced, with the full timeline.

| Column          | Source     | Notes                                          |
|-----------------|------------|------------------------------------------------|
| `id`            | auto       | unique row id                                  |
| `added_by`      | extension  | locally-chosen teammate name                   |
| `added_at`      | auto       | ISO timestamp                                  |
| `source`        | detected   | `linkedin` / `email` / `reddit` / `other`      |
| `identifier`    | extracted  | raw value pasted/scraped (URL, email, u/handle)|
| `id_normalized` | computed   | what the matcher compares on                   |
| `name`          | extracted  | optional, editable                             |
| `company`       | extracted  | optional, editable                             |
| `status`        | user       | `sent` / `replied` / `no-reply` (editable)     |
| `notes`         | user       | free text, optional                            |

### `Settings` tab (the robustness knobs — key/value)
| Key                       | Default | Meaning                                            |
|---------------------------|---------|----------------------------------------------------|
| `email_lowercase`         | on      | lowercase emails before compare                    |
| `email_strip_plus`        | on      | drop `+tag` in local part                          |
| `email_ignore_dots`       | off     | ignore `.` in local part (Gmail-style)             |
| `linkedin_slug_only`      | on      | reduce to `/in/<slug>`; strip proto/www/query/slash|
| `reddit_strip_prefix`     | on      | strip `u/`, `/user/`, lowercase                     |
| `fuzzy_name_company`      | off     | also warn on same name + company (no shared id)    |
| `fuzzy_threshold`         | 0.85    | similarity cutoff when fuzzy is on (exact→loose)   |
| `match_logic`             | any     | warn if **any** identifier matches (vs stricter)   |

## 4. Matching Engine

Two pure functions, settings-driven, shared in spirit by both clients:

- `normalize(source, identifier, settings) -> id_normalized`
  Channel-specific canonicalization per the Settings knobs above.
- `matches(candidate, logEntry, settings) -> {hit: bool, reason}`
  Primary: exact match on `id_normalized`. Optional secondary: fuzzy
  name+company similarity ≥ `fuzzy_threshold` when `fuzzy_name_company` is on.

A duplicate **warns**, never blocks — the user decides whether to proceed and
log anyway. Centralizing here means the extension and web app (and a future
deeper integration) all inherit the same tweakable robustness.

## 5. Extension Behavior

- **Content scripts** on `linkedin.com`, `reddit.com`, `mail.google.com`.
  On profile / user / thread view (incl. SPA route changes) → extract
  `identifier`, `name`, `company`, infer `source`.
- **Active mode** (toggleable): on every detected person, run `matches` against
  the **local synced log** and render a passive on-page badge:
  - 🟢 "not approached"
  - 🔴 "<name> · <source> · <date> · <status>" (one line per prior approach)
- **Add flow**: clicking Add opens a popup **pre-filled** with extracted fields,
  fully editable; on confirm, POST to the API with `added_by` = local name.
- **Manual mode**: a "log a contact" form for any site/channel, plus a global
  active-mode on/off switch.
- **Identity**: on install, teammate picks their name from a list; stored in
  extension local storage; sent on every write.
- **Sync**: pulls full log + settings on a timer (e.g. every 3–5 min) and on
  demand after a write, so local dedup is instant and backend calls are minimal.
- **Resilience**: if a selector fails, the extracted field is left blank for the
  user to fill in the confirm popup — degrades to manual, never breaks.

## 6. Web App (secondary surface, served by Apps Script)

- **Search**: one box queries the whole log by email / URL / handle / name /
  company (uses `normalize` so search is dedup-aware).
- **Manual add**: same confirm form as the extension.
- **Settings**: edit the robustness knobs; writes to the `Settings` tab; both
  clients pick up changes on next sync.
- **Stats**: total approached, by person, by source, by week, and a
  duplicate-collision count ("double-touches prevented").

## 7. Backend API (Apps Script)

- `doGet({action: 'log'})` → all contacts (for sync/search).
- `doGet({action: 'settings'})` → settings map.
- `doPost({action: 'add', ...row})` → append row (server stamps `id`,
  `added_at`, computes `id_normalized`).
- `doPost({action: 'update', id, status|notes})` → edit a row.
- `doPost({action: 'settings', ...})` → write settings.

## 8. Security

- Apps Script deployed "execute as me / accessible to anyone with the URL."
- A **shared team API key** (random token) is required on every request; stored
  in the extension and web UI config. Keeps random traffic out; sufficient for a
  private 3-person tool.
- `added_by` is the locally-chosen name (honor system, by design).
- A `LockService` lock guards append/update to avoid Sheet write races.

## 9. Risks & Mitigations

- **DOM brittleness** (LinkedIn/Reddit/Gmail change layouts): resilient
  selectors + always-available manual edit in the confirm popup → degrades to
  manual entry, not breakage.
- **Apps Script quotas**: generous for 3 users + minimal writes; local-cache
  design keeps backend calls low.
- **Honor-system attribution**: accepted trade-off for zero-setup identity.

## 10. Phasing

- **Phase 1 (this spec):** Sheet + Apps Script API + matching engine + web app
  (search / manual add / settings / stats).
- **Phase 2:** Chrome extension (active mode, auto-extract, badge) against the
  same API.

Phases share the matching engine and API; nothing in Phase 1 is throwaway.
