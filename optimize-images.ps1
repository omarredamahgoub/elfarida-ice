# optimize-deploy-images.ps1
# ضغط صور elfarida-ice-deploy لتحسين PageSpeed
# متطلب: Python 3 + Pillow

$DeployRoot = "C:\Users\omahg\OneDrive\Desktop\elfarida-ice-deploy"

$PythonScript = @'
import sys, os
from PIL import Image

def optimize(path, max_w, max_h, quality=80):
    if not os.path.exists(path):
        print(f"  [SKIP] {path}")
        return
    try:
        img = Image.open(path).convert("RGBA")
        orig_w, orig_h = img.size
        orig_size = os.path.getsize(path)
        if orig_w > max_w or orig_h > max_h:
            img.thumbnail((max_w, max_h), Image.LANCZOS)
        img.save(path, "WEBP", quality=quality, method=6, lossless=False)
        new_size = os.path.getsize(path)
        saved = (orig_size - new_size) / 1024
        print(f"  [OK] {os.path.basename(path)}: {orig_w}x{orig_h}->{img.size[0]}x{img.size[1]} | {orig_size//1024}KB->{new_size//1024}KB (saved {saved:.1f}KB)")
    except Exception as e:
        print(f"  [ERR] {os.path.basename(path)}: {e}")

base = sys.argv[1]
partners = os.path.join(base, "assets", "partners")
logos    = os.path.join(base, "assets", "ace-logos")

# Partners: معروضة بـ 160x80 → نحفظ 2x = 320x160
partner_files = [
    "LU-VE.webp", "CASTEL.webp", "BITZER.webp", "hazm-eltawreed.webp",
    "Schneider-Electric.webp", "ls-company.webp", "Eliwell.webp",
    "MUELLER.webp", "sana-company.webp", "Assan-Panel.webp",
    "CAREL.webp", "carrier.webp", "COPELAND.webp", "DANFOSS.webp",
    "Friga-Bohn.webp", "honeywell.webp"
]
print("Partner logos:")
for f in partner_files:
    optimize(os.path.join(partners, f), 320, 160, 75)

# Ace logos / شعار الشركة: معروض بـ 80x80 → نحفظ 2x = 160x160
print("\nBrand logos:")
for f in os.listdir(logos):
    if f.lower().endswith(".webp"):
        optimize(os.path.join(logos, f), 160, 160, 85)

print("\nDone.")
'@

$tmp = "$env:TEMP\alf_deploy_opt.py"
$PythonScript | Set-Content -Path $tmp -Encoding UTF8
Write-Host "Optimizing images..." -ForegroundColor Cyan
python $tmp $DeployRoot
Remove-Item $tmp -ErrorAction SilentlyContinue
Write-Host "Complete." -ForegroundColor Green
