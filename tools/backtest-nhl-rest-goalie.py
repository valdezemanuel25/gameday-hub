"""Does rest (back-to-backs) or a backup goalie in net change how an NHL game goes, once team strength is taken out?
Behind the v5 shadow in src/nhl.js (B2B_OWN, B2B_OPP, BACKUP_OPP, B2B_LOGIT, BACKUP_LOGIT). Report only: nothing live changes.
Input: MoneyPuck's game-by-game goalie files (moneypuck.com/data.htm, the "goalies" zips: 2008_to_2024.csv, 2025.csv, 2026.csv).
Walk-forward: team strength = season-to-date goal difference per game (with last season's as a 20-game prior), goalie quality = shrunk
prior goals saved above expected; "backup" = the starter is not the team's most-used goalie so far this season (after 8 team games).
Goals are the goalies' goals against (empty-net goals and shootout goals are not in them). Needs numpy.
Run: python3 tools/backtest-nhl-rest-goalie.py 2008_to_2024.csv 2025.csv 2026.csv"""
import csv, sys, math, datetime, collections
import numpy as np
files = sys.argv[1:]
# game -> per-team goalie rows
games=collections.defaultdict(lambda:{'d':None,'s':None,'T':{}})
for f in files:
    for r in csv.DictReader(open(f)):
        if r['situation']!='all' or r['gameId'][4:6]!='02': continue
        g=games[r['gameId']]; g['d']=r['gameDate']; g['s']=int(r['season'])
        t=r['playerTeam']; side=r['home_or_away']
        g['T'].setdefault(t,{'side':side,'gl':[]})['gl'].append((r['playerId'],float(r['icetime']),float(r['goals']),float(r['xGoals']),float(r['ongoal'])))
G=[]
for gid,g in games.items():
    if len(g['T'])!=2: continue
    ts=list(g['T'].items())
    h=[t for t in ts if t[1]['side']=='HOME']; a=[t for t in ts if t[1]['side']=='AWAY']
    if len(h)!=1 or len(a)!=1: continue
    (ht,hd),(at,ad)=h[0],a[0]
    ga=lambda d:sum(x[2] for x in d['gl']); xg=lambda d:sum(x[3] for x in d['gl'])
    st=lambda d:max(d['gl'],key=lambda x:x[1])[0]
    G.append(dict(id=gid,d=datetime.date(int(g['d'][:4]),int(g['d'][4:6]),int(g['d'][6:])),s=g['s'],h=ht,a=at,
        hgf=ga(ad),agf=ga(hd),hxga=xg(hd),axga=xg(ad),hst=st(hd),ast=st(ad),
        hgl=hd['gl'],agl=ad['gl']))
G.sort(key=lambda x:(x['d'],x['id']))
print("games",len(G),"seasons",min(x['s'] for x in G),"-",max(x['s'] for x in G))
# --- walk forward: team rating, rest, goalie quality
last=collections.defaultdict(lambda:None)   # team -> last date
gd=collections.defaultdict(lambda:[0.0,0]) # (team,season)->[sum GD,n]
prev=collections.defaultdict(float)         # team -> prev season GD/game
gsum=collections.defaultdict(lambda:[0.0,0.0]) # goalie -> [sum (xg-ga), shots]  prior games
gp=collections.defaultdict(lambda:collections.defaultdict(int)) # (team,season)->goalie->games started
rows=[]; curS=None
for x in G:
    if x['s']!=curS:
        for (t,s),(sm,n) in list(gd.items()):
            if s==curS and n>0: prev[t]=sm/n
        curS=x['s']; last.clear()
    def rest(t):
        l=last[t]
        return 5 if l is None else min((x['d']-l).days,5)
    rh,ra=rest(x['h']),rest(x['a'])
    def rate(t):
        sm,n=gd[(t,x['s'])]; return (sm+20*prev[t]*0.6)/(n+20)
    K=600.0
    def gq(gl_pid):
        sm,sh=gsum[gl_pid]; return (sm/(sh+K))*100   # shrunk GSAx per 100 shots, prior games only
    hq=gq(x['hst']); aq=gq(x['ast'])
    # backup: starter is not the team's most-used goalie so far this season (needs >=8 team games)
    def isbackup(t,pid):
        c=gp[(t,x['s'])]; n=sum(c.values())
        if n<8: return 0
        top=max(c,key=c.get); return int(pid!=top)
    hb,ab=isbackup(x['h'],x['hst']),isbackup(x['a'],x['ast'])
    nh=gd[(x['h'],x['s'])][1]; na=gd[(x['a'],x['s'])][1]
    rows.append(dict(s=x['s'],margin=x['hgf']-x['agf'],tot=x['hgf']+x['agf'],hw=int(x['hgf']>x['agf']) if x['hgf']!=x['agf'] else None,
        r=rate(x['h'])-rate(x['a']),rh=rh,ra=ra,hq=hq,aq=aq,hb=hb,ab=ab,nh=nh,na=na,
        rsum=rate(x['h'])+rate(x['a'])))
    # update
    mg=x['hgf']-x['agf']
    gd[(x['h'],x['s'])][0]+=mg; gd[(x['h'],x['s'])][1]+=1
    gd[(x['a'],x['s'])][0]-=mg; gd[(x['a'],x['s'])][1]+=1
    last[x['h']]=x['d']; last[x['a']]=x['d']
    for side,t,gl in (('h',x['h'],x['hgl']),('a',x['a'],x['agl'])):
        pid=max(gl,key=lambda z:z[1])[0]; gp[(t,x['s'])][pid]+=1
        for (p,ic,ga_,xg_,sh) in gl:
            gsum[p][0]+=xg_-ga_; gsum[p][1]+=sh
R = rows
print('rows', len(R))

def ols(X,y,names):
    X=np.column_stack([np.ones(len(y)),X]); b,res,rk,sv=np.linalg.lstsq(X,y,rcond=None)
    e=y-X@b; s2=e@e/(len(y)-X.shape[1]); se=np.sqrt(np.diag(s2*np.linalg.inv(X.T@X)))
    for n,bb,ss in zip(['const']+names,b,se): print("   %-26s %7.3f  (se %.3f, t=%5.1f)"%(n,bb,ss,bb/ss))
    return b
def logit(X,y,names,it=30):
    X=np.column_stack([np.ones(len(y)),X]); w=np.zeros(X.shape[1])
    for _ in range(it):
        p=1/(1+np.exp(-X@w)); g=X.T@(y-p); H=(X*(p*(1-p))[:,None]).T@X; w+=np.linalg.solve(H,g)
    se=np.sqrt(np.diag(np.linalg.inv(H)))
    for n,bb,ss in zip(['const']+names,w,se): print("   %-26s %7.3f  (se %.3f, t=%5.1f)"%(n,bb,ss,bb/ss))
    return w
A=[r for r in R if r['nh']>=10 and r['na']>=10 and r['s']>=2012]
print("games used (both teams >=10 played, 2012+):",len(A))
f=lambda k:np.array([r[k] for r in A],float)
b2bh=(f('rh')==1).astype(float); b2ba=(f('ra')==1).astype(float)
gdiff=(f('hq')-f('aq'))*0.28
y=f('margin'); tot=f('tot')
print("\nHome goal margin ~ rating diff + back-to-backs + goalie quality + backup in net")
ols(np.column_stack([f('r'),b2bh,b2ba,gdiff,f('hb'),f('ab')]),y,['rating diff (goals)','home on b2b','away on b2b','goalie diff (goals/g)','home backup in net','away backup in net'])
print("\nShare of games: home b2b %.1f%%  away b2b %.1f%%  home backup %.1f%%  away backup %.1f%%"%(100*b2bh.mean(),100*b2ba.mean(),100*f('hb').mean(),100*f('ab').mean()))
print("\nBackup in net AND on a back-to-back: home %.1f%% of b2b games, away %.1f%%"%(100*f('hb')[b2bh==1].mean(),100*f('ab')[b2ba==1].mean()))
print("\nTotal goals ~ b2b + goalie quality (sum) + backups")
gsum=-((f('hq')+f('aq'))*0.28)
ols(np.column_stack([f('rsum'),b2bh+b2ba,-gsum,f('hb')+f('ab')]),tot,['team strength sum','# teams on b2b','goalie quality sum (g/g)','# backups in net'])
# winner (excluding ties = shootout games where goalie goals tie)
W=[r for r in A if r['hw'] is not None]
g=lambda k:np.array([r[k] for r in W],float)
print("\nLogit home win (games decided in regulation/OT by goalie-credited goals, n=%d)"%len(W))
logit(np.column_stack([g('r'),(g('rh')==1)*1.0,(g('ra')==1)*1.0,(g('hq')-g('aq'))*0.28,g('hb'),g('ab')]),g('hw'),['rating diff','home b2b','away b2b','goalie diff','home backup','away backup'])
# raw home-win rate by rest situation
print("\nRaw home win rate by rest situation (decided games):")
for lab,m in (('home b2b, away rested',(g('rh')==1)&(g('ra')>1)),('home rested, away b2b',(g('rh')>1)&(g('ra')==1)),('both rested',(g('rh')>1)&(g('ra')>1)),('both b2b',(g('rh')==1)&(g('ra')==1))):
    print("   %-24s n=%5d  home wins %.1f%%"%(lab,m.sum(),100*g('hw')[m].mean()))
# by season consistency of the away-b2b effect
print("\nAway-on-b2b effect on home margin, by era:")
for lo,hi in ((2012,2016),(2017,2021),(2022,2026)):
    S=[r for r in A if lo<=r['s']<=hi]; h=lambda k:np.array([r[k] for r in S],float)
    X=np.column_stack([h('r'),(h('rh')==1)*1.,(h('ra')==1)*1.]); 
    Xc=np.column_stack([np.ones(len(S)),X]); b=np.linalg.lstsq(Xc,h('margin'),rcond=None)[0]
    print("   %d-%d n=%d  home b2b %+.3f  away b2b %+.3f goals"%(lo,hi,len(S),b[2],b[3]))
