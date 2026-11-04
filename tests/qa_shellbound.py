"""SHELLBOUND targeted quality checks. Uses Chromium and an inline copy of the released HTML.
Set CHROME=/path/to/chrome to use an existing browser binary.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json, re, os, sys, time
ROOT=Path(__file__).parent.parent
(ROOT/'qa-output').mkdir(parents=True,exist_ok=True)
html=(ROOT/'index.html').read_text()
html=html.replace(r'if (/[?&]test\b/.test(location.search))', 'if (true)')
html=re.sub(r'<link[^>]+(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^>]*>', '', html)
results=[]
def check(name,passed,details=''):
    results.append((name,bool(passed),details))
    print(('PASS' if passed else 'FAIL') + ' ' + name + (' — ' + str(details)[:150] if details else ''),flush=True)
with sync_playwright() as p:
  b=p.chromium.launch(headless=True, **({'executable_path': os.environ['CHROME']} if os.getenv('CHROME') else {}), args=['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server','--disable-extensions'])
  for touch,w,h in [(False,1280,720),(True,915,412),(True,658,320),(True,780,360)]:
    ctx=b.new_context(viewport={'width':w,'height':h},device_scale_factor=1,has_touch=touch,is_mobile=touch)
    page=ctx.new_page();errs=[];page.on('pageerror',lambda e: errs.append(str(e)))
    page.set_content(html,wait_until='domcontentloaded'); page.wait_for_timeout(300)
    fn=f'{w}x{h}-'+('touch' if touch else 'desktop')
    if (w,h)==(1280,720):
      check('name and tank roster',page.title().startswith('SHELLBOUND') and page.evaluate('window.__tc.MOBILES.map(x=>x.name)')==['스카우트','타이탄','코멧','드릴러'])
    check('map selector exists '+fn, page.locator('#map-choice option').count()==4)
    page.locator('#map-choice').select_option('canyon')
    page.locator('[data-mode="ai"]').click()
    page.locator('[data-mob="light"]').click()
    check('map choice applied '+fn, page.evaluate('window.__tc.map()')=='canyon')
    page.wait_for_timeout(200)
    page.screenshot(path=str(ROOT/'qa-output'/(f'battle-{fn}.png')), animations='disabled')
    data=page.evaluate('''() => {
       const w=innerWidth,h=innerHeight;
       const els=[...document.querySelectorAll('#console button,#hud-top button')].filter(b=>b.getBoundingClientRect().width>0 && !b.disabled && getComputedStyle(b).visibility!=='hidden');
       const overflow=els.filter(b=>{const r=b.getBoundingClientRect();return r.left < -1 || r.right > w+1 || r.top < -1 || r.bottom >h+1}).map(b=>({text:b.textContent.trim(),r:b.getBoundingClientRect().toJSON()}));
       const con=document.querySelector('#console').getBoundingClientRect(), top=document.querySelector('#hud-top').getBoundingClientRect();
       return {overflow, playArea:con.top-top.bottom, consoleHeight:con.height,topHeight:top.height, btns:els.filter(b=>b.matches('[data-hold]')).map(b=>[b.getBoundingClientRect().width,b.getBoundingClientRect().height])};
     }''')
    check('screen controls inside viewport '+fn, not data['overflow'],data)
    if touch: check('finger controls >=40px '+fn,all(a>=40 and c>=40 for a,c in data['btns']),data['btns'])
    check('play area at least 140px '+fn, data['playArea']>=140,round(data['playArea'],1))
    # short tap should cancel, never spend ammunition or self-damage
    page.evaluate("window.__tc.startGame('duo',['light','armored'],'frontier')")
    page.locator('#btn-fire').dispatch_event('pointerdown',{'pointerId':12,'button':0})
    page.locator('#btn-fire').dispatch_event('pointerup',{'pointerId':12,'button':0})
    short=page.evaluate('''() => {const g=window.__tc.get();return {phase:g.phase,shots:g.stats[0].shots,hp:g.tanks[0].hp}}''')
    check('tap cancels zero-power fire '+fn,short=={'phase':'aim','shots':0,'hp':90},short)
    # held power actually fires
    page.locator('#btn-fire').dispatch_event('pointerdown',{'pointerId':13,'button':0})
    page.evaluate('window.__tc.update(0.3)')
    page.locator('#btn-fire').dispatch_event('pointerup',{'pointerId':13,'button':0})
    long=page.evaluate('''() => {const g=window.__tc.get();return {phase:g.phase,shots:g.stats[0].shots}}''')
    check('held fire launches '+fn,long['shots']==1 and long['phase']=='flying',long)
    # damage, timer and pause use test interface
    page.evaluate("window.__tc.startGame('duo',['light','armored'],'highland')")
    page.evaluate('for(let i=0;i<19;i++)window.__tc.update(.05,1)')
    s19=page.evaluate('''() => ({cur:__tc.get().cur, seconds:__tc.get().turnT, phase:__tc.get().phase})''')
    check('wall-clock timer unaffected by 50ms physics cap '+fn, s19['cur']==0 and s19['seconds']>=19,s19)
    page.evaluate('window.__tc.update(.05,1)')
    s20=page.evaluate('''() => ({cur:__tc.get().cur, phase:__tc.get().phase})''')
    check('wall-clock timeout ends turn '+fn, s20['cur']==1,s20)
    page.locator('#btn-tune').click()
    bef=page.evaluate('window.__tc.get().turnT');page.evaluate('window.__tc.update(.05,4)');aft=page.evaluate('window.__tc.get().turnT')
    check('settings pause clock '+fn,bef==aft,(bef,aft))
    page.locator('#panel-close').click()
    page.evaluate("window.__tc.startGame('duo',['light','armored'],'highland')")
    page.evaluate('window.__tc.setManualTestMode(true); window.__tc.get().tanks[0].airborne=true')
    page.locator('#btn-fire').dispatch_event('pointerdown',{'pointerId':15,'button':0})
    check('cannot shoot while falling '+fn,page.evaluate('window.__tc.get().phase')=='aim');page.evaluate('window.__tc.setManualTestMode(false)')
    check('no JS exception '+fn,not errs,errs)
    page.close(); ctx.close()
  # statistics, group hit damage, test bypassing projectiles
  page=b.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.set_content(html,wait_until='domcontentloaded')
  page.evaluate("window.__tc.startGame('duo',['howitzer','armored'],'frontier')")
  z=page.evaluate('''() => {const T=window.__tc,g=T.get(),t=g.tanks[0],enemy=g.tanks[1];g.stats[0].shots=1;
    const shot={owner:t,pieceHits:new Map(),hit:false,direct:false},d={id:'child',r:27,dmg:20};
    for(let k=0;k<3;k++)T.explode(enemy.x,enemy.y-15,d,enemy,t,shot);
    return {best:g.stats[0].best,hits:g.stats[0].hits,remaining:enemy.hp,total:shot.enemyDamage};
  }''')
  check('split maximum damage sums all fragments',z['best']==z['total'] and z['best']>=45 and z['hits']==1,z)
  check('no JS exception stats',not errors,errors)
  page.close()
  b.close()
report={'passed':sum(ok for _,ok,_ in results),'total':len(results),'checks':[{'name':x,'passed':y,'detail':z} for x,y,z in results]}
(ROOT/'qa-output'/'checks.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(f'RESULT: {report["passed"]}/{report["total"]}',flush=True)
sys.exit(0 if report['passed']==report['total'] else 1)
