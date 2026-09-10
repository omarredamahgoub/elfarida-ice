import re
with open(r"D:\elfarida-ice-deploy\js\site-shell.js", "r", encoding="utf-8") as f:
    c = f.read()
i = c.find("wa-fab")
print(c[max(0, i-1200):i+3000])
