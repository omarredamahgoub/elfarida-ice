with open(r"D:\elfarida-ice-deploy\css\shared.css", "r", encoding="utf-8") as f:
    c = f.read()
i = c.find(".wa-cta")
print(c[max(0, i-50):i+1600])
