# Reads JSON cases from stdin, runs real SQLite, prints JSON results.
import sys, json, sqlite3
cases = json.load(sys.stdin); out = []
for c in cases:
    db = sqlite3.connect(':memory:')
    try:
        if c['t'] == 'store':
            db.execute('CREATE TABLE t(x %s)' % c['decl'])
            db.execute('INSERT INTO t VALUES (%s)' % c['lit'])
            r = db.execute('SELECT typeof(x), quote(x), x FROM t').fetchone()
            out.append({'type': r[0], 'quote': str(r[1])})
        elif c['t'] == 'lit':
            db.execute('CREATE TABLE t(a %s)' % c['decl'])
            db.execute('INSERT INTO t VALUES (%s)' % c['la'])
            if c['flip']:
                r = db.execute('SELECT %s<a, %s=a, %s>a FROM t' % (c['lit'], c['lit'], c['lit'])).fetchone()
            else:
                r = db.execute('SELECT a<%s, a=%s, a>%s FROM t' % (c['lit'], c['lit'], c['lit'])).fetchone()
            out.append({'r': list(r)})
        else:
            db.execute('CREATE TABLE t(a %s, b %s)' % (c['da'], c['db']))
            db.execute('INSERT INTO t VALUES (%s, %s)' % (c['la'], c['lb']))
            r = db.execute('SELECT a<b, a=b, a>b FROM t').fetchone()
            out.append({'r': list(r)})
    except Exception as e:
        out.append({'err': str(e)})
print(json.dumps(out))
