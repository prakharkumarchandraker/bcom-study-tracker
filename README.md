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

## 3. Turn on cloud sync (so data survives phone change and matches across devices)

1. Create a free project at https://supabase.com.
2. SQL Editor → New query → paste `supabase.sql` → Run.
3. Project Settings → API: copy the **Project URL** and the **anon public** key.
4. In the app: More → Settings, backup & sync → paste URL and key → tap **Make a sync code** → **Save & sync now**.
5. On the second device enter the **same** URL, key and sync code.

How it works: every change saves on the device first, then uploads ~3 seconds later. Offline changes upload when the internet returns. When the app opens it pulls the newer copy. If both devices were edited offline, the one edited last wins, so avoid editing on two devices while both are offline.

Keep the sync code private: anyone with the URL, key and code can read the data.

Free Supabase projects pause after a week of no use. The app keeps working offline; open the Supabase dashboard and click Restore if sync shows errors. Weekly **Download backup** is the safety net.

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
