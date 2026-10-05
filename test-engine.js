// Compares engine.js with real SQLite (via Python sqlite3, see oracle.py) on generated column types and values.
const g = require('./engine.js'), cp = require('child_process');
let seed = +process.env.SEED || 5; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296; const pick = a => a[Math.floor(rnd() * a.length)];
const DECLS = ['INT', 'INTEGER', 'BIGINT', 'TINYINT', 'UNSIGNED BIG INT', 'VARCHAR(10)', 'TEXT', 'CLOB', 'NVARCHAR(5)', 'BLOB', '', 'REAL', 'DOUBLE', 'DOUBLE PRECISION', 'FLOAT', 'FLOATING POINT', 'NUMERIC', 'DECIMAL(10,2)', 'BOOLEAN', 'DATE', 'DATETIME', 'STRING', 'CHARINT', 'POINT', 'MONEY', 'varchar(3)', 'Integer', 'TIMESTAMP'];
const VALS = ['5', '-3', '0', '3.0', '2.5', '1e3', '-0.0', '0.1', "'12'", "'007'", "'  12  '", "'12abc'", "'1.50'", "'0x10'", "'1e3'", "'-0'", "'+5'", "'.5'", "'5.'", "'abc'", "''", "' '", "X'0A'", "X''", 'NULL', '9223372036854775807', '9223372036854775808', "'9223372036854775808'", "'-9223372036854775808'", "'1_000'", "'1e400'", "'3.0'", "'1e2'", "'2026-01-01'", "'10'", "'9'", '10', '9', '1.0e0', "'1 2'", "'+'", "'.'", "'12.0e-1'", "'٣'", '123456789012345678901234567890', '1e18', '1e19', "'1e19'", "'1e18'", '4.0', "'4.0'", "'true'"];
const results = { n: 0, bad: [] };
const cases = [], exp = [];
const N = +process.env.N || 3000;
for (let i = 0; i < N; i++) {
  const rr = rnd();
  if (rr < 0.35) { const decl = pick(DECLS), lit = pick(VALS); cases.push({ t: 'store', decl, lit }); }
  else if (rr < 0.65) cases.push({ t: 'lit', decl: pick(DECLS), la: pick(VALS), lit: pick(VALS), flip: rnd() < 0.5 });
  else { const da = pick(DECLS), db = pick(DECLS), la = pick(VALS), lb = pick(VALS); cases.push({ t: 'cmp', da, db, la, lb }); }
}
const r = cp.spawnSync('python3', [__dirname + '/oracle.py'], { input: JSON.stringify(cases), encoding: 'utf8', maxBuffer: 1 << 28 });
const out = JSON.parse(r.stdout);
function engStore(decl, lit) { const v = g.parseLiteral(lit); return g.store(g.affinity(decl).a, v); }
cases.forEach((c, i) => {
  const o = out[i]; if (o.err) { results.bad.push({ c, err: o.err }); return; }
  results.n++;
  if (c.t === 'store') {
    const s = engStore(c.decl, c.lit); let ok = s.c === o.type;
    const q = g.show(s);
    if (ok && s.c !== 'real') ok = q === o.quote; // reals: formatting differs (%!.15g), type is compared
    if (ok && s.c === 'real') ok = !isFinite(s.v) || Number(o.quote) === s.v;
    if (!ok) results.bad.push({ c, eng: s.c + ' ' + q, real: o.type + ' ' + o.quote });
  } else if (c.t === 'lit') {
    const a = engStore(c.decl, c.la), b = g.parseLiteral(c.lit);
    const cm = c.flip ? g.compare('NONE', b, g.affinity(c.decl).a, a) : g.compare(g.affinity(c.decl).a, a, 'NONE', b);
    const got = cm.cmp === null ? [null, null, null] : [cm.cmp < 0 ? 1 : 0, cm.cmp === 0 ? 1 : 0, cm.cmp > 0 ? 1 : 0];
    if (JSON.stringify(got) !== JSON.stringify(o.r)) results.bad.push({ c, eng: got, real: o.r, stored: g.show(a) });
  } else {
    const a = engStore(c.da, c.la), b = engStore(c.db, c.lb), cm = g.compare(g.affinity(c.da).a, a, g.affinity(c.db).a, b);
    const got = cm.cmp === null ? [null, null, null] : [cm.cmp < 0 ? 1 : 0, cm.cmp === 0 ? 1 : 0, cm.cmp > 0 ? 1 : 0];
    if (JSON.stringify(got) !== JSON.stringify(o.r)) results.bad.push({ c, eng: got, real: o.r, stored: g.show(a) + ' | ' + g.show(b) });
  }
});
console.log(JSON.stringify({ cases: results.n, mismatches: results.bad.length }));
results.bad.slice(0, 20).forEach(b => console.log(JSON.stringify(b)));
process.exit(results.bad.length ? 1 : 0);
