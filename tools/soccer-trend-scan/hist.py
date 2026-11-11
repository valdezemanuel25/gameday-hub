# Builds one row per historical match with pre-match state and prices. Usage: python3 -I hist.py <football-data dir> <out.pkl>
import csv, glob, os, sys, pickle, datetime, collections
src, out = sys.argv[1], sys.argv[2]
def fl(r, *ks):
    for k in ks:
        v = r.get(k)
        try:
            v = float(v)
            if v > 1: return v
        except (TypeError, ValueError): pass
    return None
def nv(*o):
    if any(x is None for x in o): return None
    p = [1 / x for x in o]; t = sum(p); return [x / t for x in p]
rows = []
for f in sorted(glob.glob(os.path.join(src, '*.csv'))):
    season, div = os.path.basename(f)[:-4].split('_')
    ms = []
    for r in csv.DictReader(open(f, encoding='utf-8-sig', errors='replace')):
        try: d = datetime.datetime.strptime(r['Date'], '%d/%m/%Y'); hg, ag = int(r['FTHG']), int(r['FTAG'])
        except Exception: continue
        ms.append((d, r, hg, ag))
    ms.sort(key=lambda x: x[0])
    T = collections.defaultdict(list)  # team -> list of dict(home, gf, ga, date)
    for d, r, hg, ag in ms:
        h, a = r['HomeTeam'], r['AwayTeam']
        def state(t):
            g = T[t]
            def run(pred):
                n = 0
                for x in reversed(g):
                    if pred(x): n += 1
                    else: break
                return n
            l5 = g[-5:]
            s = dict(gp=len(g), loss=run(lambda x: x['gf'] < x['ga']), win=run(lambda x: x['gf'] > x['ga']), draw=run(lambda x: x['gf'] == x['ga']), unb=run(lambda x: x['gf'] >= x['ga']), winless=run(lambda x: x['gf'] <= x['ga']),
                     nosc=run(lambda x: x['gf'] == 0), cs=run(lambda x: x['ga'] == 0), scored=run(lambda x: x['gf'] > 0), conc=run(lambda x: x['ga'] > 0), over=run(lambda x: x['gf'] + x['ga'] > 2.5), under=run(lambda x: x['gf'] + x['ga'] < 2.5), btts=run(lambda x: x['gf'] > 0 and x['ga'] > 0), nobtts=run(lambda x: x['gf'] == 0 or x['ga'] == 0),
                     rest=(d - g[-1]['date']).days if g else None, lastHome=g[-1]['home'] if g else None,
                     lastMargin=(g[-1]['gf'] - g[-1]['ga']) if g else None)
            if len(l5) == 5: s.update(gf5=sum(x['gf'] for x in l5), ga5=sum(x['ga'] for x in l5), pts5=sum(3 if x['gf'] > x['ga'] else 1 if x['gf'] == x['ga'] else 0 for x in l5), sot5=None)
            else: s.update(gf5=None, ga5=None, pts5=None)
            return s
        # table rank
        tab = sorted(T.keys(), key=lambda t: (-sum(3 if x['gf'] > x['ga'] else 1 if x['gf'] == x['ga'] else 0 for x in T[t]), -sum(x['gf'] - x['ga'] for x in T[t]), -sum(x['gf'] for x in T[t])))
        rk = {t: i + 1 for i, t in enumerate(tab)}
        hs, as_ = state(h), state(a)
        mingp = min(hs['gp'], as_['gp'])
        c3 = nv(fl(r, 'PSCH', 'AvgCH', 'B365CH'), fl(r, 'PSCD', 'AvgCD', 'B365CD'), fl(r, 'PSCA', 'AvgCA', 'B365CA'))
        o3 = nv(fl(r, 'PSH', 'AvgH', 'B365H'), fl(r, 'PSD', 'AvgD', 'B365D'), fl(r, 'PSA', 'AvgA', 'B365A'))
        c2 = nv(fl(r, 'PC>2.5', 'AvgC>2.5', 'B365C>2.5'), fl(r, 'PC<2.5', 'AvgC<2.5', 'B365C<2.5'))
        o2 = nv(fl(r, 'P>2.5', 'Avg>2.5', 'B365>2.5'), fl(r, 'P<2.5', 'Avg<2.5', 'B365<2.5'))
        rows.append(dict(season=season, div=div, date=d, home=h, away=a, hg=hg, ag=ag, H=hs, A=as_, hr=rk.get(h) if mingp >= 5 else None, ar=rk.get(a) if mingp >= 5 else None, nteams=len(tab),
                         c3=c3, o3=o3, c2=c2, o2=o2, odds=dict(h=fl(r, 'AvgCH', 'B365CH'), d=fl(r, 'AvgCD', 'B365CD'), a=fl(r, 'AvgCA', 'B365CA'), o=fl(r, 'AvgC>2.5', 'B365C>2.5'), u=fl(r, 'AvgC<2.5', 'B365C<2.5'))))
        T[h].append(dict(home=True, gf=hg, ga=ag, date=d)); T[a].append(dict(home=False, gf=ag, ga=hg, date=d))
pickle.dump(rows, open(out, 'wb'))
print(len(rows), collections.Counter(r['season'] for r in rows), sum(1 for r in rows if r['c3'] and r['o3']), sum(1 for r in rows if r['c2'] and r['o2']))
