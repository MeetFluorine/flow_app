# Flow — Material Movement Console

Single-page app, three views (Dashboard / Admin Upload / Calculation) toggled
by the top nav — no page reloads, one shared Supabase backend.

```
.
├── .gitignore
├── index.html          ← all markup — the three views live here, one shown at a time
├── README.md
├── css/
│   └── style.css       ← the entire theme, one file
├── js/
│   ├── supabase-config.js   ← paste your project URL + anon key here
│   ├── supabase-client.js   ← initializes the shared client (window.db)
│   ├── format.js             ← small shared helpers (escapeHtml etc.)
│   ├── parsers.js            ← your existing Excel-parsing logic, unchanged
│   ├── dashboard.js          ← Dashboard view logic
│   ├── admin.js               ← Admin Upload view logic
│   ├── calc.js                 ← Calculation view logic
│   └── app.js                   ← wires up the nav / switches views / lazy-inits each one
└── sql/
    └── schema.sql        ← run this once in Supabase's SQL editor
```

## Setup

1. **Create a Supabase project** (you mentioned you're doing this fresh —
   whenever you've got it, send me the Project URL and anon key and I'll
   drop them in for you, or just paste them yourself into
   `js/supabase-config.js`:
   ```js
   window.SUPABASE_URL = 'https://xxxxxxxxxxxx.supabase.co';
   window.SUPABASE_ANON_KEY = 'eyJhbGciOi...';
   ```
2. **Run the schema** — Supabase dashboard → SQL Editor → paste all of
   `sql/schema.sql` → Run. Creates `uploads`, `movements_raw`,
   `movements_summary`, their indexes, and open (no-login) RLS policies.
3. **Open `index.html`** — no build step, it's a static site. Push the
   whole folder to GitHub and it'll work as-is on GitHub Pages, Netlify,
   Vercel, or any static host; opening it straight from disk also works.

## How the single page works

`js/app.js` shows/hides three container `<div>`s (`#view-dashboard`,
`#view-admin`, `#view-calc`) based on which nav link was clicked, and lazily
calls that view's `init()` the first time it's opened — so the Admin view
doesn't fetch the upload log before you've ever looked at it, for instance.
Each view's logic (`dashboard.js` / `admin.js` / `calc.js`) is wrapped in its
own function scope, so they can each have their own `state` without
clashing with each other on the same page.

## Everything else

Same underlying behavior as before — the Excel parsing, the Supabase schema,
the raw+summary storage split, the no-login admin access. See the comments
in `sql/schema.sql` and the notes below if you didn't see the previous
write-up:

- **No login, by design** — anyone with the link can open Admin Upload.
  The anon key embedded in `js/supabase-config.js` allows read/write to
  these tables from anywhere holding it. Fine for an internal tool; if that
  changes, tighten the RLS policies at the bottom of `sql/schema.sql`.
- **Uploading lakhs of rows takes real minutes** — every raw row is written
  individually in batches of 1,000. The progress bar shows batch-by-batch
  progress; don't close the tab mid-save.
- **Replace vs. add** is a per-upload choice, applied to every month found
  in that file. Uploading the same file twice in "add" mode double-counts
  that month — use "replace" to correct a bad upload instead.
- **Free-tier Supabase limits** (500MB storage, monthly bandwidth cap) are
  worth watching under Project → Usage as raw rows accumulate over months.
