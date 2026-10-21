"""Does rest (back-to-back games, days of rest) add anything to the NHL v2/v4 winner and total probabilities?
Report only: nothing live changes. Reuses the model from make-nhl-seed.py (walk-forward, no peeking) and the same three
MoneyPuck game files. Rest features are fitted on two seasons and scored on the third (three folds), as extra terms next to
the model's own logit. Run: python3 tools/backtest-nhl-rest.py   (needs the CSV uploads that make-nhl-seed.py reads)."""
import math, datetime, collections, numpy as np
exec(open('/tmp/nhlbase.py').read())
res = run(1.0)
# every team's game dates (all three files, including the games the model skipped while warming up)
dates = collections.defaultdict(list)
allg = []
for sn, f in files:
    for g in load(f): allg.append(g); dates[g['h']].append(g['d']); dates[g['a']].append(g['d'])
for t in dates: dates[t] = sorted(set(dates[t]))
def rest(team, d):
    L = dates[team]; i = L.index(d)
    if i == 0: return 4
    return min((datetime.date.fromisoformat(d) - datetime.date.fromisoformat(L[i - 1])).days, 4)
rows = []
for r in res:
    a, h = r['m'].split(' @ ')
    rh, ra = rest(h, r['d']), rest(a, r['d'])
    rows.append(dict(s=r['s'], hw=r['hw'], p=r['p4'], p2=r['p2'], tot=r['tot'], l=r['l4'], bh=int(rh == 1), ba=int(ra == 1), dr=rh - ra))
print('games', len(rows), 'home back-to-back', sum(x['bh'] for x in rows), 'away back-to-back', sum(x['ba'] for x in rows))
lg = lambda p: math.log(min(max(p, 1e-4), 1 - 1e-4) / (1 - min(max(p, 1e-4), 1 - 1e-4)))
sig = lambda z: 1 / (1 + np.exp(-z))
def fit(X, y, off, l2=1.0, it=50):
    w = np.zeros(X.shape[1])
    for _ in range(it):
        z = X @ w + off; p = sig(z); g = X.T @ (p - y) + l2 * w; H = (X * (p * (1 - p))[:, None]).T @ X + l2 * np.eye(len(w)); w -= np.linalg.solve(H, g)
    return w
def ll(p, y): p = np.clip(p, 1e-6, 1 - 1e-6); return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))
seasons = sorted({x['s'] for x in rows})
for key in ('p', 'p2'):
    base = []; withr = []; acc0 = acc1 = n = 0
    for te in seasons:
        tr = [x for x in rows if x['s'] != te]; ts = [x for x in rows if x['s'] == te]
        feat = lambda L: np.array([[x['bh'], x['ba'], x['dr'] / 4] for x in L], float)
        w = fit(feat(tr), np.array([x['hw'] for x in tr], float), np.array([lg(x[key]) for x in tr]))
        y = np.array([x['hw'] for x in ts], float); p0 = np.array([x[key] for x in ts]); p1 = sig(feat(ts) @ w + np.array([lg(x[key]) for x in ts]))
        base.append(ll(p0, y) * len(ts)); withr.append(ll(p1, y) * len(ts)); n += len(ts)
        acc0 += ((p0 >= .5) == y).sum(); acc1 += ((p1 >= .5) == y).sum()
        print(f'  {key} test {te}: n={len(ts)} coefficients (home b2b, away b2b, rest diff/4) = {np.round(w, 3).tolist()}')
    print(f'WINNER {key}: log-loss model {sum(base) / n:.4f} -> with rest {sum(withr) / n:.4f}; picks right {acc0}/{n} -> {acc1}/{n}')
# totals: do tired teams change the goal total?
def mean(L): return sum(L) / len(L) if L else float('nan')
for name, sel in (('either team on a back-to-back', lambda x: x['bh'] or x['ba']), ('neither', lambda x: not (x['bh'] or x['ba']))):
    L = [x for x in rows if sel(x)]; print(f'TOTALS {name}: n={len(L)} actual goals {mean([x["tot"] for x in L]):.3f} model expected {mean([x["l"] for x in L]):.3f}')
print('home win rate: home b2b', round(mean([x['hw'] for x in rows if x['bh']]), 3), '| away b2b', round(mean([x['hw'] for x in rows if x['ba']]), 3), '| neither', round(mean([x['hw'] for x in rows if not x['bh'] and not x['ba']]), 3))
print('model p avg: home b2b', round(mean([x['p'] for x in rows if x['bh']]), 3), '| away b2b', round(mean([x['p'] for x in rows if x['ba']]), 3), '| neither', round(mean([x['p'] for x in rows if not x['bh'] and not x['ba']]), 3))
