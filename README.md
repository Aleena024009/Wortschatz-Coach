# Wortschatz Coach

A German vocabulary app for practising pronunciation. Paste or upload your word list and the app says each word aloud with your device's own German voice. Each card shows an easy English-style respelling (like `SHVES-tuh`) and flashcards help you practise. It works offline and installs on Android, iPhone, Windows, macOS and Linux as an app (PWA).

Plain HTML/CSS/JS. There's no build step and no framework.

## Features

The app has four sections: **Words** (your list, filtered by category, with search), **Add** (pick a category, then add one word or paste a list), **Practice** (flashcards) and **Settings**. On phones these are a bottom bar; on PC they're tabs at the top.

- **Word list**: paste or upload a `.txt` file, one word per line. English first is the default; a switch above the box changes it to German first:
  ```
  ## 1. Time Expressions – Zeitangaben
  Today – Heute
  Tomorrow – Morgen

  ## 4. The 12 Months – Die 12 Monate
  January – Der Januar
  The months (plural) – Die Monate

  B1
  to complain - sich beschweren
  dog - der Hund (A2) | Der Hund bellt.
  ```
  - **Topics and sub-topics**: headings group the words below them (numbering is removed). The biggest heading level in the list is the topic (`# German Numbers – Zahlen von 1 bis 100`), smaller ones are sub-topics inside it (`## Numbers 1–20`). A list with one heading level gives one topic per heading, unless a plain title line comes first: then that line is the topic and the headings are its sub-topics. If you pick a topic in the bulk dropdown, every heading in the list becomes a section of it.
- **Words page**: works like folders: topics → sub-topics → words. Topic and sub-topic tiles show the German name as the title and the English one under it, with a ▶ button that says the German. Inside a topic or sub-topic: **Practise**, and the ⋯ menu (Rename, Swap German and English for lists pasted the wrong way round, move it into another topic or out on its own, Remove topic). Grammar topics are grouped under the 7 parts of the A1 plan (1. Grundlagen, 2. Nomen, Artikel & Negation, 3. Die Fälle, 4. Satzbau & Verben, 5. Präpositionen, 6. Vergangenheit, 7. Konjunktionen); other topics (Familie, Farben…) go under Wortschatz. Topics are always in A1 order. Each part starts closed; tap its heading to open it. **Search looks through all topics.** Cards show only the German word, the English meaning under it and how to say it; the edit button changes everything else (category, topic, sub-topic, example).
- **Translate** page: English → German or German → English (switch at the top). Type a word or sentence. Words and short phrases come from [English Wiktionary](https://en.wiktionary.org)'s translation tables (written by people, with der/die/das from the noun's gender); sentences use the free [MyMemory](https://mymemory.translated.net) machine translation, so check those with your teacher. **+ Add to my words** saves a result to the chosen category.
  - Separators: ` - `, ` – `, `=`, `: ` or a tab. A hyphen inside a word (`E-Mail`) does not split.
  - Words go to the category picked on the Add screen. A line with only a level (`A1`, `Level A1`, `# A1`) changes it for the words below; a trailing `(B1)` or `[B1]` changes it for one line.
  - `der/die/das` is detected and shown smaller before the noun.
  - Optional German example sentence after ` | `.
  - A word already in your list (same German **and** English) is skipped, so "Morgen = tomorrow" and "Morgen = morning" are both kept.
- **Categories**: the app starts with A1, A2, B1 and B2. On the **Add** screen you pick the category first, and new words go there. Add more categories (C1, C2, "Travel", anything) with **+ New** or in Settings. Tap a word's coloured badge to move it to another category. Each category has its own colour and a filter chip with a count.
- **Pronunciation**: the speaker button plays a **real recording by a native speaker** from Wiktionary / Wikimedia Commons (free, no key, needs internet). If a word has no recording, it uses the browser's built-in German voice (`speechSynthesis`, `de-DE`), which is free and runs on your device. Example sentences and "Read text aloud" always use the device voice. You can switch to the device voice for everything in Settings, and choose the voice and speed (Slow / Normal / Fast).
  - **Brave and Firefox on Linux usually have no voices at all.** Words still play recordings, but for sentences use Chrome or Edge on PC.
- **Respelling**: a rule-based guess, marked with **≈**. It handles most everyday words but can be wrong for compounds and loanwords. The optional AI helper replaces it with a checked respelling and IPA.
- **Quiz** (Practice → Quiz): four answers per question from the chosen category, topic and sub-topic: German → English, English → German, or Listen. Shows the right answer and plays it, keeps score, and lets you practise your mistakes again.
- **Flashcards**: they follow the selected category and topic, with Listen, Show answer, Back and Next. **Auto-play** says each card's word as it appears; **Shuffle** on/off switches between random order and your list's order.
- **Local database**: words, categories and your unsent text are stored in **IndexedDB** on your device and survive reloads and restarts. Use *Settings → Export backup / Import backup* (JSON) to move your list between phone and PC, or to keep a safe copy. Clearing the browser's site data deletes the list, so export now and then.
- **PWA**: works offline after the first visit (except recordings, which need internet) and can be installed from the browser.

> **If words sound English:** your device has no German voice installed.
> **Android:** Settings → Text-to-speech output → Speech services by Google → Install voice data → German (Deutsch).
> **iPhone/iPad:** Settings → Accessibility → Spoken Content → Voices → German.
> **Windows:** Settings → Time & language → Speech → Add voices → German.
> Then reload the app and pick the voice in *Settings → Pronunciation*.

## Where the pronunciation comes from

Every time you press play, the card shows a small ♪ line saying which of these three sources you heard:

| Source | What it is | When it's used |
|---|---|---|
| **Native speaker recording (Wiktionary)** | A real person reading the word, uploaded to [Wikimedia Commons](https://commons.wikimedia.org) for [German Wiktionary](https://de.wiktionary.org). The ♪ line links to the file page, which shows who recorded it and the licence (free, mostly CC BY-SA). | Single words, when a recording exists (most common words have one). Needs internet. |
| **Thorsten (open-source computer voice)** | A neural German voice from the [Piper](https://github.com/rhasspy/piper) project (voice by Thorsten Müller, free licence). It runs entirely inside your browser after a one-time 74 MB download in *Settings → Pronunciation*. | Sentences, "Read text aloud", and words without a recording. Works offline and in every browser, including Brave and Firefox on Linux. |
| **Your browser's own German voice** | The text-to-speech voice built into your phone or browser (e.g. "Google Deutsch" in Chrome). | Used if you haven't downloaded Thorsten and the browser has a German voice. |

The respelling (`SHVES-tuh ≈`) is generated by the app's own rules. The **≈** means it's a guess. The IPA is only shown when you added it or the AI helper filled it in.

## Cloud sync (same words on every device)

Without sync, each browser keeps its own list. To have the same list on your phone, PC and any browser, connect a free **Firebase** project (Google's database). You do this once, in about 10 minutes, and it stays free for a personal word list.

1. Go to <https://console.firebase.google.com> → **Create a project** (any name, e.g. `wortschatz-coach`). You can turn off Google Analytics.
2. **Build → Authentication → Get started → Sign-in method → Google → Enable → Save.**
3. Still in Authentication: **Settings → Authorized domains → Add domain →** `aleena024009.github.io`.
4. **Build → Firestore Database → Create database →** pick a location near you → *Start in production mode*.
5. In Firestore, open the **Rules** tab, replace everything with this and press **Publish** (so each person can only read and write their own words):
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```
6. **Project settings (⚙) → General → Your apps → Web (`</>`)** → register an app (any nickname, no hosting). Copy the `firebaseConfig` values it shows.
7. Paste them into [js/firebase-config.js](js/firebase-config.js) in place of `null`, then commit and push. (These values aren't secret: sign-in and the rules above protect the data.)
8. Open the app → **Settings → Sync across devices → Sign in with Google.** Do the same on your other devices with the same Google account.

Your words, categories and removals sync both ways, also in real time while two devices are open. Words you add while offline are uploaded when you're back online. If you add the same word on two devices, only one copy is kept.

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

1. Push this repository to GitHub (it's already set up as `Aleena024009/Wortschatz-Coach`).
2. On GitHub (already done for this repo): **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main`, folder `/ (root)` → Save**.
3. After about a minute the app is live at **https://aleena024009.github.io/Wortschatz-Coach/**.

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
   | `ALLOWED_ORIGIN` | `https://aleena024009.github.io` (lets the GitHub Pages copy call the function) |
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
| [js/audio.js](js/audio.js) | Native-speaker recordings from Wiktionary |
| [js/translate.js](js/translate.js) | English → German translation (Wiktionary, MyMemory) |
| [js/hd-voice.js](js/hd-voice.js) | Free in-browser German voice (Piper "Thorsten") |
| [js/cloud.js](js/cloud.js), [js/sync.js](js/sync.js), [js/firebase-config.js](js/firebase-config.js) | Cloud sync with Firebase, merge rules |
| [sw.js](sw.js), [manifest.json](manifest.json), [icons/](icons/) | PWA: offline cache, install metadata, icons |
| [api/enrich.mjs](api/enrich.mjs), [vercel.json](vercel.json) | Optional AI serverless function |
| [tests/](tests/) | Parser, respelling and sync-merge tests (`npm test`) |
