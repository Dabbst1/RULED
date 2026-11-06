import subprocess, os
from playwright.sync_api import sync_playwright
ORDER=["hook","brand","pay","afford","subs","road","grow","learn","app","cta"]
os.makedirs("parts",exist_ok=True)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome")
    pg=b.new_page(viewport={"width":1080,"height":1920})
    pg.goto("file://"+os.getcwd()+"/scenes.html"); pg.evaluate("window.ready")
    durs=pg.evaluate("Object.fromEntries(Object.entries(SCENES).map(([k,v])=>[k,v.d]))")
    for i,n in enumerate(ORDER):
        out=f"parts/{i:02d}_{n}.mp4"
        if os.path.exists(out): continue
        tmp=f"parts/tmp_{n}.mp4"
        ff=subprocess.Popen(["ffmpeg","-y","-loglevel","error","-f","image2pipe","-framerate","30","-c:v","mjpeg","-i","-","-c:v","libx264","-crf","18","-preset","veryfast","-pix_fmt","yuv420p","-r","30",tmp],stdin=subprocess.PIPE)
        N=round(durs[n]*30)
        for f in range(N):
            pg.evaluate(f"render('{n}',{f/30})")
            if f==0: pg.wait_for_function("[...document.images].every(i=>i.complete)")
            ff.stdin.write(pg.screenshot(type="jpeg",quality=92))
        ff.stdin.close(); rc=ff.wait()
        if rc==0: os.rename(tmp,out)
        print(n,N,rc,flush=True)
    b.close()
with open("parts/list.txt","w") as f:
    for i,n in enumerate(ORDER): f.write(f"file '{i:02d}_{n}.mp4'\n")
print("total",sum(durs.values()))
