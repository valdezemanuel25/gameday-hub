import csv,re,math,json,collections
U='/root/.claude/uploads/91bac459-927a-5b8b-9a8c-6e21253deb4a/'
files=[('2024-25','755de5fa-living_hockey_games_20242025_5v5.csv'),('2025-26','d4318d09-living_hockey_games_20252026_5v5.csv'),('2026-27','03c9a9ac-living_hockey_games_20262027_5v5.csv')]
def load(f):
    g=[]
    for r in csv.DictReader(open(U+f)):
        if r['Home/Away']!='Home':continue
        m=re.match(r'=?"?(\d+)-(\d+)\s*(\((OT|SO)\))?',r['Score'])
        h,a=int(m[1]),int(m[2]);last=m[4] or 'REG'
        th,ta=h,a
        if last=='SO': # remove shootout goal for totals
            if h>a: th-=1
            else: ta-=1
        # xG: home xGF, xGA
        fx=lambda c:'UTA' if c=='UHC' else c
        g.append(dict(d=r['Date'],h=fx(r['Team']),a=fx(r['Opponent']),hs=h,as_=a,last=last,th=th,ta=ta,xh=float(r['xGF']),xa=float(r['xGA'])))
    g.sort(key=lambda x:x['d']);return g
def pois(l,n=16):
    p=[math.exp(-l)];
    for k in range(1,n):p.append(p[-1]*l/k)
    return p
def probs(lh,la):
    ph,pa=pois(lh),pois(la);win=tie=0;tot=[0]*40
    for i,x in enumerate(ph):
        for j,y in enumerate(pa):
            if i>j:win+=x*y
            elif i==j:tie+=x*y
            tot[i+j]+=x*y
    return win+tie*0.5,sum(tot[6:])

GF=['c1029034-goalies_2008_to_2024.csv','d96a2aea-Goalies25.csv','56e8929c-goalies.csv']
gl=collections.defaultdict(dict)  # pid -> season -> (xg,g,sh)
gp=collections.defaultdict(dict)  # (team,season) -> pid -> gp
for f in GF:
    for r in csv.DictReader(open(U+f)):
        if r['situation']!='all':continue
        se=int(r['season']);pid=r['playerId']
        gl[pid][se]=(float(r['xGoals']),float(r['goals']),float(r['ongoal']))
        gp[(r['team'],se)][pid]=int(r['games_played'])
def skill(pid,se,K=1200):
    xg=g_=sh=0
    for y,(a,b,c) in gl[pid].items():
        if y<se: xg+=a;g_+=b;sh+=c
    return (xg-g_)/(sh+K)   # goals saved above expected per shot, shrunk to 0
def gadj(team,season_start):
    team={'UHC':'UTA'}.get(team,team)
    d=gp.get((team,season_start),{})
    tot=sum(d.values())
    if not tot:return 0.0
    return sum(skill(p,season_start)*n for p,n in d.items())/tot*29.0   # goals/game saved vs expected
HOME=1.05
class T: pass
def run(G=0.0):
    res=[];prior={};elo=collections.defaultdict(lambda:1500.0)
    for si,(sn,f) in enumerate(files):
        games=load(f);ss=int(sn[:4])
        if si==2: global P0;P0=dict(prior)
        st=collections.defaultdict(lambda:dict(n=0,gf=0,ga=0,xf=0,xa=0))
        lg=dict(n=0,g=0,x=0)
        if si>0:
            for t in elo:elo[t]=1500+(elo[t]-1500)*(2/3)
        for k,g in enumerate(games):
            L=(lg['g']/lg['n']/2) if lg['n']>20 else (prior.get('lg',3.0))
            LX=(lg['x']/lg['n']/2) if lg['n']>20 else prior.get('lgx',2.7)
            def rate(t,key,pk,lgv,N0=25):
                s=st[t];p=prior.get(t,{}).get(pk,lgv)
                p=lgv+(p-lgv)*0.5
                return (s[key]+N0*p)/(s['n']+N0)
            gfh=rate(g['h'],'gf','gf',L);gah=rate(g['h'],'ga','ga',L);gfa=rate(g['a'],'gf','gf',L);gaa=rate(g['a'],'ga','ga',L)
            lh=L*(gfh/L)*(gaa/L)*HOME;la=L*(gfa/L)*(gah/L)/HOME
            lh=max(0.5,lh-G*gadj(g['h'],ss));la=max(0.5,la-G*gadj(g['a'],ss))
            p2,o2=probs(lh,la)
            xfh=rate(g['h'],'xf','xf',LX);xah=rate(g['h'],'xa','xa',LX);xfa=rate(g['a'],'xf','xf',LX);xaa=rate(g['a'],'xa','xa',LX)
            xlh=LX*(xfh/LX)*(xaa/LX)*HOME*(L/LX);xla=LX*(xfa/LX)*(xah/LX)/HOME*(L/LX)
            xlh=max(0.5,xlh-G*gadj(g['h'],ss));xla=max(0.5,xla-G*gadj(g['a'],ss))
            px,ox=probs(xlh,xla)
            pe=1/(1+10**(-(elo[g['h']]+35-elo[g['a']])/400))
            p4=(pe+px+p2)/3*1.0
            p4=0.4*pe+0.3*px+0.3*p2
            lh4=0.5*lh+0.5*xlh;la4=0.5*la+0.5*xla
            _,o4=probs(lh4,la4)
            hw=1 if g['hs']>g['as_'] else 0
            tot=g['th']+g['ta']
            ready=(si>0) or k>=300
            if ready: res.append(dict(s=sn,d=g['d'],m=f"{g['a']} @ {g['h']}",hw=hw,tot=tot,p2=p2,p4=p4,pe=pe,px=px,o2=o2,o4=o4,ox=ox,l2=lh+la,l4=lh4+la4))
            # update
            for t,gf,ga,xf,xa in((g['h'],g['th'],g['ta'],g['xh'],g['xa']),(g['a'],g['ta'],g['th'],g['xa'],g['xh'])):
                s=st[t];s['n']+=1;s['gf']+=gf;s['ga']+=ga;s['xf']+=xf;s['xa']+=xa
            lg['n']+=1;lg['g']+=g['th']+g['ta'];lg['x']+=g['xh']+g['xa']
            mult=math.log(abs(g['hs']-g['as_'])+1)+1
            k_=6*mult*(1 if g['last']=='REG' else 0.6)
            elo[g['h']]+=k_*(hw-pe);elo[g['a']]-=k_*(hw-pe)
        if si==2: pass
        prior={t:dict(gf=s['gf']/s['n'],ga=s['ga']/s['n'],xf=s['xf']/s['n'],xa=s['xa']/s['n']) for t,s in st.items()}
        prior['lg']=lg['g']/lg['n']/2;prior['lgx']=lg['x']/lg['n']/2
    global FIN;FIN=dict(st=st,lg=lg,elo=dict(elo),through=max(g['d'] for g in games))
    return res

import sys
run(1.0)
teams={}
for t,sv in FIN['st'].items():
    p=P0.get(t,{})
    teams[t]=dict(n=sv['n'],gf=sv['gf'],ga=sv['ga'],xf=round(sv['xf'],2),xa=round(sv['xa'],2),
      pgf=round(p.get('gf',P0['lg']),4),pga=round(p.get('ga',P0['lg']),4),pxf=round(p.get('xf',P0['lgx']),4),pxa=round(p.get('xa',P0['lgx']),4),
      elo=round(FIN['elo'][t],1),g=round(gadj(t,2026),4))
out=dict(through=FIN['through'],lg=FIN['lg'],plg=round(P0['lg'],4),plgx=round(P0['lgx'],4),teams=teams)
print(out['through'],len(teams),out['lg'])
open('seed.json','w').write(json.dumps(out,separators=(',',':')))
