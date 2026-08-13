// Rory — /this-week digest generator.
//
// Reads the same opportunities.json the app's weekly scan publishes, and writes a static, TRIMMED
// digest page: the top ~5 live opportunities by urgency, each with its verdict, plus a count of the
// rest ("N more live in the app") and a one-line watchlist teaser. The full digest is a Reserve Desk
// premium feature — this page is deliberately the free, SEO-facing slice.
//
// Zero marginal authoring: hook this after the Monday `sync-opportunities.mjs` step. It writes both a
// rolling latest page (this-week/index.html) and a dated archive page (this-week/YYYY-MM-DD/index.html,
// keyed to the Monday of the build week), so every week keeps a permanent URL for the SEO archive.
//
// USAGE:
//   node scripts/build-digest.mjs [path-to-opportunities.json] [--date=YYYY-MM-DD]
//     path   source JSON (default: ./data/opportunities.json)
//     --date  override "today" for reproducible/backfilled builds (default: real today)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOP_N = 5;
const CONTACT = 'support@rorypoints.com';

// ── args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dateArg = args.find((a) => a.startsWith('--date='));
const fileArg = args.find((a) => !a.startsWith('--'));
const srcPath = fileArg
  ? (isAbsolute(fileArg) ? fileArg : join(process.cwd(), fileArg))
  : join(ROOT, 'data', 'opportunities.json');

const today = dateArg ? new Date(dateArg.slice(7) + 'T12:00:00Z') : new Date();
if (Number.isNaN(today.getTime())) { console.error('Bad --date'); process.exit(1); }

// ── date helpers (UTC, to keep folder names stable regardless of TZ) ──────────
const MS_DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
function mondayOf(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // 0 = Monday
  return new Date(x.getTime() - dow * MS_DAY);
}
function daysUntil(endDate) {
  if (!endDate) return Infinity;
  const e = new Date(endDate + 'T12:00:00Z');
  return Math.round((e.getTime() - today.getTime()) / MS_DAY);
}
const longDate = (d) =>
  d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

// ── ranking ───────────────────────────────────────────────────────────────────
// Defensive kinds (an announced devaluation, a ratio cut) get a modest urgency boost: missing the
// window costs real value, so they should out-rank a run-of-the-mill transfer bonus with the same
// end date. Honest, not loud — the boost is small.
const DEFENSIVE = new Set(['devaluation_event', 'transfer_ratio_change']);
const boost = (o) => (DEFENSIVE.has(o.kind) ? 7 : 0);

const all = JSON.parse(readFileSync(srcPath, 'utf8'));
const todayIso = iso(today);
// "Live" = active and not past its end date (undated evergreen rows count as live).
const live = all.filter((o) => o.active !== false && (!o.end_date || o.end_date >= todayIso));

const ranked = live
  .map((o) => ({ o, d: daysUntil(o.end_date), score: daysUntil(o.end_date) - boost(o) }))
  .sort((a, b) => a.score - b.score || a.d - b.d);

const top = ranked.slice(0, TOP_N).map((r) => r.o);
const restCount = Math.max(0, live.length - top.length);

// Watchlist teaser: the soonest-ending live row that isn't already shown (prefer a defensive one).
const rest = ranked.slice(TOP_N);
const watch =
  rest.filter((r) => DEFENSIVE.has(r.o.kind) && Number.isFinite(r.d)).sort((a, b) => a.d - b.d)[0] ||
  rest.filter((r) => Number.isFinite(r.d)).sort((a, b) => a.d - b.d)[0] ||
  null;

// ── html ────────────────────────────────────────────────────────────────────
const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function rowHtml(o) {
  const def = DEFENSIVE.has(o.kind);
  const pill = o.pill_label || o.end_label || '';
  const link =
    o.action_url && o.action_label
      ? `<a href="${esc(o.action_url)}" rel="nofollow noopener" target="_blank">${esc(o.action_label)} →</a>`
      : '';
  const end = o.end_label ? `<span>${esc(o.end_label)}</span>` : '';
  const src = o.source_label ? `<span>${esc(o.source_label)}</span>` : '';
  return `      <article class="drow">
        <div class="top">
          <h3>${esc(o.title)}</h3>
          ${pill ? `<span class="pill${def ? ' def' : ''}">${esc(pill)}</span>` : ''}
        </div>
        ${o.verdict ? `<p class="verdict"><span class="label">Verdict</span>${esc(o.verdict)}</p>` : ''}
        <div class="meta">${[end, src, link].filter(Boolean).join('')}</div>
      </article>`;
}

const captureForm = `      <form class="capture" data-source="digest" novalidate>
        <div class="cap-head">The full digest lands Monday mornings — join the list</div>
        <div class="row">
          <input type="email" name="email" placeholder="you@email.com" autocomplete="email" aria-label="Email address" required>
          <button type="submit">Join the list</button>
        </div>
        <label class="check">
          <input type="checkbox" name="android">
          <span>I'd want it on Android too — note my interest.</span>
        </label>
        <p class="fineprint">No noise. One email when the TestFlight opens.</p>
        <p class="msg" role="status" aria-live="polite"></p>
      </form>`;

function page({ canonicalPath, weekLabel, buildLabel }) {
  const title = `This week in points — ${weekLabel} · Rory`;
  const desc = `The handful of points opportunities worth your attention the week of ${weekLabel}, each with Rory's verdict — including the ones that say skip.`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="https://rorypoints.com/${canonicalPath}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Rory">
<meta property="og:url" content="https://rorypoints.com/${canonicalPath}">
<meta property="og:title" content="${esc('This week in points — ' + weekLabel)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="https://rorypoints.com/assets/crest.png">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#F3EAD9">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="stylesheet" href="/assets/site.css">
</head>
<body>

<header class="topbar">
  <div class="wrap">
    <a class="brandmark" href="/"><img src="/assets/favicon-512.png" alt="">Rory</a>
    <nav class="topnav">
      <a class="plain" href="/this-week/">This Week</a>
      <a class="plain" href="/support.html">Support</a>
      <a class="cta" href="#join">Join</a>
    </nav>
  </div>
</header>

<main>
  <section class="band digest-head">
    <div class="wrap">
      <p class="eyebrow">This week at the desk</p>
      <h2>The moves worth your attention.</h2>
      <p class="lede" style="margin:0 auto">Rory's read on the handful of live opportunities that deserve a decision — with the verdict on each, and the honest ones that say skip. The full desk lives in the app.</p>
      <p class="dateline">${esc(buildLabel)}</p>
    </div>
  </section>

  <section class="band band--alt" style="padding-top:0">
    <div class="wrap">
      <div class="rows">
${top.map(rowHtml).join('\n')}
      ${restCount ? `<div class="morerow"><b>${restCount} more live opportunities</b> are matched to real wallets in the app.</div>` : ''}
      </div>
      ${watch ? `<p class="watchline"><b>Also watching:</b> ${esc(watch.o.title)} — ${esc(watch.o.end_label || 'no fixed date')}.</p>` : ''}
      <p class="ftc">Links here are first-party program pages today. Some may become affiliate links; where they do, Rory may earn a commission at no cost to you. Rankings and verdicts are never for sale — this page reads exactly the same with or without the commission.</p>
    </div>
  </section>

  <section class="band" id="join">
    <div class="wrap" style="max-width:560px">
${captureForm}
    </div>
  </section>
</main>

<footer>
  <div class="links">
    &copy; 2026 Rory, LLC
    <span class="sep">·</span> <a href="/privacy.html">Privacy Policy</a>
    <span class="sep">·</span> <a href="/support.html">Support</a>
    <span class="sep">·</span> <a href="/">Home</a>
  </div>
  <p class="disclaimer">Rory provides editorial information about loyalty programs. It is not a bank, card issuer, or financial advisor, and is not affiliated with the issuers or programs it describes. Questions: <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>
</footer>

<script src="/assets/site.js"></script>
</body>
</html>
`;
}

// ── write ─────────────────────────────────────────────────────────────────────
const monday = mondayOf(today);
const folder = iso(monday);              // dated archive key = Monday of the build week
const weekLabel = longDate(monday);
const buildLabel = `Week of ${weekLabel} · updated ${longDate(today)}`;
const datedPath = `this-week/${folder}/index.html`;

const datedHtml = page({ canonicalPath: datedPath, weekLabel, buildLabel });
// The rolling latest page carries identical content but points its canonical at the dated URL, so the
// permanent archive page is the one search engines index (no duplicate-content split).
const latestHtml = page({ canonicalPath: datedPath, weekLabel, buildLabel });

for (const [rel, html] of [[datedPath, datedHtml], ['this-week/index.html', latestHtml]]) {
  const out = join(ROOT, rel);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  console.log('wrote', rel);
}
console.log(`\ntop ${top.length} of ${live.length} live · ${restCount} more · watch: ${watch ? watch.o.id : 'none'}`);
