# DedupManager — Setup & Usage

**One person creates the shared sheet (10 min). Everyone else joins by pasting a
single invite code into the extension (1 min).** That's the whole model:

```
   HOST                                   TEAMMATES (×2)
   ── creates the Google Sheet + app  ──►  ── load extension
   ── opens dashboard → Settings           ── paste invite code → Import
   ── copies the INVITE CODE  ───────────► ── pick their name → done
```

The Google Sheet is the shared database; the dashboard and the extension are two
front-ends that read/write it. Teammates need **no Google login** — the invite
code carries the app URL + a shared key + the team names.

---

## A. Host — set up a brand-new shared sheet (once)

### Fast path: `./deploy.sh`

```bash
npm i -g @google/clasp     # Google's Apps Script CLI
clasp login                # opens your browser; authorize once
# one-time: turn ON "Apps Script API" at
#   https://script.google.com/home/usersettings
./deploy.sh                # creates the Sheet + script, pushes, deploys
```

`deploy.sh` generates a random team key (into gitignored `apps-script/Config.gs`),
creates a new Google Sheet (named **DedupManager DB**) with a bound script,
deploys it as a public-URL web app **running as you**, pins a **stable URL**
(re-running after edits keeps it), and prints the **dashboard URL**.

Then:
1. **Open the dashboard URL once** (initializes the Sheet tabs).
2. Go to **Settings → Invite teammates**. Set the **Team members** names, then
   **Copy invite code**.
3. Send that code to your teammates (Part B).

> "Access: anyone" is safe — every data call needs the API key in the invite
> code; the dashboard *page* alone is useless without it.

### Manual path (no clasp / Node)

1. [sheets.new](https://sheets.new) → name it → **Extensions → Apps Script**.
2. Recreate two files: `Code.gs` ← `apps-script/Code.gs`, and
   `Index.html` (➕ New → HTML) ← `apps-script/Index.html`.
3. Add `Config.gs` (➕ New → Script) with `var TEAM_API_KEY = '<long random>';`
   (see `apps-script/Config.example.gs`).
4. **Deploy → New deployment → Web app** → *Execute as:* **Me**,
   *Who has access:* **Anyone** → **Deploy**, then open the `/exec` URL once.
5. In the dashboard: **Settings → Invite teammates → Copy invite code**.

> Redeploying manually: **Deploy → Manage deployments → edit → Version: New
> version**, else the old code keeps serving.

---

## B. Teammates — join an existing sheet (each person, 1 min)

You only need the **invite code** the host sent you.

1. `chrome://extensions` → turn on **Developer mode** (top-right) →
   **Load unpacked** → select the `extension/` folder.
2. Click the **DedupManager** icon → **Connection settings** →
   paste the invite code into **"Paste team config"** → **Import config**.
   (Sets the sheet URL, key, and team names in one shot.)
3. Pick **I am → your name**. Leave **Show on-page bar** on. Done — you're on the
   same shared sheet.

> No invite code? Ask the host to open the dashboard → **Settings → Invite
> teammates → Copy invite code**.

---

## Extension modes (popup toggles)

- **Show on-page bar** — master switch. OFF = the extension is hidden everywhere.
  ON = the bar is always visible bottom-right.
- **Auto mode** (when bar is on) — ON = auto-detect the person + auto-check as you
  browse LinkedIn / X / Instagram / Reddit / GitHub / Gmail. OFF = you type the
  link / phone / email yourself and press **Check**.
- The bar logs & checks in both modes; collapse it with the **–** button.

---

## The data model (one row per person)

Each person is **one row** with managed columns:
`id, name, company, phone, linkedin, email, reddit, status, added_by, added_at,
updated_at, updated_by, notes`.

You can reach a person by phone, LinkedIn, **or** email — each is matched
independently, so any single shared identifier links to the same record.

### Add your own CRM columns
Add any columns you like in the Sheet (e.g. `stage_detail`, `call_date`,
`insight`, `next_step`). The app **never reorders or overwrites them** — it only
writes the managed columns above. Your columns show **read-only** in the
dashboard's **People** tab (amber headers); edit them directly in the Sheet.

### How merging works (important)
On save the app **upserts**: if the person already exists under any identifier,
it merges — filling blank identifiers, updating status, appending notes, keeping
the original `added_by` and recording `updated_by`. Two records merge **only when
they share an identifier** (or **Fuzzy name + company** is on). Log someone by
LinkedIn and a teammate has only their email? They stay separate until a shared
identifier links them — or turn on fuzzy matching to also merge on name+company.

## Daily use

- **On LinkedIn / Reddit / Gmail**: a badge appears bottom-right —
  🟢 *not in CRM* or 🔴 *already in CRM (owner · matched-on · stage)*. Click
  **Log this person / View · update record**, verify the prefilled fields, set a
  **stage**, **Save** (merges if they exist).
- **Anywhere else**: open the dashboard → **Check & Add**, fill name / phone /
  LinkedIn / email, **Check for duplicates**, then **Save**.
- **Browse / search people**: dashboard → **People** tab (shows custom columns too).
- **Tune strictness & stages**: dashboard → **Settings** (syncs to everyone's
  extension within a few minutes).

## Tuning (Settings tab)

| Setting | Notes |
|---|---|
| Stages | comma-separated; first is the default for new people |
| Phone: ignore country code | compare last 10 digits (default on) |
| Ignore `+tags` in email | `you+lead@x.com` → `you@x.com` |
| Ignore dots in email | Gmail-style `j.a.ne@gmail` → `jane@gmail` |
| LinkedIn slug only | match `/in/<slug>`, ignore url params (default on) |
| Normalize Reddit handles | strip `u/`, `/user/`, lowercase (default on) |
| Fuzzy name + company | also merge same name+company without a shared identifier |
| Fuzzy threshold | lower = looser, higher = stricter |

## Tests

```bash
node extension/matcher.test.js   # matching engine: normalization, multi-identifier match, fuzzy
node tests/upsert.test.js  # merge: blank-fill, owner preservation, custom-column survival
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `clasp push` mentions the API | Enable it once: https://script.google.com/home/usersettings |
| `Not logged in to clasp` | Run `clasp login`. |
| Badge says "set your name" | Open popup → pick your name. |
| Badge never appears | Popup should show "synced N contacts"; re-import config; toggle Active mode. |
| "unauthorized" on save | Extension key ≠ `TEAM_API_KEY` in `Config.gs`; re-import the latest config. |
| A scraped name/company is wrong | Edit it in the confirm card before saving — extraction is best-effort by design. |
| Want a fresh deployment URL | Delete `.deployment-id` and re-run `./deploy.sh`. |
