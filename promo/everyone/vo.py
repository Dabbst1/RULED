"""Voiceover for the 'everyone' promo. Writes vo/<scene>.wav and vo/durations.json.
Needs: pip install kokoro-onnx soundfile, plus kokoro-v1.0.onnx and voices-v1.0.bin
(github.com/thewh1teagle/kokoro-onnx releases, model-files-v1.0) in $KOKORO_DIR."""
import os, json, sys, numpy as np, soundfile as sf
from kokoro_onnx import Kokoro
VOICE = os.environ.get("VOICE", "af_heart")
D = os.environ.get("KOKORO_DIR", ".")
LINES = {
 "hook":  "Nobody ever taught you how to budget? You're not alone. Most of us were never shown how money actually works.",
 "brand": "Meet Monerem. Budgeting tools that do the math, and explain it in plain English.",
 "pay":   "Start with your real paycheck. Enter your pay, and see exactly what lands in your account.",
 "afford":"Thinking about a new apartment, or a car? Check if you can afford it, before you sign.",
 "subs":  "Monerem finds the subscriptions you forgot about, and shows what they really cost you each year.",
 "road":  "Then follow a simple roadmap. Build an emergency fund, get your free employer match, and knock out high-interest debt.",
 "grow":  "Watch your net worth grow. And money you don't spend rolls into next month.",
 "learn": "Every money word comes with a plain-English explanation. No jargon. No judgment.",
 "app":   "Add it to your home screen, link your bank, and get bill reminders. And yes, there's dark mode.",
 "cta":   "Whether it's your first paycheck or a fresh start, Monerem helps you plan your life around your money. Try it free for fourteen days, at Monerem dot com.",
}
BRAND_IN, BRAND_OUT = "mˈoʊnɹəm", "mˈɑːnəɹɛm"   # say it "MAWN-eh-rem"
k = Kokoro(os.path.join(D, "kokoro-v1.0.onnx"), os.path.join(D, "voices-v1.0.bin"))
os.makedirs("vo", exist_ok=True); durs = {}
for name, text in LINES.items():
    ph = k.tokenizer.phonemize(text, "en-us").replace(BRAND_IN, BRAND_OUT)
    audio, sr = k.create(ph, voice=VOICE, speed=1.04, lang="en-us", is_phonemes=True)
    # trim silence at the ends
    nz = np.where(np.abs(audio) > 0.01)[0]; audio = audio[max(0, nz[0]-800): nz[-1]+2400]
    sf.write(f"vo/{name}.wav", audio, sr); durs[name] = round(len(audio)/sr, 2)
    print(name, durs[name], flush=True)
json.dump({"voice": VOICE, "sr": sr, "lines": durs}, open("vo/durations.json", "w"), indent=1)
