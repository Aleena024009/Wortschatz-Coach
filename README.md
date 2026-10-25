# Wortschatz Coach

A German vocabulary app for practising pronunciation. Paste or upload your word list and the app says each word aloud with your device's own German voice. Each card shows an easy English-style respelling (like `SHVES-tuh`) and flashcards help you practise. It works offline and installs on Android, iPhone, Windows, macOS and Linux as an app (PWA).

Plain HTML/CSS/JS. There's no build step and no framework.

## Features

- **Word list**: paste or upload a `.txt` file, one word per line, German first:
  ```
  A1
  der Hund - dog
  gehen - to go
  A2
  die Erfahrung = experience
  sich beschweren - to complain (B1)
  # Travel
  der Bahnhof - station | Der Bahnhof ist groß.
  ```
  - Separators: ` - `, ` – `, `=`, `: ` or a tab. A hyphen inside a word (`E-Mail`) does not split.
  - A line with only a level (`A1`, `Level A1`, `# A1`) sets the category for the words below it. A trailing `(B1)` or `[B1]` overrides it for one line.
  - `der/die/das` is detected and shown smaller before the noun.
  - Optional example sentence after ` | `.
  - Words already in your list are skipped.
- **Categories**: the app starts with A1, A2, B1 and B2. Add more (C1, C2, "Travel", anything) under *Categories & backup*, or with a `# Name` line in a list. Tap a word's coloured badge to move it to another category. Each category has its own colour and a filter chip with a count.
- **Speech**: uses the browser's built-in `speechSynthesis` (`de-DE`). It's free, runs on your device and doesn't send anything to a server. Choose the German voice and the speed (Slow 0.6 / Normal 0.85 / Fast 1.0). "Read text aloud" reads your whole pasted text and has a Stop button.
- **Respelling**: a rule-based guess, marked with **≈**. It handles most everyday words but can be wrong for compounds and loanwords. The optional AI helper replaces it with a checked respelling and IPA.
- **Flashcards**: they follow the selected category, with Listen, Show answer, Back, Next and Shuffle.
- **Local database**: words, categories and your unsent text are stored in **IndexedDB** on your device and survive reloads and restarts. Use *Export backup* / *Import backup* (JSON) to move your list between phone and PC, or to keep a safe copy. Clearing the browser's site data deletes the list, so export now and then.
- **PWA**: works offline after the first visit and can be installed from the browser.

> **If words sound English:** your device has no German voice installed.
> **Android:** Settings → Text-to-speech output → Speech services by Google → Install voice data → German (Deutsch).
> **iPhone/iPad:** Settings → Accessibility → Spoken Content → Voices → German.
> **Windows:** Settings → Time & language → Speech → Add voices → German.
> Then reload the app and pick the voice under *Voice & speed*.

## Run it locally

You need any static web server. Opening `index.html` as a file won't work because ES modules and the service worker need `http://`.

```bash
cd Wortschatz-Coach
python3 -m http.server 8000
# or: npm start   (uses npx serve)
```

Open <http://localhost:8000>.

Run the parser tests with `npm test` (Node 20+).

> A phone on the same Wi-Fi can open `http://<your-PC-IP>:8000` and the speech will work. Offline mode and installing need HTTPS, though, so use one of the free hosts below to try it on your phone properly.

## Deploy for free on GitHub Pages (HTTPS, installable)

1. Push this repository to GitHub (it's already set up as `Aleena24/Wortschatz-Coach`).
2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main`, folder `/ (root)` → Save**.
3. After about a minute the app is live at **https://aleena24.github.io/Wortschatz-Coach/**.

All paths are relative, so the `/Wortschatz-Coach/` sub-folder works as it is.

**When you change files later:** bump `VERSION` in [sw.js](sw.js) (e.g. `wortschatz-v2`) so installed copies pick up the update. They update on the next launch after that.

### Install it as an app

- **Android (Chrome):** open the link → tap **Install app** in the header, or ⋮ → *Install app / Add to Home screen*.
- **iPhone/iPad (Safari):** open the link → Share → **Add to Home Screen**.
- **Windows/macOS/Linux (Chrome or Edge):** open the link → click **Install app** in the header, or the install icon in the address bar.

## Optional AI helper

The app is complete without AI. Two buttons use it, and only when you press them:

- **Fill in missing levels & spelling**: for words missing a level, IPA or respelling, it asks the AI for all three in batches of up to 120 words. It never overwrites a level or respelling you gave.
- **Extract words with AI**: appears when you paste ordinary German sentences instead of a list. It finds the vocabulary in batches of about 80 unique words and adds each one with English, IPA, respelling, level, article, part of speech and an example sentence.

It uses Claude Haiku 5.5 (`claude-haiku-5-5`), Anthropic's cheapest and fastest model, so a batch costs a fraction of a cent.

### Why there's a server function

An API key in the frontend can be read by anyone who opens the page, who can then spend your credit. So the key lives in a tiny serverless function, [api/enrich.mjs](api/enrich.mjs). The app sends the words to the function, and only the function holds the key and talks to Anthropic. GitHub Pages can only host static files, so the function runs on **Vercel** (free Hobby plan).

### Set it up (about 5 minutes)

1. Get an API key at <https://console.anthropic.com> (Settings → API keys) and add a little credit.
2. Sign in at <https://vercel.com> with GitHub → **Add New → Project** → import `Wortschatz-Coach`. Keep Framework Preset **Other** and leave the build settings empty.
3. Before deploying, open **Environment Variables** and add:
   | Name | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | your key (`sk-ant-…`) |
   | `APP_PASSCODE` | any passcode you choose. Strongly recommended: without it, anyone who finds the URL can use your credit |
   | `ALLOWED_ORIGIN` | `https://aleena24.github.io` (lets the GitHub Pages copy call the function) |
4. Deploy. You get a URL like `https://wortschatz-coach-xyz.vercel.app`.
5. In the app, open **Optional: AI helper**:
   - **Using the Vercel copy of the app**: leave *AI endpoint* empty and enter your passcode.
   - **Using the GitHub Pages copy**: set *AI endpoint* to `https://wortschatz-coach-xyz.vercel.app/api/enrich` and enter your passcode.

The Vercel URL is a full copy of the app too, over HTTPS and installable, so you can use it instead of GitHub Pages if you prefer.

To try the AI part locally: `npm install`, put `ANTHROPIC_API_KEY=sk-ant-…` in a `.env.local` file (it's ignored by git), then run `npm run dev:ai` (Vercel CLI) and open the URL it prints.

## Files

| File | What it does |
|---|---|
| [index.html](index.html), [styles.css](styles.css) | Page and styles (mobile-first, light/dark) |
| [js/app.js](js/app.js) | UI, flashcards, categories, backup, AI calls |
| [js/db.js](js/db.js) | IndexedDB storage (falls back to localStorage) |
| [js/parser.js](js/parser.js) | Word-list parser |
| [js/respell.js](js/respell.js) | Rule-based English-style respelling |
| [js/speech.js](js/speech.js) | Text-to-speech wrapper |
| [sw.js](sw.js), [manifest.json](manifest.json), [icons/](icons/) | PWA: offline cache, install metadata, icons |
| [api/enrich.mjs](api/enrich.mjs), [vercel.json](vercel.json) | Optional AI serverless function |
| [tests/](tests/) | Parser and respelling tests (`npm test`) |
