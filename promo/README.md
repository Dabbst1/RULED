# Monerem promo video

Everything needed to rebuild or change the promo video. This folder isn't part of the website.

**Make the video:** `bash promo/make.sh`. The finished file lands in `promo/out/Monerem-promo.mp4`.
Add `--reuse` to skip refilming and use the screens already saved in `shots/` and `shotsd/`.

| File | What it does |
| --- | --- |
| `scenes.html` | The 10 scenes: words, timing, animation, colors. Each scene's length is its `d:` value in seconds. |
| `cap.py` | Films the app at phone size using sample data (salary, subscriptions, bank balances). Change the numbers here. |
| `shots/`, `shotsd/` | Saved app screens, light and dark mode. |
| `music.py` | Makes the original background track (royalty-free, generated). |
| `render.py` | Draws every scene and encodes it. |
| `preview.py` | Saves a sheet of key frames (`pvsheet.jpg`) for a quick look before rendering. |

**Common changes**
- New wording or prices: edit the text in `scenes.html`.
- New web address (custom domain): search `monerem.com` in `scenes.html`.
- New feature to show: add a scene to `scenes.html` and its name to `ORDER` in `render.py`.

## "Everyone" version with voiceover (`promo/everyone/`)
For anyone new to budgeting (new grads still fit, but they aren't the focus). About 64 seconds.
1. Get the voice model once: `kokoro-v1.0.onnx` and `voices-v1.0.bin` from github.com/thewh1teagle/kokoro-onnx releases (model-files-v1.0), and `pip install kokoro-onnx soundfile`.
2. `cd promo/everyone && KOKORO_DIR=/path/to/model python3 vo.py` makes the voice lines. Edit the words in `LINES`; pick another voice with `VOICE=am_michael` (male) or `VOICE=af_bella`.
3. `python3 build.py` renders `out/Monerem-promo-everyone.mp4`. Each scene stretches to fit its line.
"Monerem" is spoken "MAWN-eh-rem" (set in `vo.py`).
