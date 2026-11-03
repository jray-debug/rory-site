// Rory — /this-week page generator (Brief 36, "This week in points").
//
// Reads the opportunities file the Monday sync publishes (the app repo's data/opportunities.json,
// copied into this repo's data/ — the site never reads the app's Supabase tables) and writes ONE
// static page, this-week/index.html: the whole week's list, grouped by kind, each line carrying the
// row's fact (its pill), end date, the scan's verdict verbatim, and the first-party link the row
// already carries. No archive (git is the history), no email capture.
//
// Refusals leave last week's page exactly as it was: a file without provenance (as_of, source_rev,
// derived_from), or a week with nothing to show, exits non-zero WITHOUT writing.
//
// A row whose text breaks the site's vocabulary (VOCAB below) is held, never rewritten — the scan
// authors the verdict, so the fix belongs in the scan. Held rows are listed in the build report.
//
// USAGE:
//   node scripts/build-this-week.mjs [path-to-opportunities.json] [--text-only=id,id]
//     path         source JSON (default: ./data/opportunities.json)
//     --text-only  rows shown without their link (a link found dead after the sync; the row's
//                  data is not edited here — the fix rides the next sync)

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'this-week', 'index.html');
const CONTACT = 'support@rorypoints.com';
const BADGE_HREF = 'https://apps.apple.com/app/apple-store/id6804279759?pt=129220062&ct=thisweek&mt=8';

// Words the public site never says (Brief 36 scope 4): no "track/tracker/tracking", never
// "Reserve Desk", no "Delete", no team names.
const VOCAB = /track|reserve desk|delete|scooter|reggie|geoff|cowork/i;

// The page's groups, in order. Defensive kinds lead when a week has them; an unknown kind still
// renders, under "Other", rather than vanishing or crashing.
const GROUPS = [
  ['transfer_ratio_change', 'Ratio changes'],
  ['devaluation_event', 'Devaluations'],
  ['transfer_bonus', 'Transfer bonuses'],
  ['points_sale', 'Points sales'],
  ['issuer_offer', 'Issuer offers'],
  ['rotating_category', 'Rotating categories'],
  ['welcome_offer', 'Welcome offers'],
  ['card_perk', 'Card perks'],
  ['elevated_value', 'Elevated value'],
  ['upcoming', 'Coming up'],
];
const DEFENSIVE = new Set(['transfer_ratio_change', 'devaluation_event']);

function fail(msg) {
  console.error(`build-this-week: ${msg} — nothing written; last week's page stands.`);
  process.exit(1);
}

// ── input ────────────────────────────────────────────────────────────────────
const fileArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const textOnlyArg = process.argv.slice(2).find((a) => a.startsWith('--text-only='));
const textOnly = new Set(textOnlyArg ? textOnlyArg.slice(12).split(',').filter(Boolean) : []);
const srcPath = fileArg
  ? (isAbsolute(fileArg) ? fileArg : join(process.cwd(), fileArg))
  : join(ROOT, 'data', 'opportunities.json');

let file;
try { file = JSON.parse(readFileSync(srcPath, 'utf8')); } catch (e) { fail(`cannot read ${srcPath} (${e.message})`); }
for (const k of ['as_of', 'source_rev', 'derived_from']) if (!file || !file[k]) fail(`no ${k} in ${srcPath}`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(file.as_of)) fail(`as_of "${file.as_of}" is not a date`);
if (!Array.isArray(file.rows)) fail('no rows array');

const asOf = file.as_of;
const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── selection ────────────────────────────────────────────────────────────────
const held = [];
const shown = [];
for (const o of file.rows) {
  if (o.active === false) { held.push([o.id, 'inactive']); continue; }
  if (o.end_date && o.end_date < asOf) { held.push([o.id, `ended ${o.end_date}`]); continue; }
  const text = [o.title, o.pill_label, o.verdict, o.end_label, o.source_label, o.action_label, ...(o.categories || [])].join(' ');
  const hit = text.match(VOCAB);
  if (hit) { held.push([o.id, `vocabulary: "${hit[0]}"`]); continue; }
  shown.push(o);
}
if (!shown.length) fail('no rows to show');

// Soonest end first inside a group; undated rows keep the scan's order, after the dated ones.
const byEnd = (a, b) => (a.end_date || '9999') .localeCompare(b.end_date || '9999');
const known = new Set(GROUPS.map(([k]) => k));
const groups = [...GROUPS, [null, 'Other']]
  .map(([kind, label]) => ({
    label,
    rows: shown.filter((o) => (kind ? o.kind === kind : !known.has(o.kind))).sort(byEnd),
  }))
  .filter((g) => g.rows.length);

// ── html ─────────────────────────────────────────────────────────────────────
const longDate = (isoDate, opts) =>
  new Date(isoDate + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
const weekLabel = longDate(asOf, { weekday: 'long', month: 'long', day: 'numeric' });
const yearLabel = longDate(asOf, { month: 'long', day: 'numeric', year: 'numeric' });

function rowHtml(o) {
  const link = o.action_url && !textOnly.has(o.id)
    ? `<a href="${esc(o.action_url)}" rel="nofollow noopener" target="_blank">${esc(o.action_label || 'See the offer')} →</a>`
    : '';
  const cats = o.kind === 'rotating_category' && o.categories && o.categories.length
    ? `\n        <p class="cats">${esc(o.categories.join(' · '))}</p>`
    : '';
  const meta = [
    o.end_label ? `<span>${esc(o.end_label)}</span>` : '',
    o.source_label ? `<span>${esc(o.source_label)}</span>` : '',
    link,
  ].filter(Boolean).join('');
  return `      <article class="drow"${o.end_date ? ` data-end="${esc(o.end_date)}"` : ''}>
        <div class="top">
          <h3>${esc(o.title)}</h3>
          ${o.pill_label ? `<span class="pill${DEFENSIVE.has(o.kind) ? ' def' : ''}">${esc(o.pill_label)}</span>` : ''}
        </div>${cats}
        ${o.verdict ? `<p class="verdict"><span class="label">Verdict</span>${esc(o.verdict)}</p>` : ''}
        <div class="meta">${meta}</div>
      </article>`;
}

const groupHtml = (g) => `    <section class="group">
      <h2 class="ghead">${esc(g.label)}</h2>
      <div class="rows">
${g.rows.map(rowHtml).join('\n')}
      </div>
    </section>`;

const title = `This week in points — ${yearLabel} · Rory`;
const desc = `Every live transfer bonus, points sale, card offer, rotating category and welcome offer from Monday's scan, the week of ${yearLabel}, each with its end date and Rory's verdict — including the ones that say skip.`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="rory:as-of" content="${esc(asOf)}">
<meta name="rory:source" content="${esc(file.derived_from)}">
<link rel="canonical" href="https://rorypoints.com/this-week/">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Rory">
<meta property="og:url" content="https://rorypoints.com/this-week/">
<meta property="og:title" content="${esc('This week in points — ' + yearLabel)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="https://rorypoints.com/assets/crest.png">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#F3EAD9">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="stylesheet" href="/assets/site.css">
<style>
  .digest-head h1{font-family:var(--serif);font-weight:400;color:var(--ink);font-size:clamp(28px,4.4vw,40px);line-height:1.2;margin:6px 0 14px}
  .group{max-width:760px;margin:0 auto;padding-top:34px}
  .group .rows{margin-top:12px}
  .ghead{font-family:var(--serif);font-weight:400;font-size:21px;color:var(--ink);margin:0;padding:0 6px}
  .drow .cats{margin-top:8px;font-size:14.5px;color:var(--ink)}
  .drow .meta span{overflow-wrap:anywhere}
  .handoff{text-align:center;max-width:560px;margin:0 auto;padding:0 24px}
  .handoff p{font-size:17px;color:var(--ink);margin:0 0 16px}
  .handoff .appstore{display:inline-block;line-height:0}
  .handoff .appstore img{width:150px;height:50px}
  .ended{display:none}
</style>
</head>
<body>

<header class="topbar">
  <div class="wrap">
    <a class="brandmark" href="/"><img src="/assets/favicon-512.png" alt="">Rory</a>
    <nav class="topnav">
      <a class="plain" href="/this-week/">This Week</a>
      <a class="plain" href="/support.html">Support</a>
    </nav>
  </div>
</header>

<main>
  <section class="band digest-head">
    <div class="wrap">
      <p class="eyebrow">This week in points</p>
      <h1>Week of ${esc(weekLabel)}</h1>
      <p class="lede" style="margin:0 auto">Every live transfer bonus, points sale, card offer and rotating category from Monday's scan, each with its end date and Rory's verdict — including the ones that say skip. A new list every Monday.</p>
    </div>
  </section>

  <section class="band band--alt" style="padding-top:0">
    <div class="wrap">
${groups.map(groupHtml).join('\n')}
      <p class="ftc">Links here are first-party program pages today. Some may become affiliate links; where they do, Rory may earn a commission at no cost to you. Rankings and verdicts are never for sale — this page reads exactly the same with or without the commission.</p>
    </div>
  </section>

  <section class="band">
    <div class="handoff">
      <p>The wallet is free. Rory Premium tells you which of <em>your</em> balances to move.</p>
      <a class="appstore" href="${esc(BADGE_HREF)}"><img src="/assets/app-store-badge.svg" alt="Download Rory on the App Store" width="150" height="50"></a>
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

<script>
  // A row whose end date has passed (Eastern) leaves the page until next Monday's list replaces it;
  // a group left empty goes with it. Without JavaScript every row stays, its end date in plain view.
  (function () {
    var today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    document.querySelectorAll('.drow[data-end]').forEach(function (el) {
      if (el.getAttribute('data-end') < today) el.classList.add('ended');
    });
    document.querySelectorAll('.group').forEach(function (g) {
      if (!g.querySelector('.drow:not(.ended)')) g.classList.add('ended');
    });
  })();
</script>
</body>
</html>
`;

// Belt and braces: the rendered page itself must pass the vocabulary rule.
const pageHit = html.replace(/<script>[\s\S]*?<\/script>/, '').match(VOCAB);
if (pageHit) fail(`rendered page contains "${pageHit[0]}"`);

writeFileSync(OUT, html);
console.log(`wrote this-week/index.html — as_of ${asOf} (${file.derived_from})`);
console.log(`${shown.length} shown of ${file.rows.length} published · ${groups.map((g) => `${g.label} ${g.rows.length}`).join(' · ')}`);
for (const [id, why] of held) console.log(`held: ${id} — ${why}`);
for (const id of textOnly) {
  console.log(shown.some((o) => o.id === id) ? `text-only: ${id}` : `text-only: ${id} — not on the page (no such shown row)`);
}
