# DedupManager — Setup & Usage

Two roles:
- **🛠️ The setter-upper** (one technical person) creates the shared sheet + backend **once** (~10 min).
- **🧑‍🤝‍🧑 Everyone else** joins by pasting one **invite code** into the extension (~1 min).

```
  SETTER-UPPER (once)                     TEAMMATES (each)
  ── deploy the sheet + backend           ── load the extension
  ── open dashboard → Settings            ── paste the invite code → Import
  ── copy the INVITE CODE  ─────────────► ── pick their name → done
```

---

## 🛠️ Part A — Set up for your team (one person, once)

### Requirements

| Need | Why | How to check |
|---|---|---|
| A **Google account** | Hosts the Sheet + the Apps Script backend | Can you open [sheets.new](https://sheets.new)? |
| **Node.js** installed | To run the one-command deploy (`clasp`) | `node --version` prints a version |
| **Google Chrome** | Runs the extension | `chrome://extensions` opens |
| ~10 minutes | One-time setup | — |

### Steps

```bash
# 1. Install Google's Apps Script CLI
npm i -g @google/clasp

# 2. Log in (opens your browser; authorize once)
clasp login

# 3. One-time: turn ON "Apps Script API"
#    → https://script.google.com/home/usersettings   (toggle it on)

# 4. From the project folder, deploy everything:
./deploy.sh
```

`./deploy.sh` will, in one shot: create a Google Sheet named **DedupManager DB**, attach the backend, deploy it as a web app, and print your **dashboard URL**.

5. **Open the dashboard URL once** (this initializes the sheet tabs).
6. Go to **Settings → Invite teammates** → set your team's names → **Copy invite code**.
7. Send that invite code to your teammates (Part B). Done. ✅

> **Is it secure?** The deployment is callable by URL, but every data call needs the team key that's baked into the invite code — so the URL alone is useless. Keep the invite code private to your team (treat it like a password).

> **Re-deploying later:** just run `./deploy.sh` again — the URL stays the same, so teammates never need to re-import. (If `clasp` ever says *"invalid_rapt" / unknown user*, run `clasp login` again.)

---

## 🧑‍🤝‍🧑 Part B — Join your team (each teammate, ~1 min)

You only need the **invite code** the setter-upper sent you.

1. Open `chrome://extensions` → turn on **Developer mode** (top-right).
2. Click **Load unpacked** → select the **`DedupOutreach/extension/`** subfolder, PLEASE NOTE TO SELECT SUBFOLDER, this is common mistake that folks have.
3. Click the **DedupManager** icon (pin it via the 🧩 menu) → **Connection settings** → paste the invite code into **"Paste team config"** → **Import config**.
4. Set **I am → your name**. Leave **Show on-page bar** and **Auto mode** on. **Done** — you're on the same shared sheet, no Google login needed.

---

## 🟢 Daily use

- **Browsing LinkedIn / X / Instagram / Reddit / GitHub / Gmail:** a bar sits bottom-right. It auto-detects the person and checks the sheet **live** — 🟢 *Not in CRM yet* or 🔴 *In CRM: name · owner · stage*. Click **Log / Merge**, verify the auto-filled fields, **Save**.
- **Anywhere else:** open the bar (or the dashboard's **Check & Add**), type a link / phone / email, and check + log manually.
- **See everyone:** dashboard **People** tab, or the extension popup → **Open Google Sheet** / **Open full dashboard**.
- **Manage stages / matching strictness / team:** dashboard **Settings** (syncs to everyone's extension within minutes).

### Extension toggles (in the popup)
- **Show on-page bar** — master switch (OFF = extension hidden everywhere).
- **Auto mode** — ON = auto-detect + auto-check as you browse · OFF = type & press **Check** yourself.

---

## ⚙️ Settings (dashboard)

| Setting | Notes |
|---|---|
| **Team members** | Names used for the invite code + the "I am" dropdown |
| **Stages** | Comma-separated pipeline; first is the default for new people |
| **Sources** | The channel list (LinkedIn, Email, Phone, WhatsApp, Slack…) |
| **Phone: ignore country code** | Compare the last 10 digits (default on) |
| **LinkedIn slug only / +tags / dots** | Normalization knobs for cleaner matching |
| **Fuzzy name + company** | Also flag the same name+company without a shared identifier |

---

## 🧪 Tests (optional, for developers)

```bash
node extension/matcher.test.js   # matching engine: normalization, dedup, fuzzy
node tests/upsert.test.js        # merge: blank-fill, owner preservation, custom columns
```

---

## 🩺 Troubleshooting

| Symptom | Fix |
|---|---|
| Popup says **"not synced yet"** / links missing | Not connected — paste the invite code in **Connection settings → Import**. |
| Bar never appears | Popup → turn **Show on-page bar** on; check it shows "N contacts · synced …". |
| `remove is not defined` / stale errors | Old script on an open tab — `chrome://extensions` → **↻ reload**, refresh the tab, **Clear all** errors. |
| Changed the extension code | Reload the extension **and refresh open tabs** (Chrome keeps the old script on already-open tabs). |
| `clasp` deploy says *invalid_rapt* | Run `clasp login` again, then `./deploy.sh`. |
| A scraped field is wrong | Just edit it in the bar before saving — extraction is best-effort by design. |
