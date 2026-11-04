"""Deterministic-frame soak across all battlefields with tactical AI on both sides.
Usage: python tests/soak_quality.py [frames, default 150000]
"""
import os,re,json,sys,time
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
html=(root/'index.html').read_text().replace(r'if (/[?&]test\b/.test(location.search))','if (true)')
html=re.sub(r'<link[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>', '', html)
frames=int(sys.argv[1]) if len(sys.argv)>1 else 150000
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path=os.getenv('CHROME','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server'])
 page=b.new_page(viewport={'width':915,'height':412});errs=[];page.on('pageerror',lambda e: errs.append(str(e)))
 page.set_content(html,wait_until='domcontentloaded')
 page.evaluate('''() => {let T=__tc;T.setManualTestMode(true);T.setAutoAll(true);T.S().aiSkill=0.66;
   window.__qa={frames:0,games:0,turns:0,moves:0,draws:0,issues:[],perMap:{},perMobile:{},prevPhase:'menu',prevTurn:0,matchups:[],finishes:[]};
   T.startGame('ai',['light','armored'],'frontier');}''')
 begin=time.time()
 js='''n => {const T=__tc,q=window.__qa, mobs=T.MOBILES;
  for(let i=0;i<n;i++){
    const g0=T.get();
    if(g0.phase==='over'){
      const id=T.map();q.perMap[id]=(q.perMap[id]||0)+1;
      q.games++;
      const winningSide=g0.tanks[0].alive&&!g0.tanks[1].alive ? 0 : g0.tanks[1].alive&&!g0.tanks[0].alive ? 1 : -1;
      if(winningSide<0)q.draws++;
      q.finishes.push({mobs:g0.tanks.map(t=>t.m.id),winningSide,map:id,shots:g0.stats.map(x=>x.shots)});
      const pairs=[];for(const a of mobs)for(const b of mobs)if(a.id!==b.id)pairs.push([a.id,b.id]);
      const [first,second]=pairs[q.games%pairs.length];
      T.startGame('ai',[first,second],T.MAPS[Math.floor(q.games/pairs.length)%3].id);
    }
    T.update(1/60);
    const g=T.get();q.frames++;
    if(g.phase==='aiMove'&&q.prevPhase!=='aiMove'){
      q.moves++; const id=g.tanks[g.cur].m.id;q.perMobile[id]=(q.perMobile[id]||0)+1;
    }
    if(g.turnCount>q.prevTurn){q.turns += g.turnCount-q.prevTurn;q.prevTurn=g.turnCount;}
    q.prevPhase=g.phase;
    if(i%250===0){
      for(const t of g.tanks){
        if(!Number.isFinite(t.x)||!Number.isFinite(t.y)||!Number.isFinite(t.hp))q.issues.push('nonfinite');
        if(t.hp<0||t.hp>t.maxHp)q.issues.push('hp out of range');
      }
      for(const st of g.stats)if(st.hits>st.shots||st.direct>st.hits)q.issues.push('stats contradiction');
    }
    if(q.issues.length>10)break;
  }
  return {...q};
 }'''
 batch=5000
 for k in range(0,frames,batch):
  data=page.evaluate(js,min(batch,frames-k))
  if data['issues']:break
  if (k+batch)%30000==0:print('progress',data['frames'],'games',data['games'],'moves',data['moves'],flush=True)
 out={'frames':data['frames'],'games':data['games'],'moves':data['moves'],'draws':data['draws'],'perMap':data['perMap'],'perMobile':data['perMobile'],'finishes':data['finishes'],'issues':data['issues'],'pageErrors':errs,'seconds':round(time.time()-begin,1)}
 print(json.dumps(out,ensure_ascii=False,indent=2),flush=True)
 (root/'qa-output'/'soak.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
 b.close()
 sys.exit(0 if not data['issues'] and not errs and data['games']>=2 else 1)
