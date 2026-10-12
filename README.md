# Pragati Study Desk

Offline study tracker for BCom (all semesters). One HTML file plus a few support files. No build step.

## 1. Put it online (free, ~5 min)

Pick one:

- **Netlify Drop**: go to https://app.netlify.com/drop, drag this whole `study-desk` folder in. You get a link like `https://something.netlify.app`. Make a free account so the site doesn't expire.
- **GitHub Pages**: new repo → upload these files → Settings → Pages → Deploy from branch `main` / root.

It must be served over https (both options do this) for offline mode and install to work.

## 2. Install on Pragati's phone and laptop

- **Android**: open the link in Chrome → ⋮ menu → **Add to Home screen / Install app**.
- **Laptop**: open in Chrome or Edge → install icon at the right end of the address bar.

After the first open it works fully offline.

## 3. Cloud sync (Firebase Realtime Database, no login)

One-time setup in the Firebase console:

1. Realtime Database → **Rules** tab → replace everything with the contents of `database.rules.json` → **Publish**.
   This lets the app read and write only `/desks/<sync code>`. Nobody can list the codes, so the data is reachable only with the code.

In the app:

1. **First device** (e.g. Pragati's phone): Settings → Cloud sync → **Turn on sync**. A code like `pragati-xxxxxxxxxxxx` appears. Copy it and keep it somewhere safe (WhatsApp it to yourself).
2. **Second device** (laptop): Settings → Cloud sync → paste the code → **Use a code**. The laptop's data is replaced by the cloud copy.

After that, every change saves on the device first and uploads about 3 seconds later. Offline changes upload when the internet is back. When the app opens it pulls the newer copy. If both devices are edited while offline, the one edited last wins.

Anyone who has the code can read and change the data, so don't post it publicly. Weekly **Download backup** is still the safety net.

## 4. Updating the app later

Replace `index.html`, then in `sw.js` change `VERSION` (e.g. `desk-v2`) and redeploy. Data is not touched by updates.

## Adding a new semester

Settings → Semesters → Add semester (set the exam start date, make it current). Then Syllabus → + Add subject for each subject and paste its syllabus:

```
Unit 1: Introduction
- Meaning and scope
- Accounting concepts
Unit 2: Final Accounts
- Trading account
```

## Adding lecture videos

Settings → Lecture videos → **Get the Claude prompt** → copy it → paste in Claude with the lecture names, lengths, links and subject → copy the JSON reply → Settings → **+ Add lectures** → paste.

JSON format:

```json
[
  {"subject": "Financial Accounting",
   "videos": [
     {"title": "Depreciation one-shot", "minutes": 95, "url": "https://youtu.be/...", "topic": ""}
   ]}
]
```
