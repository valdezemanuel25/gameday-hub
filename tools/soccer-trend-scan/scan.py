# Soccer trend rescan (Nov 11, 2026). Run: python3 hist.py ../../data/football-data hist.pkl ; python3 scan.py hist.pkl ; python3 drill.py hist.pkl
# scan.py: every condition and pair on five markets, found on 2023-25, checked on 2025-27. drill.py: the run-length and price-band tables.
import pickle, sys, numpy as np, itertools, json
rows = pickle.load(open(sys.argv[1], 'rb'))
N = len(rows)
def g(r, side, k):
    v = r[side][k]; return v
C = {}
def add(name, f): C[name] = np.array([bool(f(r)) for r in rows])
ge = lambda v, x: v is not None and v >= x
le = lambda v, x: v is not None and v <= x
for side, nm in (('H', 'home'), ('A', 'road')):
    for k, lab, ths in (('loss', 'lost last', (2, 3, 4)), ('win', 'won last', (2, 3, 4)), ('winless', 'winless in last', (4, 6)), ('unb', 'unbeaten in last', (4, 6)), ('nosc', 'failed to score in last', (2, 3)), ('cs', 'clean sheet in last', (2, 3)),
                        ('over', 'over 2.5 in last', (3, 4)), ('under', 'under 2.5 in last', (3, 4)), ('btts', 'both scored in last', (3, 4)), ('nobtts', 'not both scored in last', (3, 4)), ('scored', 'scored in last', (6,)), ('conc', 'conceded in last', (6,)), ('draw', 'drew last', (2,))):
        for t in ths: add(f'{nm} {lab} {t}+', lambda r, s=side, k=k, t=t: r[s][k] >= t)
    add(f'{nm} gf5>=10', lambda r, s=side: ge(r[s]['gf5'], 10)); add(f'{nm} gf5<=3', lambda r, s=side: le(r[s]['gf5'], 3))
    add(f'{nm} ga5>=10', lambda r, s=side: ge(r[s]['ga5'], 10)); add(f'{nm} ga5<=3', lambda r, s=side: le(r[s]['ga5'], 3))
    add(f'{nm} pts5>=11', lambda r, s=side: ge(r[s]['pts5'], 11)); add(f'{nm} pts5<=3', lambda r, s=side: le(r[s]['pts5'], 3))
    add(f'{nm} rest<=3d', lambda r, s=side: le(r[s]['rest'], 3)); add(f'{nm} rest>=10d', lambda r, s=side: ge(r[s]['rest'], 10))
    add(f'{nm} lost last by 3+', lambda r, s=side: le(r[s]['lastMargin'], -3)); add(f'{nm} won last by 3+', lambda r, s=side: ge(r[s]['lastMargin'], 3))
add('home top 4', lambda r: le(r['hr'], 4)); add('home bottom 4', lambda r: r['hr'] is not None and r['hr'] > r['nteams'] - 4)
add('road top 4', lambda r: le(r['ar'], 4)); add('road bottom 4', lambda r: r['ar'] is not None and r['ar'] > r['nteams'] - 4)
add('home ranked 8+ above', lambda r: r['hr'] is not None and r['ar'] - r['hr'] >= 8); add('road ranked 8+ above', lambda r: r['hr'] is not None and r['hr'] - r['ar'] >= 8)
add('ranks within 3', lambda r: r['hr'] is not None and abs(r['hr'] - r['ar']) <= 3)
add('both gf5+ga5 >= 16', lambda r: ge(r['H']['gf5'], 0) and ge(r['A']['gf5'], 0) and r['H']['gf5'] + r['H']['ga5'] >= 16 and r['A']['gf5'] + r['A']['ga5'] >= 16)
add('both gf5+ga5 <= 11', lambda r: ge(r['H']['gf5'], 0) and ge(r['A']['gf5'], 0) and r['H']['gf5'] + r['H']['ga5'] <= 11 and r['A']['gf5'] + r['A']['ga5'] <= 11)
for lo, hi in ((0, .25), (.25, .35), (.35, .45), (.45, .55), (.55, .65), (.65, .75), (.75, 1.01)): add(f'home price {int(lo*100)}-{int(hi*100)}%', lambda r, lo=lo, hi=hi: lo <= r['c3'][0] < hi)
add('draw price 29%+', lambda r: r['c3'][1] >= .29); add('draw price <=21%', lambda r: r['c3'][1] <= .21)
for lo, hi in ((0, .45), (.45, .5), (.5, .55), (.55, .6), (.6, .67), (.67, 1.01)): add(f'over price {int(lo*100)}-{int(hi*100)}%', lambda r, lo=lo, hi=hi: lo <= r['c2'][0] < hi)
for t in (.03, .05): 
    add(f'home price up {int(t*100)}+', lambda r, t=t: r['c3'][0] - r['o3'][0] >= t); add(f'road price up {int(t*100)}+', lambda r, t=t: r['c3'][2] - r['o3'][2] >= t)
add('draw price up 1.5+', lambda r: r['c3'][1] - r['o3'][1] >= .015); add('draw price down 1.5+', lambda r: r['c3'][1] - r['o3'][1] <= -.015)
add('over price up 3+', lambda r: r['c2'][0] - r['o2'][0] >= .03); add('over price down 3+', lambda r: r['c2'][0] - r['o2'][0] <= -.03)
add('no 1x2 move (<1)', lambda r: max(abs(r['c3'][i] - r['o3'][i]) for i in range(3)) < .01)
add('Aug-Sep', lambda r: r['date'].month in (8, 9)); add('Dec-Jan', lambda r: r['date'].month in (12, 1)); add('Apr-May', lambda r: r['date'].month in (4, 5)); add('midweek', lambda r: r['date'].weekday() in (1, 2, 3))
names = list(C); B = np.array([C[n] for n in names], dtype=np.float64).T  # N x K
y = np.array([[r['hg'] > r['ag'], r['hg'] == r['ag'], r['hg'] < r['ag'], r['hg'] + r['ag'] > 2.5, r['hg'] + r['ag'] < 2.5] for r in rows], dtype=np.float64)
p = np.array([[r['c3'][0], r['c3'][1], r['c3'][2], r['c2'][0], r['c2'][1]] for r in rows])
dec = np.array([[r['odds']['h'] or np.nan, r['odds']['d'] or np.nan, r['odds']['a'] or np.nan, r['odds']['o'] or np.nan, r['odds']['u'] or np.nan] for r in rows])
disc = np.array([r['season'] in ('2324', '2425') for r in rows]); hold = ~disc
MK = ['Home', 'Draw', 'Road', 'Over 2.5', 'Under 2.5']
def stats(mask, m):
    Bm = B[mask]; res = (y[mask, m] - p[mask, m]); var = p[mask, m] * (1 - p[mask, m])
    n = Bm.T @ Bm; R = Bm.T @ (Bm * res[:, None]); V = Bm.T @ (Bm * var[:, None]); W = Bm.T @ (Bm * y[mask, m][:, None])
    with np.errstate(divide='ignore', invalid='ignore'): z = np.where(V > 0, R / np.sqrt(V), 0)
    return n, W, R, z
found = []; tests = 0
K = len(names)
for m in range(5):
    nd, Wd, Rd, zd = stats(disc, m); nh, Wh, Rh, zh = stats(hold, m)
    for i in range(K):
        for j in range(i, K):
            if nd[i, j] < 120: continue
            tests += 1
            if zd[i, j] >= 2.0 and nh[i, j] >= 60 and zh[i, j] >= 1.5:
                found.append((m, i, j, nd[i, j], Wd[i, j], Rd[i, j], zd[i, j], nh[i, j], Wh[i, j], Rh[i, j], zh[i, j]))
print('matches', N, 'discovery', int(disc.sum()), 'holdout', int(hold.sum()), 'conditions', K, 'tests', tests, 'expected false passes ~', round(tests * 0.0228 * 0.0668, 1), 'found', len(found))
found.sort(key=lambda t: -(t[6] + t[10]))
divs = sorted(set(r['div'] for r in rows)); divarr = np.array([r['div'] for r in rows])
out = []
for m, i, j, n1, w1, r1, z1, n2, w2, r2, z2 in found:
    mask = (B[:, i] > 0) & (B[:, j] > 0); n = mask.sum(); w = y[mask, m].sum(); e = p[mask, m].sum()
    roi = np.nanmean(np.where(y[mask, m] > 0, dec[mask, m] - 1, -1))
    pos = sum(1 for d in divs if (y[mask & (divarr == d), m] - p[mask & (divarr == d), m]).sum() > 0)
    nm = names[i] if i == j else names[i] + ' & ' + names[j]
    out.append(dict(market=MK[m], cond=nm, i=names[i], j=names[j], n=int(n), w=int(w), rate=round(100 * w / n, 1), priced=round(100 * e / n, 1), roi=round(100 * roi, 1), zd=round(z1, 2), nd=int(n1), zh=round(z2, 2), nh=int(n2), leagues=pos))
    print(f"{MK[m]:10} {nm:62} n={int(n):4} hit {100*w/n:5.1f}% priced {100*e/n:5.1f}% roi {100*roi:+5.1f}% | disc n={int(n1)} z={z1:.2f} | hold n={int(n2)} z={z2:.2f} | leagues+ {pos}/7")
json.dump(dict(found=out, names=names), open('found.json', 'w'))
# also the existing two for reference
for nm, m in (('road lost last 3+', 1), ('home price up 3+', 3)):
    i = names.index(nm); 
    for lab, mask in (('disc', disc), ('hold', hold)):
        mk = mask & (B[:, i] > 0); n = mk.sum(); print('existing', nm, MK[m], lab, int(n), round(100 * y[mk, m].mean(), 1), round(100 * p[mk, m].mean(), 1))
