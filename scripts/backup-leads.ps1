# ═══════════════════════════════════════════════════════════════════
# backup-leads.ps1 — weekly backup of the D1 "leads" table only.
# Excludes the settings table on purpose (it holds secrets).
# Output: D:\elfarida-ice-deploy\backups\leads-YYYYMMDD-HHmm.json
# Retention: keeps the last 26 backups (~6 months of weekly runs).
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
