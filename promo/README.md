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
- New web address (custom domain): search `dabbst1.github.io/RULED` in `scenes.html`.
- New feature to show: add a scene to `scenes.html` and its name to `ORDER` in `render.py`.
