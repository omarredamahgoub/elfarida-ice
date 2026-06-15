# fix-index-html.ps1
# يُضيف sizes وdecoding على صور الـ partners والـ logo في index.html

$FilePath = "C:\Users\omahg\OneDrive\Desktop\elfarida-ice-deploy\index.html"

$PythonScript = @'
import sys, re

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    html = f.read()

def fix_partners(m):
    tag = m.group(0)
    if 'sizes=' not in tag:
        tag = tag.replace('<img', '<img sizes="(max-width:640px) 130px, 160px"', 1)
    if 'decoding=' not in tag:
        tag = tag.replace('<img', '<img decoding="async"', 1)
    return tag

def fix_logo(m):
    tag = m.group(0)
    if 'sizes=' not in tag:
        tag = tag.replace('<img', '<img sizes="(max-width:640px) 60px, 80px"', 1)
    if 'decoding=' not in tag:
        tag = tag.replace('<img', '<img decoding="async"', 1)
    return tag

html2 = re.sub(r'<img\s[^>]*?src="assets/partners/[^"]*?"[^>]*?>',
               fix_partners, html, flags=re.IGNORECASE|re.DOTALL)
html2 = re.sub(r'<img\s[^>]*?src="assets/ace-logos/[^"]*?"[^>]*?>',
               fix_logo, html2, flags=re.IGNORECASE|re.DOTALL)

with open(path, "w", encoding="utf-8") as f:
    f.write(html2)

changed = html2 != html
cnt = len(re.findall(r'<img[^>]*?src="assets/partners/', html2, re.IGNORECASE|re.DOTALL))
print(f"{'Updated' if changed else 'No change'} — {cnt} partner imgs processed")
'@

$tmp = "$env:TEMP\fix_index.py"
$PythonScript | Set-Content -Path $tmp -Encoding UTF8
python $tmp $FilePath
Remove-Item $tmp -ErrorAction SilentlyContinue
