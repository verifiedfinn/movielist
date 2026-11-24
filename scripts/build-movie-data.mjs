// Snapshot OMDb data for every title in the sheet into data/movies.json,
// so the site loads posters/ratings from one file instead of ~150 API calls.
//   node scripts/build-movie-data.mjs          -> only looks up new titles
//   node scripts/build-movie-data.mjs --all    -> refreshes everything (ratings)
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const app = fs.readFileSync(new URL('js/app.js', root), 'utf8');
const SHEETS_URL = app.match(/SHEETS_URL\s*=\s*'([^']+)'/)[1];
const KEY = app.match(/OMDB_KEY\s*=\s*'([^']+)'/)[1];
const FIXES = eval('(' + app.match(/const TITLE_FIXES = (\{[\s\S]*?\n  \});/)[1] + ')');
const outFile = new URL('data/movies.json', root);
const all = process.argv.includes('--all');

const KEEP = ['imdbID', 'Title', 'Year', 'Poster', 'imdbRating', 'Genre', 'Runtime', 'Director', 'Plot', 'Country', 'Language'];
const old = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : { byId: {}, byTitle: {} };
const db = { updated: '', byId: all ? {} : { ...old.byId }, byTitle: all ? {} : { ...old.byTitle } };

function csvRows(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const rows = csvRows((await (await fetch(SHEETS_URL)).text()).replace(/\r/g, ''));
const head = rows[0].map(h => h.trim().toLowerCase());
const ti = head.indexOf('title'), ii = head.indexOf('imdb');
let looked = 0, missing = [];

for (const r of rows.slice(1)) {
  let title = (r[ti] || '').replace(/\s+/g, ' ').trim();
  if (!title) continue;
  const fix = FIXES[title.toLowerCase()];
  if (fix && fix[0]) title = fix[0];
  const id = ((ii >= 0 && r[ii] || '').match(/tt\d{6,}/) || [''])[0] || (fix ? fix[1] : '');
  const tkey = title.toLowerCase();
  if (id ? db.byId[id] : db.byTitle[tkey] !== undefined) continue;

  const p = { apikey: KEY, plot: 'short' };
  if (id) p.i = id;
  else { const ym = title.match(/^(.*?)\s*\((\d{4})\)$/); p.t = ym ? ym[1] : title; if (ym) p.y = ym[2]; }
  const d = await (await fetch('https://www.omdbapi.com/?' + new URLSearchParams(p))).json();
  looked++;
  if (d.Error && /limit/i.test(d.Error)) { console.error('OMDb daily limit hit — run again tomorrow'); break; }
  if (d.Response !== 'True') { if (!id) db.byTitle[tkey] = null; missing.push(title); continue; }
  const slim = Object.fromEntries(KEEP.map(k => [k, d[k]]));
  db.byId[d.imdbID] = slim;
  if (!id) db.byTitle[tkey] = d.imdbID;
}

db.updated = new Date().toISOString().slice(0, 10);
fs.mkdirSync(new URL('data/', root), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(db));
console.log(`${looked} lookups, ${Object.keys(db.byId).length} movies saved.`);
if (missing.length) console.log('Not on OMDb:', missing.join(' | '));
