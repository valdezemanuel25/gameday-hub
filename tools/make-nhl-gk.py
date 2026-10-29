"""Seeds src/nhlgk.js: how many games each goalie has started for each NHL team this season (the starter = the goalie with the most
ice time in the game). The Hub uses it to tell a team's usual starter from a backup. MoneyPuck game-by-game goalie file for the
current season (the '2026.csv' inside its goalies zip). Run: python3 tools/make-nhl-gk.py /path/to/2026.csv > src/nhlgk.js"""
import csv, sys, json, re, unicodedata, collections
key = lambda s: re.sub(r'[^a-z]', '', unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode().lower())
games = collections.defaultdict(dict)
last = ''
for r in csv.DictReader(open(sys.argv[1])):
    if r['situation'] != 'all' or r['gameId'][4:6] != '02': continue
    t = r['playerTeam']; ice = float(r['icetime']); last = max(last, r['gameDate'])
    cur = games[r['gameId']].get(t)
    if cur is None or ice > cur[0]: games[r['gameId']][t] = (ice, key(r['name']))
counts = collections.defaultdict(lambda: collections.defaultdict(int))
for g in games.values():
    for t, (ice, k) in g.items(): counts[t][k] += 1
through = f'{last[:4]}-{last[4:6]}-{last[6:]}'
print('// Goalie starts per team this season, from tools/make-nhl-gk.py. Games after `through` are added as finished cards come in.')
print('export default ' + json.dumps({'through': through, 'counts': {t: dict(sorted(c.items(), key=lambda x: -x[1])) for t, c in sorted(counts.items())}}, separators=(',', ':')) + ';')
