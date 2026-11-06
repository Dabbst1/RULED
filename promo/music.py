import numpy as np, wave, sys
SR=44100; DUR=float(sys.argv[1]); BPM=112; beat=60/BPM
t=np.arange(int(SR*DUR))/SR; out=np.zeros_like(t)
def note(f): return 440*2**((f-69)/12)
def env(n,a=.005,d=.4):
    x=np.arange(n)/SR; return np.minimum(1,x/a)*np.exp(-x/d)
def add(start,sig,g):
    i=int(start*SR); j=min(len(out),i+len(sig)); 
    if i<len(out): out[i:j]+=sig[:j-i]*g
prog=[[60,64,67,71],[57,60,64,67],[53,57,60,64],[55,59,62,67]]  # Cmaj7 Am7 Fmaj7 G
bars=int(DUR/(4*beat))+2
for b in range(bars):
    ch=prog[b%4]; t0=b*4*beat
    # soft pad
    n=int(4*beat*SR); x=np.arange(n)/SR
    pad=sum(np.sin(2*np.pi*note(m)*x)+.3*np.sin(2*np.pi*note(m)*2.001*x) for m in ch)/len(ch)
    pad*=np.minimum(1,x/.3)*np.minimum(1,(4*beat-x)/.3)
    add(t0,pad,.10)
    # bass
    for k in [0,1.5,2,3.5]:
        n=int(.5*SR); x=np.arange(n)/SR; f=note(ch[0]-24)
        add(t0+k*beat,(np.sin(2*np.pi*f*x)+.25*np.sin(4*np.pi*f*x))*env(n,.004,.25),.32)
    # pluck arpeggio 8ths
    for k in range(8):
        m=ch[[0,2,1,3,2,1,3,2][k]]+12; n=int(.4*SR); x=np.arange(n)/SR; f=note(m)
        sig=(np.sin(2*np.pi*f*x)+.5*np.sin(4*np.pi*f*x)*np.exp(-x/.05))*env(n,.002,.18)
        add(t0+k*beat/2,sig,.09 if b>0 else .05)
    if b==0: continue
    # drums
    for k in range(4):
        n=int(.3*SR); x=np.arange(n)/SR; kick=np.sin(2*np.pi*(50+90*np.exp(-x/.03))*x)*np.exp(-x/.12)
        add(t0+k*beat,kick,.55)
        hn=int(.06*SR); hat=np.random.randn(hn)*np.exp(-np.arange(hn)/SR/.015); hat=np.diff(hat,prepend=0)
        add(t0+k*beat+beat/2,hat,.05)
        if k in(1,3):
            sn=int(.2*SR); clap=np.random.randn(sn)*np.exp(-np.arange(sn)/SR/.05); add(t0+k*beat,np.diff(clap,prepend=0),.10)
fade=np.minimum(1,t/1.0)*np.minimum(1,(DUR-t)/2.0); out*=np.clip(fade,0,1)
out=np.tanh(out*1.1); out/=np.abs(out).max()/0.8
st=np.stack([out,np.roll(out,int(.012*SR))*.96],1)
w=wave.open("music.wav","wb"); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((st*32767).astype(np.int16).tobytes()); w.close()
print("music ok")
