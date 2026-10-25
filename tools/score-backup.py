#!/usr/bin/env python3
"""Score the models in a Game Day Hub backup (the JSON from the Status tab's backup button).

Every finished game is scored once (a game saved on two days counts once), with the same three scores
the Results tab uses for the market comparison: RPS (ranked probability score), log loss and Brier,
all lower-is-better. It also checks calibration, the goals markets against always guessing the base
rate, and how each model's value bets did against the saved sportsbook price.

Run:  python3 tools/score-backup.py <backup.json>
Only the standard library is used. Numbers on a few hundred games are noisy: read them as a direction.
"""
import collections
import json
import math
import sys

MODELS = ('v2', 'v4', 'fb')


def result(c):
    h, a = c['final']['h'], c['final']['a']
    return 0 if h > a else 1 if h == a else 2


def norm(p):
    s = sum(p)
    return [x / s for x in p] if s > 0 else None


def dec(m):
    return 1 + m / 100 if m > 0 else 1 + 100 / abs(m)


def market(c):
    """Sportsbook home / draw / away chances with the margin removed, or None."""
    o = c.get('odds') or {}
    if not all(isinstance(o.get(k), (int, float)) for k in 'hda'):
        return None
    return norm([1 / dec(o[k]) for k in 'hda'])


def probs(c, m):
    if m == 'mkt':
        return market(c)
    x = c.get(m) or {}
    if m == 'v4' and x.get('promo'):  # newly promoted club: kept out of v4's totals, as on the Results tab
        return None
    return norm(x['p']) if isinstance(x.get('p'), list) else None


def score(cards, f):
    n = rps = ll = br = acc = 0
    for c in cards:
        p = f(c)
        if not p:
            continue
        r = result(c)
        n += 1
        rps += ((p[0] - (r == 0)) ** 2 + (p[0] + p[1] - (r <= 1)) ** 2) / 2
        ll -= math.log(max(p[r], 1e-6))
        br += sum((p[i] - (i == r)) ** 2 for i in range(3))
        acc += max(range(3), key=lambda i: p[i]) == r
    if not n:
        return None
    return {'n': n, 'rps': round(rps / n, 3), 'logloss': round(ll / n, 3), 'brier': round(br / n, 3), 'acc': round(acc / n, 3)}


def table(title, rows):
    print(f'\n== {title} ==')
    print(f"{'':14}{'games':>6}{'RPS':>8}{'logloss':>9}{'Brier':>8}{'acc':>7}")
    for name, s in rows:
        if s:
            print(f"{name:14}{s['n']:>6}{s['rps']:>8.3f}{s['logloss']:>9.3f}{s['brier']:>8.3f}{s['acc']:>7.1%}")


def main(path):
    d = json.load(open(path))
    seen, cards = set(), []
    for day in d.get('days', []):
        for c in day.get('cards', []):
            f = c.get('final') or {}
            if f.get('h') is None or c['id'] in seen:
                continue
            seen.add(c['id'])
            cards.append(c)
    print(f'{len(cards)} finished games in {path}')
    res = collections.Counter(result(c) for c in cards)
    base = [res[i] / len(cards) for i in range(3)]
    print('actual home / draw / away:', ' / '.join(f'{x:.0%}' for x in base))

    fn = {m: (lambda c, m=m: probs(c, m)) for m in MODELS}
    every = lambda c: all(fn[m](c) for m in MODELS)
    same = [c for c in cards if every(c)]
    blend = lambda c: norm([a + b for a, b in zip(fn['v4'](c), fn['fb'](c))])
    table('home / draw / away, each model on all its games', [(m, score(cards, fn[m])) for m in MODELS])
    table(f'same games for v2, v4 and Forebet ({len(same)})', [(m, score(same, fn[m])) for m in MODELS] + [
        ('v4+Forebet', score(same, blend)),
        ('base rates', score(same, lambda c: base)),
        ('1/3 each', score(same, lambda c: [1 / 3] * 3))])

    priced = [c for c in cards if market(c)]
    rows = [('market', score(priced, market))]
    for m in MODELS:
        sub = [c for c in priced if fn[m](c)]
        rows += [(m, score(sub, fn[m])), (f'  market, same', score(sub, market))]
    table(f'against the sportsbook price ({len(priced)} priced games)', rows)
    sub = [c for c in priced if fn['v4'](c)]
    if sub:
        best = min((sum(-math.log(max(w * fn['v4'](c)[result(c)] + (1 - w) * market(c)[result(c)], 1e-6)) for c in sub) / len(sub), w)
                   for w in [i / 20 for i in range(21)])
        print(f'best mix: {best[1]:.0%} v4 + {1 - best[1]:.0%} market (log loss {best[0]:.3f}). 0% means v4 adds nothing the price does not know.')

    print('\n== value bets: model 5+ points over the price, 1 unit at the saved price ==')
    for m in MODELS:
        n = units = hits = 0
        for c in priced:
            p = fn[m](c)
            if not p:
                continue
            q, o = market(c), c['odds']
            e = [p[i] - q[i] for i in range(3)]
            i = e.index(max(e))
            if e[i] >= 0.05:
                n += 1
                hit = result(c) == i
                hits += hit
                units += dec([o['h'], o['d'], o['a']][i]) - 1 if hit else -1
        if n:
            print(f'{m:4} {n:>4} bets, {hits} won, {units:+.2f} units ({units / n:+.1%}). Under ~300 bets this is mostly noise.')

    print('\n== favourite calibration: said vs happened ==')
    for m in MODELS:
        bins = collections.defaultdict(lambda: [0, 0, 0.0])
        for c in cards:
            p = fn[m](c)
            if not p:
                continue
            i = max(range(3), key=lambda k: p[k])
            b = bins[min(int(p[i] * 10), 8)]
            b[0] += 1
            b[1] += result(c) == i
            b[2] += p[i]
        print(m, '  '.join(f'{k * 10}%+: said {v[2] / v[0]:.0%} won {v[1] / v[0]:.0%} ({v[0]})' for k, v in sorted(bins.items())))

    print('\n== goals markets: Brier against always saying the base rate ==')
    for key, happened in (('over', lambda c: c['final']['h'] + c['final']['a'] > 2),
                          ('btts', lambda c: c['final']['h'] > 0 and c['final']['a'] > 0)):
        rate = sum(map(happened, cards)) / len(cards)
        print(f'{key}: happened {rate:.0%}')
        for m in MODELS:
            s = [((c.get(m) or {})[key] / 100, happened(c)) for c in cards if (c.get(m) or {}).get(key) is not None]
            if s:
                b = sum((p - o) ** 2 for p, o in s) / len(s)
                b0 = sum((rate - o) ** 2 for _, o in s) / len(s)
                print(f'  {m:3} {len(s):>4} games  Brier {b:.3f} vs base rate {b0:.3f}  {"skill" if b < b0 else "no skill"}')

    lp = (d.get('totals') or {}).get('leans', {}).get('pl')
    if lp:
        print(f"\nheadline picks with a price: {lp['n']} bets, {lp['won']:+.2f} units ({lp['won'] / lp['n']:+.1%})")


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
