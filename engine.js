(function (root) {
  'use strict';
  // SQLite type affinity and comparison rules (rules from the SQLite datatype documentation, checked against real SQLite).
  var MAXI = 9223372036854775807n, MINI = -9223372036854775808n;
  function affinity(decl) {
    var d = String(decl || '').toUpperCase();
    if (d.indexOf('INT') >= 0) return { a: 'INTEGER', rule: 'the declared type contains "INT"' };
    if (/CHAR|CLOB|TEXT/.test(d)) return { a: 'TEXT', rule: 'the declared type contains "' + (/CHAR/.test(d) ? 'CHAR' : /CLOB/.test(d) ? 'CLOB' : 'TEXT') + '"' };
    if (d.trim() === '' || d.indexOf('BLOB') >= 0) return { a: 'BLOB', rule: d.trim() === '' ? 'no declared type' : 'the declared type contains "BLOB"' };
    if (/REAL|FLOA|DOUB/.test(d)) return { a: 'REAL', rule: 'the declared type contains "' + (/REAL/.test(d) ? 'REAL' : /FLOA/.test(d) ? 'FLOA' : 'DOUB') + '"' };
    return { a: 'NUMERIC', rule: 'none of INT, CHAR, CLOB, TEXT, BLOB, REAL, FLOA, DOUB appears, so the default NUMERIC applies' };
  }
  // A value as written in SQL: 12, 1.5, '12', X'0A', NULL
  function parseLiteral(src) {
    var s = String(src).trim(), m;
    if (/^null$/i.test(s)) return { c: 'null' };
    if ((m = /^'((?:[^']|'')*)'$/.exec(s))) return { c: 'text', v: m[1].replace(/''/g, "'") };
    if ((m = /^[xX]'([0-9a-fA-F]*)'$/.exec(s)) && m[1].length % 2 === 0) return { c: 'blob', v: m[1].toUpperCase() };
    if (/^[+-]?\d+$/.test(s)) { var b = BigInt(s); if (b >= MINI && b <= MAXI) return { c: 'integer', v: b }; return { c: 'real', v: Number(s) }; }
    if (/^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(s)) return { c: 'real', v: Number(s) };
    return null;
  }
  var NUMTXT = /^[ \t\n\f\r]*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)[ \t\n\f\r]*$/;
  function textToNumber(t) {
    var m = NUMTXT.exec(t); if (!m) return null;
    var s = m[1];
    if (/^[+-]?\d+$/.test(s)) { var b = BigInt(s); if (b >= MINI && b <= MAXI) return { c: 'integer', v: b }; return { c: 'real', v: Number(s) }; }
    return { c: 'real', v: Number(s) };
  }
  function realToIntIfExact(x) {
    if (x.c !== 'real' || !isFinite(x.v) || Math.floor(x.v) !== x.v) return x;
    if (x.v >= -9223372036854775808 && x.v < 9223372036854775808) return { c: 'integer', v: BigInt(x.v) };
    return x;
  }
  function realText(x) {
    // SQLite prints reals with %!.15g: 15 significant digits, always a decimal point
    if (x === Infinity) return 'Inf'; if (x === -Infinity) return '-Inf'; if (x !== x) return 'NaN';
    if (x === 0) return '0.0';
    var e = x.toExponential(14), m = /^(-?)(\d)\.(\d+)e([+-]\d+)$/.exec(e), ex = +m[4], digs = (m[2] + m[3]).replace(/0+$/, ''), sign = m[1];
    if (digs === '') digs = '0';
    if (ex < -4 || ex >= 15) { var mant = digs.length > 1 ? digs[0] + '.' + digs.slice(1) : digs + '.0'; return sign + mant + 'e' + (ex < 0 ? '-' : '+') + (Math.abs(ex) < 10 ? '0' : '') + Math.abs(ex); }
    var out;
    if (ex >= 0) { var ip = digs.slice(0, ex + 1); while (ip.length < ex + 1) ip += '0'; var fp = digs.slice(ex + 1); out = ip + '.' + (fp === '' ? '0' : fp); }
    else out = '0.' + new Array(-ex).join('0') + digs;
    return sign + out;
  }
  function numericAffinity(v) {
    if (v.c === 'text') { var n = textToNumber(v.v); if (!n) return v; return realToIntIfExact(n); }
    if (v.c === 'real') return realToIntIfExact(v);
    return v;
  }
  // apply a column affinity to a value being stored
  function store(aff, v) {
    switch (aff) {
      case 'BLOB': return v;
      case 'TEXT':
        if (v.c === 'integer') return { c: 'text', v: String(v.v) };
        if (v.c === 'real') return { c: 'text', v: realText(v.v) };
        return v;
      case 'INTEGER': case 'NUMERIC': return numericAffinity(v);
      case 'REAL':
        var r = numericAffinity(v);
        if (r.c === 'integer') return { c: 'real', v: Number(r.v) };
        return r;
    }
    return v;
  }
  var ORDER = { null: 0, integer: 1, real: 1, text: 2, blob: 3 };
  function cmpVals(a, b) {
    if (ORDER[a.c] !== ORDER[b.c]) return ORDER[a.c] < ORDER[b.c] ? -1 : 1;
    if (a.c === 'null') return 0;
    if (a.c === 'text' || a.c === 'blob') return a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
    var x = a.c === 'integer' ? a.v : a.v, y = b.v;
    if (a.c === 'integer' && b.c === 'integer') return x < y ? -1 : x > y ? 1 : 0;
    if (a.c === 'integer' || b.c === 'integer') { // exact integer versus real
      var iv = a.c === 'integer' ? a.v : b.v, rv = a.c === 'integer' ? b.v : a.v, r;
      if (rv !== rv) r = 0; else if (rv >= 9223372036854775808) r = -1; else if (rv < -9223372036854775808) r = 1;
      else { var fl = Math.floor(rv), bf = BigInt(fl); r = iv < bf ? -1 : iv > bf ? 1 : (rv > fl ? -1 : 0); }
      return a.c === 'integer' ? r : -r;
    }
    var nx = Number(a.v), ny = Number(b.v);
    return nx < ny ? -1 : nx > ny ? 1 : 0;
  }
  // compare two stored column values; returns {cmp, applied: note}
  function compare(affA, a, affB, b) {
    // affA/affB: INTEGER, REAL, NUMERIC, TEXT, BLOB (column affinities) or NONE (a literal or expression with no affinity)
    var numA = affA === 'INTEGER' || affA === 'REAL' || affA === 'NUMERIC', numB = affB === 'INTEGER' || affB === 'REAL' || affB === 'NUMERIC', note = null;
    if (a.c === 'null' || b.c === 'null') return { cmp: null, note: 'NULL compared with anything is NULL, so the result is neither true nor false.' };
    if (numA && !numB) { b = numericAffinity(b); note = 'The other side has no numeric affinity, so NUMERIC affinity was applied to it before comparing.'; }
    else if (numB && !numA) { a = numericAffinity(a); note = 'The other side has no numeric affinity, so NUMERIC affinity was applied to it before comparing.'; }
    else if (affA === 'TEXT' && affB === 'NONE') { b = store('TEXT', b); note = 'TEXT affinity was applied to the other side before comparing.'; }
    else if (affB === 'TEXT' && affA === 'NONE') { a = store('TEXT', a); note = 'TEXT affinity was applied to the other side before comparing.'; }
    return { cmp: cmpVals(a, b), note: note, a: a, b: b };
  }
  function show(v) {
    switch (v.c) { case 'null': return 'NULL'; case 'integer': return String(v.v); case 'real': return realText(v.v); case 'text': return "'" + v.v.replace(/'/g, "''") + "'"; case 'blob': return "X'" + v.v + "'"; }
  }
  var api = { affinity: affinity, parseLiteral: parseLiteral, store: store, compare: compare, show: show };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SqliteWhy = api;
})(typeof window !== 'undefined' ? window : this);
