#!/usr/bin/env bash
#
# DedupManager — one-command backend deploy via clasp.
#
# First time:
#   npm i -g @google/clasp        # install clasp
#   clasp login                    # opens your browser, authorize once
#   # enable the Apps Script API once: https://script.google.com/home/usersettings
#   ./deploy.sh                    # creates the Sheet + script, pushes, deploys
#
# Re-deploy after code changes:
#   ./deploy.sh                    # pushes a NEW version + prints the URL again
#
set -euo pipefail
cd "$(dirname "$0")"

APPDIR="apps-script"
CONFIG="$APPDIR/Config.gs"
MANIFEST="$APPDIR/appsscript.json"

say()  { printf '\033[1;34m▸ %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ── 0. Prereqs ──────────────────────────────────────────────────────────────
command -v clasp   >/dev/null || die "clasp not found. Run:  npm i -g @google/clasp"
command -v openssl >/dev/null || die "openssl not found (needed to generate the team key)."
[ -f "$HOME/.clasprc.json" ] || die "Not logged in to clasp. Run:  clasp login"

# ── 1. Team secret (gitignored, generated once) ─────────────────────────────
if [ ! -f "$CONFIG" ]; then
  KEY="$(openssl rand -hex 24)"
  cat > "$CONFIG" <<EOF
// AUTO-GENERATED team secret — gitignored. Do not commit. Do not post publicly.
var TEAM_API_KEY = '$KEY';
EOF
  say "Generated a new team API key → $CONFIG"
fi
KEY="$(sed -n "s/.*TEAM_API_KEY = '\\([^']*\\)'.*/\\1/p" "$CONFIG" | head -1)"
[ -n "$KEY" ] || die "Could not read TEAM_API_KEY from $CONFIG"

# ── 2. Create the bound Sheet + script on first run ─────────────────────────
# (Done before writing our manifest — clasp create can object to a pre-existing
#  appsscript.json in the root dir.)
if [ ! -f ".clasp.json" ]; then
  say "Creating a new Google Sheet + bound Apps Script project…"
  clasp create --type sheets --title "DedupManager DB" --rootDir "$APPDIR"
fi

# ── 3. Web app manifest (gitignored, generated) ─────────────────────────────
# Configures the deployment as a public-URL web app that runs as you, so the
# deploy below needs no manual click-through in the Apps Script dialog.
cat > "$MANIFEST" <<'EOF'
{
  "timeZone": "Etc/GMT",
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE_ANONYMOUS"
  }
}
EOF

# ── 4. Push code ────────────────────────────────────────────────────────────
say "Pushing code…"
clasp push -f || die "Push failed. If it mentions the API, enable it once at https://script.google.com/home/usersettings then retry."

# ── 5. Deploy a new version (stable URL across redeploys) ───────────────────
say "Deploying web app…"
DESC="DedupManager $(date -u +%Y-%m-%dT%H:%MZ)"
DEPFILE=".deployment-id"
if [ -f "$DEPFILE" ] && [ -s "$DEPFILE" ]; then
  DEPID="$(cat "$DEPFILE")"
  clasp deploy -i "$DEPID" --description "$DESC" >/dev/null \
    || die "Re-deploy to $DEPID failed. Delete $DEPFILE to mint a fresh deployment."
  say "Updated existing deployment (URL unchanged)."
else
  DEPLOY_OUT="$(clasp deploy --description "$DESC")"
  echo "$DEPLOY_OUT"
  DEPID="$(printf '%s\n' "$DEPLOY_OUT" | grep -oE 'AKfyc[A-Za-z0-9_-]+' | head -1)"
  [ -n "$DEPID" ] || die "Could not parse deployment id from clasp output above."
  printf '%s' "$DEPID" > "$DEPFILE"
fi
URL="https://script.google.com/macros/s/$DEPID/exec"

# ── 6. Shareable config string for the extension ────────────────────────────
TEAM_JSON='["Vedant","Rahul","Saksham"]'   # edit to your names
CFG_JSON="$(printf '{"apiUrl":"%s","apiKey":"%s","team":%s}' "$URL" "$KEY" "$TEAM_JSON")"
CFG_STR="$(printf '%s' "$CFG_JSON" | base64 | tr -d '\n')"

printf '\n\033[1;32m✓ Deployed.\033[0m\n\n'
cat <<EOF
  Web app (dashboard):  $URL
  Team API key:         $KEY

  Shareable config (each teammate pastes this into the extension → Import config):

  $CFG_STR

  Next:
    1. Open the dashboard URL once — this initializes the Sheet tabs.
    2. Load the extension: chrome://extensions → Load unpacked → extension/
    3. In the popup → Connection settings → paste the config above → Import.
EOF
printf '\n'
