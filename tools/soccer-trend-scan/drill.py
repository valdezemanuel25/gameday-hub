import pickle, sys, math
rows = pickle.load(open(sys.argv[1], 'rb'))
def rec(name, f, m, split=True):
    def one(rs):
        n = w = e = v = 0; roi = 0
        for r in rs:
            if not f(r): continue
            y = [r['hg'] > r['ag'], r['hg'] == r['ag'], r['hg'] < r['ag'], r['hg'] + r['ag'] > 2.5, r['hg'] + r['ag'] < 2.5][m]
            p = (r['c3'] + r['c2'])[m]; o = [r['odds'][k] for k in 'hdaou'][m]
            n += 1; w += y; e += p; v += p * (1 - p); roi += (o - 1 if y else -1) if o else 0
        return f"n={n:4} hit {100*w/max(n,1):5.1f}% priced {100*e/max(n,1):5.1f}% z={(w-e)/math.sqrt(v) if v else 0:5.2f} roi {100*roi/max(n,1):+5.1f}%"
    s = f"{name:44} ALL {one(rows)}"
    if split: s += ' | 23-25 ' + one([r for r in rows if r['season'] in ('2324', '2425')])[0:36] + ' | 25-27 ' + one([r for r in rows if r['season'] in ('2526', '2627')])[0:36]
    print(s)
mvH = lambda r: r['c3'][0] - r['o3'][0]

rec('road price up 3+ -> ROAD win', lambda r: r['c3'][2] - r['o3'][2] >= .03, 2)
rec('home price up 3+ -> HOME win', lambda r: mvH(r) >= .03, 0)
rec('home up 3+ & over 55%+ -> Over', lambda r: mvH(r) >= .03 and r['c2'][0] >= .55, 3)
rec('home up 3+ & over <55% -> Over', lambda r: mvH(r) >= .03 and r['c2'][0] < .55, 3)
rec('home up 3+ (all) -> Over', lambda r: mvH(r) >= .03, 3)
rec('home up 2+ & over 55%+ -> Over', lambda r: mvH(r) >= .02 and r['c2'][0] >= .55, 3)
rec('over 55%+ no home move (<1) -> Over', lambda r: abs(mvH(r)) < .01 and r['c2'][0] >= .55, 3)
rec('over 55%+, road up 3+ -> Over', lambda r: r['c3'][2] - r['o3'][2] >= .03 and r['c2'][0] >= .55, 3)
rec('road lost 2+ -> Draw', lambda r: r['A']['loss'] >= 2, 1)
rec('road lost 3+ -> Draw', lambda r: r['A']['loss'] >= 3, 1)
import collections
for dv in sorted(set(r['div'] for r in rows)):
    rec('  road lost 2+ Draw '+dv, lambda r, dv=dv: r['A']['loss'] >= 2 and r['div']==dv, 1, False)
for dv in sorted(set(r['div'] for r in rows)):
    rec('  home up 3+ & over 55%+ '+dv, lambda r, dv=dv: mvH(r) >= .03 and r['c2'][0] >= .55 and r['div']==dv, 3, False)
