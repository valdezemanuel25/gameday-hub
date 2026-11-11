# BTTS trend scan. The history files have no BTTS prices, so each match's BTTS chance is rebuilt from its closing 1X2 and Over 2.5 prices
# (a fit on 2023-25), and a condition is judged against that. Usage: python3 -I btts.py hist.pkl
import pickle, sys, numpy as np, math, json
rows = pickle.load(open(sys.argv[1], 'rb')); N = len(rows)
y = np.array([r['hg'] > 0 and r['ag'] > 0 for r in rows], float)
lg = lambda p: np.log(p / (1 - p))
po = np.array([r['c2'][0] for r in rows]); ph = np.array([r['c3'][0] for r in rows]); pa = np.array([r['c3'][2] for r in rows]); pdw = np.array([r['c3'][1] for r in rows])
X = np.column_stack([np.ones(N), lg(po), np.abs(ph - pa), (ph - pa) ** 2, pdw])
disc = np.array([r['season'] in ('2324', '2425') for r in rows]); hold = ~disc
b = np.zeros(X.shape[1])
for _ in range(50):
    p = 1 / (1 + np.exp(-X[disc] @ b)); g = X[disc].T @ (y[disc] - p); H = (X[disc] * (p * (1 - p))[:, None]).T @ X[disc]; b += np.linalg.solve(H, g)
p = 1 / (1 + np.exp(-X @ b))
print('baseline coef', np.round(b, 3), '| BTTS rate', round(y.mean() * 100, 1), '| brier fit', round(((p - y) ** 2)[disc].mean(), 4), 'hold', round(((p - y) ** 2)[hold].mean(), 4), 'const .25')
for lo, hi in ((0, .4), (.4, .47), (.47, .53), (.53, .6), (.6, 1)):
    m = hold & (p >= lo) & (p < hi); print(f'  holdout calibration {lo}-{hi}: n={m.sum()} said {100*p[m].mean():.1f}% got {100*y[m].mean():.1f}%')
json.dump(dict(b=b.tolist()), open('btts_base.json', 'w'))
C = {}
def add(name, f): C[name] = np.array([bool(f(r)) for r in rows])
ge = lambda v, x: v is not None and v >= x
le = lambda v, x: v is not None and v <= x
for side, nm in (('H', 'home'), ('A', 'road')):
    for k, lab, ths in (('btts', 'both scored in last', (2, 3, 4, 5)), ('nobtts', 'not both scored in last', (2, 3, 4)), ('nosc', 'failed to score in last', (1, 2, 3)), ('cs', 'clean sheet in last', (1, 2, 3)), ('scored', 'scored in last', (4, 6, 8)), ('conc', 'conceded in last', (4, 6, 8)),
                        ('over', 'over 2.5 in last', (3, 4)), ('under', 'under 2.5 in last', (3, 4)), ('loss', 'lost last', (2, 3)), ('win', 'won last', (2, 3)), ('winless', 'winless in last', (4, 6)), ('unb', 'unbeaten in last', (4, 6)), ('draw', 'drew last', (1, 2))):
        for t in ths: add(f'{nm} {lab} {t}+', lambda r, s=side, k=k, t=t: r[s][k] >= t)
    for k, hi, lo in (('gf5', 9, 3), ('ga5', 9, 3), ('pts5', 11, 3)):
        add(f'{nm} {k}>={hi}', lambda r, s=side, k=k, hi=hi: ge(r[s][k], hi)); add(f'{nm} {k}<={lo}', lambda r, s=side, k=k, lo=lo: le(r[s][k], lo))
    add(f'{nm} rest<=3d', lambda r, s=side: le(r[s]['rest'], 3))
add('home top 4', lambda r: le(r['hr'], 4)); add('home bottom 4', lambda r: r['hr'] is not None and r['hr'] > r['nteams'] - 4)
add('road top 4', lambda r: le(r['ar'], 4)); add('road bottom 4', lambda r: r['ar'] is not None and r['ar'] > r['nteams'] - 4)
add('ranks within 3', lambda r: r['hr'] is not None and abs(r['hr'] - r['ar']) <= 3)
for lo, hi in ((0, .3), (.3, .45), (.45, .6), (.6, .72), (.72, 1.01)): add(f'home price {int(lo*100)}-{int(hi*100)}%', lambda r, lo=lo, hi=hi: lo <= r['c3'][0] < hi)
for lo, hi in ((0, .45), (.45, .52), (.52, .6), (.6, .67), (.67, 1.01)): add(f'over price {int(lo*100)}-{int(hi*100)}%', lambda r, lo=lo, hi=hi: lo <= r['c2'][0] < hi)
add('draw price 28%+', lambda r: r['c3'][1] >= .28)
add('home price up 3+', lambda r: r['c3'][0] - r['o3'][0] >= .03); add('road price up 3+', lambda r: r['c3'][2] - r['o3'][2] >= .03)
add('over price up 3+', lambda r: r['c2'][0] - r['o2'][0] >= .03); add('over price down 3+', lambda r: r['c2'][0] - r['o2'][0] <= -.03)
add('Aug-Sep', lambda r: r['date'].month in (8, 9)); add('Apr-May', lambda r: r['date'].month in (4, 5)); add('midweek', lambda r: r['date'].weekday() in (1, 2, 3))
names = list(C); B = np.array([C[n] for n in names], float).T; K = len(names)
def st(mask):
    Bm = B[mask]; res = y[mask] - p[mask]; var = p[mask] * (1 - p[mask])
    n = Bm.T @ Bm; R = Bm.T @ (Bm * res[:, None]); V = Bm.T @ (Bm * var[:, None]); W = Bm.T @ (Bm * y[mask][:, None]); E = Bm.T @ (Bm * p[mask][:, None])
    with np.errstate(divide='ignore', invalid='ignore'): z = np.where(V > 0, R / np.sqrt(V), 0)
    return n, W, E, z
nd, Wd, Ed, zd = st(disc); nh, Wh, Eh, zh = st(hold); na, Wa, Ea, za = st(np.ones(N, bool))
divarr = np.array([r['div'] for r in rows]); divs = sorted(set(divarr))
tests = 0; out = []
for i in range(K):
    for j in range(i, K):
        if nd[i, j] < 120 or nh[i, j] < 60: continue
        tests += 1
        if abs(zd[i, j]) >= 2.0 and abs(zh[i, j]) >= 1.5 and zd[i, j] * zh[i, j] > 0: out.append((i, j))
print('conditions', K, 'tests', tests, 'pass loose bar', len(out), 'luck ~', round(tests * 2 * 0.0228 * 0.0668, 1), '| pass strict (2.8 & 1.8)', sum(1 for i, j in out if abs(zd[i, j]) >= 2.8 and abs(zh[i, j]) >= 1.8), 'luck ~', round(tests * 2 * 0.00256 * 0.036, 1))
out.sort(key=lambda t: -abs(za[t]))
for i, j in out[:24]:
    mask = (B[:, i] > 0) & (B[:, j] > 0); pos = sum(1 for d in divs if ((y - p)[mask & (divarr == d)].sum() > 0) == (za[i, j] > 0))
    nm = names[i] if i == j else names[i] + ' & ' + names[j]
    side = 'Yes' if za[i, j] > 0 else 'No '
    w, e, n = Wa[i, j], Ea[i, j], na[i, j]
    print(f"BTTS {side} {nm:66} n={int(n):4} both scored {100*w/n:5.1f}% expected {100*e/n:5.1f}% z={za[i,j]:5.2f} | 23-25 n={int(nd[i,j])} z={zd[i,j]:5.2f} | 25-27 n={int(nh[i,j])} z={zh[i,j]:5.2f} | leagues {pos}/7")
print('--- singles of interest')
for nm in names:
    i = names.index(nm)
    if abs(za[i, i]) >= 1.8 and na[i, i] >= 150: print(f"  {nm:40} n={int(na[i,i]):4} {100*Wa[i,i]/na[i,i]:5.1f}% exp {100*Ea[i,i]/na[i,i]:5.1f}% z={za[i,i]:5.2f} | disc z={zd[i,i]:5.2f} hold z={zh[i,i]:5.2f}")
