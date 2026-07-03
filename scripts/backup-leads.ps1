# ═══════════════════════════════════════════════════════════════════
# backup-leads.ps1 — weekly backup of the D1 database: BOTH tables.
#
# Updated 2026-07-04: previously this backed up "leads" only and
# deliberately skipped "settings" (it holds the admin password hash,
# Resend key, and Turnstile secret). That left no way to restore the
# site's operational configuration after a disaster — only customer
# data. Both tables are backed up now, but kept in separate files/
# folders so the sensitive one (settings) is never mixed in with
# routine lead exports, and both stay covered by the existing
# `backups/` exclusion in .gitignore / .wranglerignore (neither table's
# backup is ever committed or deployed).
#
# Output:
#   D:\elfarida-ice-deploy\backups\leads-YYYYMMDD-HHmm.json
#   D:\elfarida-ice-deploy\backups\settings\settings-YYYYMMDD-HHmm.json
# Retention: keeps the last 26 backups of each (~6 months of weekly runs).
# ═══════════════════════════════════════════════════════════════════
$ErrorActionPreference = 'Stop'
$root    = 'D:\elfarida-ice-deploy'
Set-Location $root   # wrangler writes its cache to the CWD; must be writable
$bakDir  = Join-Path $root 'backups'
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null

$stamp = (Get-Date).ToString('yyyyMMdd-HHmm')
$out   = Join-Path $bakDir "leads-$stamp.json"

# Pull every lead as JSON (read-only) and persist it.
npx wrangler d1 execute elfarida-leads --remote --json `
    --command "SELECT * FROM leads ORDER BY created_at;" |
    Out-File -FilePath $out -Encoding UTF8

# Retention: keep newest 26 files, delete older ones.
Get-ChildItem $bakDir -Filter 'leads-*.json' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 26 |
    Remove-Item -Force -ErrorAction SilentlyContinue

"backup written: $out"

# ── Settings table (sensitive: admin_pwd_hash, resend_api_key, turnstile_secret) ──
# Kept in its own subfolder so it's obviously distinct from routine lead
# exports, and so anyone handling backups/ knows this one needs careful
# storage (do not upload it to a shared drive or chat tool unencrypted).
$settingsDir = Join-Path $bakDir 'settings'
New-Item -ItemType Directory -Force -Path $settingsDir | Out-Null
$settingsOut = Join-Path $settingsDir "settings-$stamp.json"

npx wrangler d1 execute elfarida-leads --remote --json `
    --command "SELECT k, v FROM settings ORDER BY k;" |
    Out-File -FilePath $settingsOut -Encoding UTF8

Get-ChildItem $settingsDir -Filter 'settings-*.json' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 26 |
    Remove-Item -Force -ErrorAction SilentlyContinue

"backup written: $settingsOut"
