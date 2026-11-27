# Still

Still is a calm, local-first meditation timer and practice tracker built as an installable Progressive Web App (PWA) for iPhone, Android, and desktop browsers.

## Features

- **Flexible sessions**: 1–60 minute countdown timer with quick presets (5, 10, 15, 20, 30 min) plus an open-ended stopwatch.
- **Synthesized ambient soundscapes**: Morning garden, quiet river, Om resonance, binaural calm, and pure silence — generated locally with the Web Audio API (no external audio streams).
- **Gentle completion bell**: Optional singing-bowl chime when your timer finishes, plus automatic Screen Wake Lock so your display stays awake mid-session.
- **Practice rhythm & stats**: Daily and Sunday–Saturday weekly totals, current and longest streaks, and a week/month/year activity heatmap.
- **Light & dark themes**: Respects your system preference and lets you toggle anytime from the header.
- **Private backup options**: Export/import a local JSON backup anytime, or optionally enable Google Drive sync (`drive.file` scope).

## Run locally

From this folder, start any static server:

```sh
python3 -m http.server 4173
```

Open `http://localhost:4173` in your browser.

## Publish for free on GitHub Pages

1. Create a new public repository on [GitHub](https://github.com/new) (for example, `still`).
2. Upload all files from this folder (including `.nojekyll`, `index.html`, `privacy.html`, `styles.css`, `cloud.css`, `app.js`, `cloud.js`, `config.js`, `sw.js`, `manifest.webmanifest`, and `icon.svg`).
3. Open **Settings → Pages** in your repository.
4. Under **Build and deployment**, set **Source** to **Deploy from a branch**, select `main` and `/(root)`, and click **Save**.
5. Wait 1–2 minutes for GitHub Pages to publish your live HTTPS link (`https://YOUR-USERNAME.github.io/still/`).

For full instructions on enabling Google Drive sync for everyone (and options for adding Sign in with Apple or email/password login), see [GOOGLE_SETUP.md](GOOGLE_SETUP.md).

## Install on iPhone or Android

- **iPhone (Safari)**: Open your live GitHub Pages URL, tap **Share → Add to Home Screen**, and enable **Open as Web App**.
- **Android (Chrome)**: Open the URL and tap **Install app** or **Add to Home screen**.

## Privacy

Meditation sessions and preferences are stored locally in your browser. Optional Google Drive sync only creates and updates its own `Still Meditation Backup.json` file. See [privacy.html](privacy.html).

## License

MIT — see [LICENSE](LICENSE).
