import sys
from playwright.sync_api import sync_playwright
from PIL import Image
pts=[("hook",4.0),("brand",3.2),("pay",4.6),("afford",4.4),("subs",4.4),("road",4.6),("grow",4.4),("learn",4.0),("app",1.9),("app",4.4),("cta",5.2)]
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome")
    pg=b.new_page(viewport={"width":1080,"height":1920})
    pg.goto("file://"+__import__("os").getcwd()+"/scenes.html"); pg.evaluate("window.ready")
    for i,(n,t) in enumerate(pts):
        pg.evaluate(f"render('{n}',{t})"); pg.wait_for_function("[...document.images].every(i=>i.complete)"); pg.screenshot(path=f"pv{i}.jpg",type="jpeg",quality=80)
    b.close()
ims=[Image.open(f"pv{i}.jpg").resize((270,480)) for i in range(len(pts))]
c=Image.new("RGB",(270*6+50,480*2+10),"white")
for i,im in enumerate(ims): c.paste(im,((i%6)*278,(i//6)*490))
c.save("pvsheet.jpg",quality=88)
