"""Renders the 'everyone' promo with voiceover. Run vo.py first (makes vo/)."""
import json, os, re, subprocess, numpy as np, soundfile as sf
from playwright.sync_api import sync_playwright
ORDER=["hook","brand","pay","afford","subs","road","grow","learn","app","cta"]
LEAD, TAIL = 0.35, 0.55
CHROME=os.environ.get("CHROME","/usr/bin/google-chrome")
vo=json.load(open("vo/durations.json"))["lines"]
base={k:float(v) for k,v in re.findall(r"S\.(\w+)=\{d:([\d.]+)",open("scenes.html").read())}
DUR={k:round(max(base[k], LEAD+vo[k]+TAIL)*30)/30 for k in ORDER}
os.makedirs("parts",exist_ok=True)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROME); pg=b.new_page(viewport={"width":1080,"height":1920})
    pg.add_init_script("window.DUR="+json.dumps(DUR))
    pg.goto("file://"+os.getcwd()+"/scenes.html"); pg.evaluate("window.ready")
    for i,n in enumerate(ORDER):
        out=f"parts/{i:02d}_{n}.mp4"; tmp=f"parts/tmp_{n}.mp4"
        ff=subprocess.Popen(["ffmpeg","-y","-loglevel","error","-f","image2pipe","-framerate","30","-c:v","mjpeg","-i","-","-c:v","libx264","-crf","18","-preset","veryfast","-pix_fmt","yuv420p","-r","30",tmp],stdin=subprocess.PIPE)
        for f in range(round(DUR[n]*30)):
            pg.evaluate(f"render('{n}',{f/30})")
            if f==0: pg.wait_for_function("[...document.images].every(i=>i.complete)")
            ff.stdin.write(pg.screenshot(type="jpeg",quality=92))
        ff.stdin.close()
        if ff.wait()==0: os.rename(tmp,out)
        print(n,DUR[n],flush=True)
    b.close()
open("parts/list.txt","w").write("".join(f"file '{i:02d}_{n}.mp4'\n" for i,n in enumerate(ORDER)))
# voice track: each line starts LEAD seconds into its scene
total=sum(DUR.values()); sr=24000; track=np.zeros(int(total*sr)+sr); t=0
for n in ORDER:
    a,_=sf.read(f"vo/{n}.wav"); i=int((t+LEAD)*sr); track[i:i+len(a)]+=a; t+=DUR[n]
sf.write("parts/voice.wav",track,sr)
subprocess.run(["python3","../music.py",str(total)],check=True); os.replace("music.wav","parts/music.wav")
os.makedirs("out",exist_ok=True)
subprocess.run(["ffmpeg","-y","-loglevel","error","-f","concat","-safe","0","-i","parts/list.txt","-c","copy","parts/joined.mp4"],check=True)
# music sits low and dips further while the voice talks
fc=("[1:a]aresample=44100,pan=stereo|c0=c0|c1=c0,volume=1.6,asplit=2[v][sc];"
    "[2:a]volume=0.30[m];[m][sc]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=350[md];"
    "[md][v]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]")
subprocess.run(["ffmpeg","-y","-loglevel","error","-i","parts/joined.mp4","-i","parts/voice.wav","-i","parts/music.wav",
  "-filter_complex",fc,"-map","0:v","-map","[a]","-c:v","copy","-c:a","aac","-b:a","192k","-shortest","-movflags","+faststart","out/Monerem-promo-everyone.mp4"],check=True)
print("total",round(total,2))
