"""Regression checks for 탄착점.

Loads ../index.html?test in headless Chromium, runs the autoplay soak test (soak.js) and a set of
targeted checks for bugs fixed earlier and for the rules that are easy to break. Exits non-zero
if anything fails.

    python tests/run_checks.py            # everything
    python tests/run_checks.py --quick    # skip the long soak test

Needs: pip install playwright && python -m playwright install chromium
Set CHROME=/path/to/chrome to use a specific browser binary.
"""
import json, os, pathlib, sys, time
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = (ROOT / "index.html").as_uri() + "?test"
SOAK = (pathlib.Path(__file__).parent / "soak.js").read_text(encoding="utf-8")

results = []
def check(name, ok, detail):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + "  " + json.dumps(detail, ensure_ascii=False))

def open_page(p, **ctx):
    exe = os.environ.get("CHROME")
    b = p.chromium.launch(**({"executable_path": exe} if exe else {}))
    c = b.new_context(**({"viewport": {"width": 1280, "height": 720}} | ctx))
    pg = c.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.route("**/*fonts.g*", lambda r: r.abort())   # no network needed for tests
    pg.goto(URL)
    time.sleep(0.6)
    return b, pg, errs

with sync_playwright() as p:
    b, pg, errs = open_page(p)
    ev = pg.evaluate

    if "--quick" not in sys.argv:
        t0 = time.time()
        r = ev(SOAK)
        check("soak: 150k frames without invariant violations", not r["issues"],
              {"games": r["games"], "turns": r["turns"], "issues": r["issues"], "secs": round(time.time() - t0, 1)})

    # A split shell counts as one hit, however many of its pieces land.
    r = ev("""(()=>{const T=window.__tc;let best={hpLost:0};
      for(let el=40;el<=88;el+=4){for(let pw=20;pw<=100;pw+=4){
        T.startGame('duo'); const g=T.get(), a=g.tanks[0], b=g.tanks[1]; b.x=a.x+180; b.y=0; for(let i=0;i<90;i++)T.update(1/60);
        T.setAmmo(a,['split']); a.sel='split'; a.facing=1; a.elev=el; T.fire(a,pw); for(let i=0;i<600;i++){T.update(1/60); if(T.get().phase!=='flying')break;}
        const st=T.get().stats[0], lost=b.maxHp-b.hp; if(lost>best.hpLost) best={hits:st.hits, shots:st.shots, direct:st.direct, hpLost:lost};
      }} return best;})()""")
    check("split shell: hits never exceed shots", r.get("hits", 0) <= r.get("shots", 1) and r.get("direct", 0) <= r.get("hits", 0), r)

    # A tank in a pit dug to the bottom falls out and dies (it used to stay alive hidden under the console).
    r = ev("""(()=>{const T=window.__tc;T.startGame('duo');const t=T.get().tanks[0];
      for(let y=t.y-20;y<905;y+=30)T.carve(t.x,y,40,false); for(let i=0;i<300;i++)T.update(1/60);
      const k=T.get().tanks[0]; return {y:Math.round(k.y), alive:k.alive, gone:k.gone};})()""")
    check("pit to the bottom: tank falls out", (not r["alive"]) and r["gone"], r)

    r = ev("""(()=>{const T=window.__tc;T.startGame('practice');const d=T.get().tanks[1];
      for(let y=d.y-20;y<905;y+=30)T.carve(d.x,y,40,false); for(let i=0;i<300;i++)T.update(1/60);
      T.endTurn(); for(let i=0;i<60;i++)T.update(1/60); return {alive:d.alive, gone:d.gone, y:Math.round(d.y)};})()""")
    check("practice: fallen target is set up again on ground", r["alive"] and not r["gone"] and r["y"] < 900, r)

    # Pressing 처음으로 right after a game ends must not leave the result sheet over the start sheet.
    r = ev("""(async()=>{const T=window.__tc;T.startGame('duo');const g=T.get();g.tanks[1].hp=0;g.tanks[1].alive=false;
      T.endTurn(); const ph=T.get().phase; document.getElementById('btn-menu').click();
      await new Promise(r=>setTimeout(r,1300));
      return {phase:ph, start:!document.getElementById('start').hidden, over:!document.getElementById('over').hidden};})()""")
    check("game over then 처음으로: only the start sheet shows", r["phase"] == "over" and r["start"] and not r["over"], r)

    r = ev("""(()=>{const T=window.__tc;T.startGame('duo');const g=T.get(), a=g.tanks[0], b=g.tanks[1];
      b.x=a.x+120; b.y=0; for(let i=0;i<120;i++)T.update(1/60); a.fuel=999;
      for(let i=0;i<300;i++){T.moveTank(a,1,1/60);T.update(1/60);} return {gap:Math.round(b.x-a.x)};})()""")
    check("tanks cannot drive through each other", r["gap"] >= 40, r)

    # At full skill the computer's drill shots should land (it used to plan them like normal shells).
    r = ev("""(()=>{const T=window.__tc;const res=[]; const s0=T.S().aiSkill; T.S().aiSkill=1;
      for(let k=0;k<4;k++){T.startGame('ai');const g=T.get(), a=g.tanks[1], b=g.tanks[0];
        T.setAmmo(a,['drill','drill']);
        const pl=T.planShot(a,false,'drill');
        a.facing=pl.facing; a.elev=pl.elev; const hp0=b.hp; T.fire(a,pl.power);
        for(let i=0;i<900;i++){T.update(1/60); if(T.get().phase!=='flying')break;}
        res.push(hp0-b.hp);}
      T.S().aiSkill=s0; return res;})()""")
    landed = [x for x in r if x is not None]
    check("computer aims drill shells correctly at full skill", landed and min(landed) > 0, r)

    # GunBound-style angle: the barrel angle is measured from the hull, so world angle = elev - facing * tilt.
    r = ev("""(()=>{const T=window.__tc;T.startGame('duo');const a=T.get().tanks[0];
      for(let i=0;i<30;i++)T.update(1/60); a.tilt=-0.3; a.facing=1; a.elev=40; T.fire(a,60); const s=T.get().shells[0];
      return {expected:+(40+0.3*180/Math.PI).toFixed(1), launch:+(Math.atan2(-s.vy,s.vx)*180/Math.PI).toFixed(1)};})()""")
    check("launch angle follows the hull tilt", abs(r["expected"] - r["launch"]) < 0.3, r)

    # Turn clock: running out while aiming passes the turn with PASS_DELAY + 10 per second.
    r = ev("""(()=>{const T=window.__tc;T.startGame('duo');for(let i=0;i<60*21;i++)T.update(1/60);const g=T.get();
      return {cur:g.cur, phase:g.phase, d:g.tanks.map(t=>t.delay)};})()""")
    check("turn clock: timeout while aiming passes the turn", r["cur"] == 1 and r["d"] == [700, 0], r)

    r = ev("""(()=>{const T=window.__tc;T.startGame('duo');for(let i=0;i<60*18;i++)T.update(1/60);
      window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'})); const p1=T.get().phase;
      for(let i=0;i<60*3;i++)T.update(1/60); const g=T.get(); return {afterPress:p1, phase:g.phase, shots:g.stats[0].shots};})()""")
    check("turn clock: timeout while charging fires the shot", r["afterPress"] == "charging" and r["shots"] == 1, r)

    # Delay order: lowest delay moves next, values are normalised so the leader sits at 0.
    r = ev("""(()=>{const T=window.__tc;T.startGame('duo');const seq=[];
      const shoot=sel=>{let g=T.get();const t=g.tanks[g.cur];T.setAmmo(t,[sel,sel,sel]);t.sel=sel;t.facing=t.i===0?-1:1;t.elev=45;T.fire(t,100);
        for(let i=0;i<600;i++){T.update(1/60); if(T.get().phase==='aim')break;} g=T.get(); seq.push([g.cur, g.tanks[0].delay, g.tanks[1].delay]);};
      shoot('basic'); shoot('heavy'); shoot('heavy'); shoot('heavy'); shoot('basic'); return seq;})()""")
    # P1 basic 780 → P2; P2 heavy 1450 → P1 (P2 at 670); P1 heavy → [780,0] → P2; P2 heavy → [0,670] → P1;
    # P1 basic 780 > 670 → P2.
    check("delay order", r == [[1, 780, 0], [0, 0, 670], [1, 780, 0], [0, 0, 670], [1, 110, 0]], r)

    r = ev("""(()=>{const T=window.__tc;T.startGame('ai');for(let i=0;i<30;i++)T.update(1/60);
      document.getElementById('btn-pass').click(); const g=T.get(); return {cur:g.cur, phase:g.phase, d:g.tanks.map(t=>t.delay)};})()""")
    check("pass button hands the turn over with delay 500", r["cur"] == 1 and r["d"] == [500, 0] and r["phase"] == "aiThink", r)

    pg.click("[data-mode=ai]") if pg.is_visible("[data-mode=ai]") else None
    ev("window.__tc.startGame('practice')"); time.sleep(0.3)
    r = ev("({timer:document.getElementById('timer').hidden, pass:document.getElementById('btn-pass').hidden})")
    check("practice mode: no turn clock and no pass button", r["timer"] and r["pass"], r)

    # ---- wide map, camera, minimap ----
    r = ev("""(()=>{const T=window.__tc;T.startGame('duo');const {terr,back}=T.layers;const W=T.W,H=T.H;
      const a=(c,x,y)=>c.getContext('2d').getImageData(x,y,1,1).data[3];
      return {W, terrL:a(terr,3,H-3), terrR:a(terr,W-3,H-3), backR:a(back,W-3,H-3), skyR:a(terr,W-3,3)};})()""")
    check("wide map: both terrain layers are painted across the full width", r["W"] > 1600 and r["terrL"] == r["terrR"] == r["backR"] == 255 and r["skyR"] == 0, r)

    r = ev("""(()=>{const T=window.__tc;const o=[];for(let k=0;k<40;k++){T.startGame('ai');const [a,b]=T.get().tanks;o.push([b.x-a.x,a.y,b.y,a.x,b.x]);}
      return {minGap:Math.round(Math.min(...o.map(v=>v[0]))), maxGap:Math.round(Math.max(...o.map(v=>v[0]))), maxY:Math.round(Math.max(...o.flatMap(v=>[v[1],v[2]]))),
        minX:Math.min(...o.map(v=>v[3])), maxX:Math.max(...o.map(v=>v[4])), W:T.W};})()""")
    check("spawns: reachable gap, inside the map, standing on ground",
          850 <= r["minGap"] and r["maxGap"] <= 1300 and r["maxY"] < 650 and r["minX"] >= 150 and r["maxX"] <= r["W"] - 150, r)

    r = ev("""(()=>{const T=window.__tc;const tt=T.S().turnTime;T.S().turnTime=0;T.startGame('duo');const res=[];
      for(let turn=0;turn<2;turn++){ for(let i=0;i<150;i++)T.update(1/60); const g=T.get(),t=g.tanks[g.cur],v=T.view(),p=T.toScreen(t.x,t.y-15);
        res.push({cur:g.cur,x:Math.round(p.x),y:Math.round(p.y),top:Math.round(v.playTop),bot:Math.round(v.playBot),cw:v.cw}); T.passTurn(false); }
      T.S().turnTime=tt; return res;})()""")
    check("camera keeps the current tank in the play area while aiming",
          [o["cur"] for o in r] == [0, 1] and all(40 < o["x"] < o["cw"] - 40 and o["top"] < o["y"] < o["bot"] for o in r), r)

    r = ev("""(()=>{const T=window.__tc;const tt=T.S().turnTime,sk=T.S().aiSkill;T.S().turnTime=0;T.S().aiSkill=1;const out=[];
      for(let k=0;k<3;k++){T.startGame('duo');for(let i=0;i<60;i++)T.update(1/60);const a=T.get().tanks[0];const pl=T.planShot(a,false,'basic');a.facing=pl.facing;a.elev=pl.elev;T.fire(a,pl.power);
        let n=0,off=0;for(let i=0;i<900&&T.get().phase==='flying';i++){T.update(1/60);for(const s of T.get().shells){n++;const p=T.toScreen(s.x,s.y);if(p.x<0||p.x>T.view().cw)off++;}}
        out.push({frames:n,offscreen:off});}
      T.S().turnTime=tt;T.S().aiSkill=sk; return out;})()""")
    check("camera follows the shell across the map", all(o["frames"] > 60 and o["offscreen"] == 0 for o in r), r)

    # Drag on the battlefield to look away, then a tap brings the camera back. Uses real input and the real frame loop.
    # Tanks spawn anywhere, so place them: tank 0 at 900 leaves room for the camera to move right, away from it.
    ev("(()=>{const T=window.__tc;T.S().turnTime=0;T.startGame('duo');const g=T.get();g.tanks[0].x=900;g.tanks[1].x=2300;g.tanks.forEach(t=>t.y=0);for(let i=0;i<150;i++)T.update(1/60);})()")
    v0 = ev("window.__tc.view()")
    pg.mouse.move(1150, 400); pg.mouse.down()
    for x in range(1150, 100, -50): pg.mouse.move(x, 400)
    pg.mouse.up(); time.sleep(0.3)
    v1 = ev("window.__tc.view()")
    pg.mouse.click(640, 380); time.sleep(1.6)
    v2 = ev("""(()=>{const T=window.__tc,v=T.view(),t=T.get().tanks[0],p=T.toScreen(t.x,t.y-15);return {look:v.look,x:Math.round(p.x),cw:v.cw,markers:v.markers};})()""")
    check("drag looks around (marker shows the tank), tap comes back",
          v1["look"] is not None and v1["x"] - v0["x"] > 400 and any(m["i"] == 0 for m in v1["markers"]) and v2["look"] is None and 40 < v2["x"] < v2["cw"] - 40,
          {"dx": round(v1["x"] - v0["x"]), "markers": v1["markers"], "after_tap": v2})

    pg.mouse.move(1150, 400); pg.mouse.down(); pg.mouse.move(900, 400); pg.mouse.move(700, 400); pg.mouse.up()
    r = ev("""(()=>{const T=window.__tc;const had=!!T.view().look;const a=T.get().tanks[0];T.fire(a,50);return {had,after:T.view().look};})()""")
    check("firing hands the camera back from free look", r["had"] and r["after"] is None, r)

    ev("(()=>{const T=window.__tc;T.startGame('duo');for(let i=0;i<30;i++)T.update(1/60);T.drawMinimap(performance.now()+1000);})()")
    r = ev("""(()=>{const c=window.__tc.layers.minimap;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>0)n++;
      return {w:c.width,h:c.height,filled:+(n/(c.width*c.height)).toFixed(2)};})()""")
    check("minimap draws the terrain", r["w"] > 100 and r["h"] > 20 and r["filled"] > 0.3, r)
    box = pg.locator("#minimap").bounding_box()
    pg.mouse.click(box["x"] + box["width"] - 3, box["y"] + box["height"] / 2); time.sleep(1.6)
    r = ev("""(()=>{const T=window.__tc,v=T.view();return {x:Math.round(v.x), rightEdge:Math.round(T.W - v.cw/v.s/2), look:!!v.look};})()""")
    check("pressing the minimap's right end shows the right end of the map", r["look"] and abs(r["x"] - r["rightEdge"]) < 30, r)
    ev("window.__tc.S().turnTime=20")

    r = ev("""(()=>{const T=window.__tc;const ms=[];for(let k=0;k<10;k++){T.startGame('ai');const t0=performance.now();T.planShot(T.get().tanks[1]);ms.push(performance.now()-t0);}
      const t1=performance.now();T.paintTerrain();return {planMax:Math.round(Math.max(...ms)),planAvg:Math.round(ms.reduce((a,b)=>a+b)/ms.length),paint:Math.round(performance.now()-t1)};})()""")
    check("computer planning and terrain repaint stay quick on this machine", r["planMax"] < 150 and r["paint"] < 400, r)

    # ---- mobiles ----
    r = ev("""(()=>{const T=window.__tc;const tt=T.S().turnTime;T.S().turnTime=0;const out={};
      const key=(code,down)=>window.dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',{code}));
      for(const m of T.MOBILES){T.startGame('duo',[m.id,m.id]);for(let i=0;i<30;i++)T.update(1/60);const t=T.get().tanks[0];
        key('ArrowUp',true);for(let i=0;i<240;i++)T.update(1/60);key('ArrowUp',false);const hi=Math.round(t.elev);
        key('ArrowDown',true);for(let i=0;i<240;i++)T.update(1/60);key('ArrowDown',false);const lo=Math.round(t.elev);
        out[m.id]={lo,hi,want:m.ang,hp:t.hp,maxHp:t.maxHp,fuel:t.fuel,ammo:t.ammo,shells:m.shells,hand:t.hand.slice()};}
      T.S().turnTime=tt; return out;})()""")
    m_ok = all(v["lo"] == v["want"][0] and v["hi"] == v["want"][1] for v in r.values())
    check("mobiles: the barrel stops at each mobile's angle range", m_ok, {k: [v["lo"], v["hi"]] for k, v in r.items()})
    check("mobiles: hp, fuel and the mobile's four shells (basic unlimited, others 2)",
          all(v["hp"] == v["maxHp"] and sorted(v["ammo"]) == sorted(v["shells"]) and all(n == 2 for k, n in v["ammo"].items() if k != "basic") for v in r.values())
          and len({v["maxHp"] for v in r.values()}) > 1 and len({v["fuel"] for v in r.values()}) > 1,
          {k: [v["maxHp"], v["fuel"], v["shells"][-1]] for k, v in r.items()})

    r = ev("""(()=>{const T=window.__tc;const out={};
      for(const m of T.MOBILES){let lo=99,hi=-1;for(let k=0;k<6;k++){T.startGame('ai',['digger',m.id]);const pl=T.planShot(T.get().tanks[1]);lo=Math.min(lo,pl.elev);hi=Math.max(hi,pl.elev);}out[m.id]=[lo,hi,m.ang];}
      return out;})()""")
    check("computer keeps to its mobile's angle range", all(v[2][0] <= v[0] and v[1] <= v[2][1] for v in r.values()), r)

    # Each mobile's own shell, aimed by the computer at full skill: it should land (bounce and drill have their own physics).
    r = ev("""(()=>{const T=window.__tc;const s0=T.S().aiSkill,tt=T.S().turnTime;T.S().aiSkill=1;T.S().turnTime=0;const out={};
      for(const m of T.MOBILES){const own=m.shells[m.shells.length-1];let hits=0,bounced=0;
        for(let k=0;k<5;k++){T.startGame('ai',['digger',m.id]);const g=T.get(),a=g.tanks[1],b=g.tanks[0];
          T.setAmmo(a,[own,own]);
          const pl=T.planShot(a,false,own);
          a.facing=pl.facing;a.elev=pl.elev;const hp0=b.hp;T.fire(a,pl.power);
          for(let i=0;i<900;i++){T.update(1/60);for(const s of T.get().shells)if(s.bounced)bounced++;if(T.get().phase!=='flying')break;}
          if(b.hp<hp0)hits++;}
        out[own]={hits,bounced:bounced>0};}
      T.S().aiSkill=s0;T.S().turnTime=tt;return out;})()""")
    check("computer lands each mobile's own shell at full skill", all(v["hits"] >= 4 for v in r.values()), r)

    # A low bounce shot over a few random maps: each burst happens once, and at least one lands well past the bounce.
    # (On a single map a bounce into a rising slope can burst right next to where it bounced, so one try is not enough.)
    r = ev("""(()=>{const T=window.__tc;T.S().turnTime=0;const out=[];
      for(let k=0;k<5;k++){T.startGame('duo',['light','light']);for(let i=0;i<60;i++)T.update(1/60);
        const g=T.get(),a=g.tanks[0];a.sel='bounce';a.facing=1;a.elev=12;const ops0=g.ops.length;T.fire(a,55);
        let bounceAt=null,boom=null;for(let i=0;i<600;i++){T.update(1/60);const s=T.get().shells[0];
          if(s&&s.bounced&&!bounceAt)bounceAt=[Math.round(s.x),Math.round(s.y)];
          const o=T.get().ops.slice(ops0).find(o=>o.scorch);if(o&&!boom)boom=[Math.round(o.cx),Math.round(o.cy)];if(T.get().phase!=='flying')break;}
        out.push({bounceAt,boom,blasts:T.get().ops.slice(ops0).filter(o=>o.scorch).length});}
      T.S().turnTime=20; return out;})()""")
    bounced = [o for o in r if o["bounceAt"]]
    check("bounce shell: bounces once, then bursts somewhere else",
          bounced and all(o["blasts"] == 1 for o in r) and any(abs(o["boom"][0] - o["bounceAt"][0]) > 20 for o in bounced), r)

    r = ev("""(()=>{const T=window.__tc;T.S().turnTime=0;const out=[];
      for(let k=0;k<10&&out.length<2;k++){T.startGame('duo',['armored','digger']);const g=T.get(),a=g.tanks[0],b=g.tanks[1];b.x=a.x+260;b.y=0;for(let i=0;i<90;i++)T.update(1/60);
        T.setAmmo(a,['pierce','pierce']);a.facing=1;a.elev=40;
        const s0=T.S().aiSkill;T.S().aiSkill=1;const pl=T.planShot(a,false,'pierce');T.S().aiSkill=s0;
        a.facing=pl.facing;a.elev=pl.elev;const hp0=b.hp;T.fire(a,pl.power);for(let i=0;i<600;i++){T.update(1/60);if(T.get().phase!=='flying')break;}
        if(T.get().stats[0].direct)out.push(hp0-b.hp);}
      T.S().turnTime=20;return out;})()""")
    check("armour-piercing shell: a direct hit does 24 x 2.4 = 58", r and all(v == 58 for v in r), r)

    # The picker: duo asks 1P then 2P; the back button steps back; the choice is remembered for next time.
    ev("document.getElementById('btn-menu').click()"); time.sleep(0.2)
    pg.click("[data-mode=duo]"); time.sleep(0.2)
    t1 = pg.text_content("#pick-title")
    pg.click(".mob[data-mob=armored]"); time.sleep(0.2)
    t2 = pg.text_content("#pick-title")
    pg.click("#pick-back"); time.sleep(0.1)
    t3 = pg.text_content("#pick-title")
    pg.click(".mob[data-mob=armored]"); time.sleep(0.1)
    pg.click(".mob[data-mob=howitzer]"); time.sleep(0.3)
    r = ev("""(()=>{const g=window.__tc.get();return {mode:g.mode,phase:g.phase,mobs:g.tanks.map(t=>t.m.id),pick:!document.getElementById('pick').hidden,
      saved:localStorage.getItem('tanchak-mobile-v1'),badge:document.querySelector('#hp0 .badge').title,armoredName:window.__tc.MOBILES.find(m=>m.id==='armored').name};})()""")
    check("picker: 1P then 2P, back steps back, choices start the game and are remembered",
          t1 == "1P 탱크 고르기" and t2 == "2P 탱크 고르기" and t3 == "1P 탱크 고르기" and r["mobs"] == ["armored", "howitzer"]
          and not r["pick"] and r["saved"] == '["armored","howitzer"]' and r["badge"] == r["armoredName"],
          {"titles": [t1, t2, t3], **r})
    ev("document.getElementById('btn-menu').click()"); time.sleep(0.2)
    pg.click("[data-mode=ai]"); time.sleep(0.2)
    r = ev("({last:document.querySelector('.mob.last')&&document.querySelector('.mob.last').dataset.mob})")
    pg.click(".mob[data-mob=light]"); time.sleep(0.3)
    r2 = ev("(()=>{const g=window.__tc.get();return {mode:g.mode,mobs:g.tanks.map(t=>t.m.id)};})()")
    check("picker: vs computer marks the last choice and gives the computer a mobile",
          r["last"] == "armored" and r2["mode"] == "ai" and r2["mobs"][0] == "light" and r2["mobs"][1] in ("light", "armored", "howitzer", "digger"), {**r, **r2})

    # ---- effect cards ----
    r = ev("""(()=>{const T=window.__tc;T.S().turnTime=0;T.startGame('duo',['digger','digger']);const a=T.get().tanks[0];a.hp=a.maxHp=9999;
      const all=[...a.deck,...a.hand].filter(Boolean).sort().join(',');const hand0=a.hand.length;const seen=[];
      for(let k=0;k<10;k++){const g=T.get();if(g.cur!==0){T.passTurn(false);}const id=a.hand.find(Boolean);if(!id)break;
        a.arm=id;a.armSlot=a.hand.indexOf(id);a.sel='basic';a.facing=-1;a.elev=80;const d0=a.delay;T.fire(a,8);seen.push([id,a.delay-d0,a.deck.length,a.hand.filter(Boolean).length]);
        for(let i=0;i<600;i++){T.update(1/60);if(T.get().phase==='aim'||T.get().phase==='over')break;}}
      T.S().turnTime=20;return {all,hand0,seen,fxDelay:Object.fromEntries(Object.entries(T.FXD).map(([k,f])=>[k,f.delay]))};})()""")
    check("effect cards: 8-card deck (2 each of 4), hand of 2, each play adds its delay and draws one",
          r["all"] == "power,power,pull,pull,rush,rush,warp,warp" and r["hand0"] == 2 and len(r["seen"]) == 8
          and all(s[1] == 780 + r["fxDelay"][s[0]] for s in r["seen"])
          and [s[2] for s in r["seen"]] == [5, 4, 3, 2, 1, 0, 0, 0] and [s[3] for s in r["seen"]] == [2, 2, 2, 2, 2, 2, 1, 0], r)

    # 파워업 multiplies that shot's damage by 1.25.
    r = ev("""(()=>{const T=window.__tc;T.S().turnTime=0;T.startGame('duo',['digger','digger']);const g=T.get(),a=g.tanks[0],b=g.tanks[1];
      const mk=fx=>({owner:a,hit:false,direct:false,pieceHits:new Map(),fx,fxDone:true});const out={};
      for(const fx of [null,'power']){b.hp=999;T.explode(b.x,b.y-15,T.SHELL.heavy,b,a,mk(fx));out[fx||'plain']=999-b.hp;}
      T.S().turnTime=20;return out;})()""")
    check("power-up card: the shot does 25% more damage", r == {"plain": 58, "power": 72}, r)

    # 과열: a burst near the other tank makes its gauge 1.5x faster for its next turn only; out of range it does nothing.
    r = ev("""(()=>{const T=window.__tc;T.S().turnTime=0;T.startGame('duo',['digger','digger']);const g=T.get(),a=g.tanks[0],b=g.tanks[1];
      for(let i=0;i<20;i++)T.update(1/60);
      const charge=()=>{window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'}));for(let i=0;i<30;i++)T.update(1/60);T.syncView();
        const p=+document.getElementById('pow').textContent,glow=document.getElementById('gauge').classList.contains('rush');
        window.dispatchEvent(new KeyboardEvent('keyup',{code:'Space'}));for(let i=0;i<900;i++){T.update(1/60);if(T.get().phase==='aim')break;}return [p,glow];};
      T.applyFx({owner:a,fx:'rush'},b.x+400,b.y-15);const far=b.rush;
      T.applyFx({owner:a,fx:'rush'},b.x+60,b.y-15);const near=b.rush;
      if(T.get().cur===0)T.passTurn(false);const first=charge();
      if(T.get().cur===0)T.passTurn(false);const second=charge();
      T.S().turnTime=20;return {far,near,first,second};})()""")
    check("overheat card: next turn's gauge runs 1.5x (and glows), then back to normal; out of range no effect",
          r["far"] is False and r["near"] is True and 50 <= r["first"][0] <= 55 and r["first"][1] and 33 <= r["second"][0] <= 37 and not r["second"][1], r)

    # follow: the shooter ends up standing near where the shot burst
    r = ev("""(()=>{const T=window.__tc;T.S().turnTime=0;const out=[];
      for(let k=0;k<6;k++){T.startGame('duo',['digger','digger']);for(let i=0;i<30;i++)T.update(1/60);const g=T.get(),a=g.tanks[0],b=g.tanks[1];
        T.setHand(a,['warp']);a.arm='warp';const pl=T.planShot(a,false,'basic');a.facing=pl.facing;a.elev=pl.elev;const x0=a.x;T.fire(a,pl.power*0.7);
        let boom=null;for(let i=0;i<900;i++){T.update(1/60);const o=T.get().ops.find(o=>o.scorch);if(o&&!boom)boom=Math.round(o.cx);if(T.get().phase==='aim'||T.get().phase==='over')break;}
        out.push({x0:Math.round(x0),boom,x:Math.round(a.x),air:a.airborne,hop:!!a.hop,gap:Math.round(Math.abs(b.x-a.x))});}
      T.S().turnTime=20;return out;})()""")
    landed = [o for o in r if o["boom"] is not None]
    check("follow card: the shooter lands near where the shot burst, standing, clear of the other tank",
          landed and all(abs(o["x"] - o["boom"]) <= 262 and abs(o["x"] - o["x0"]) > 40 and not o["air"] and not o["hop"] and o["gap"] >= 56 for o in landed), r)

    # pull: in range, the other tank is brought next to the shooter; out of range nothing moves
    r = ev("""(()=>{const T=window.__tc;T.S().turnTime=0;const sk=T.S().aiSkill;T.S().aiSkill=1;const out=[];   // aim without error
      for(let k=0;k<6;k++){T.startGame('duo',['digger','digger']);for(let i=0;i<30;i++)T.update(1/60);const g=T.get(),a=g.tanks[0],b=g.tanks[1];
        const far=k%2===1;T.setHand(a,['pull']);a.arm='pull';const bx0=b.x;
        // aim just short of the other tank (in range) or far short of it (out of range)
        const pl=T.planShot(a,false,'basic');a.facing=pl.facing;a.elev=pl.elev;T.fire(a,far?pl.power*0.55:pl.power);
        for(let i=0;i<900;i++){T.update(1/60);if(T.get().phase==='aim'||T.get().phase==='over')break;}
        out.push({far,moved:Math.round(Math.abs(b.x-bx0)),gap:Math.round(Math.abs(b.x-a.x)),air:b.airborne,alive:b.alive});}
      T.S().turnTime=20;T.S().aiSkill=sk;return out;})()""")
    near = [o for o in r if not o["far"] and o["alive"]]
    check("pull card: an opponent within range lands beside the shooter; one out of range stays",
          near and all(100 <= o["gap"] <= 302 and o["moved"] > 100 and not o["air"] for o in near)
          and all(o["moved"] < 5 for o in r if o["far"]), r)

    r = ev("""(()=>{const T=window.__tc;T.S().turnTime=0;T.startGame('duo',['light','digger']);for(let i=0;i<30;i++)T.update(1/60);const a=T.get().tanks[0];
      T.setHand(a,['pull','warp']);T.renderCards();
      const k=c=>window.dispatchEvent(new KeyboardEvent('keydown',{code:c}));
      k('KeyC');const open=!document.getElementById('fxpop').hidden;const cards=document.querySelectorAll('#fxpop .fxcard').length;
      document.querySelector('#fxpop [data-fx="1"]').click();const armed=a.arm,closed=document.getElementById('fxpop').hidden,btn=document.getElementById('fx-btn').textContent.includes(T.FXD.warp.name);
      k('Digit6');const off=a.arm;k('Digit5');const pulled=a.arm;k('Digit2');const shell=a.sel;
      T.S().turnTime=20;return {open,cards,armed,closed,btn,off,pulled,shell};})()""")
    check("card button: C opens the hand, a tap arms a card, 5-6 toggle cards, 1-4 still pick shells",
          r["open"] and r["cards"] == 2 and r["armed"] == "warp" and r["closed"] and r["btn"] and r["off"] is None and r["pulled"] == "pull" and r["shell"] == "heavy", r)

    r = ev("""(()=>{const T=window.__tc;const S=T.S(),sk=S.aiSkill,tt=S.turnTime;S.aiSkill=0.85;S.turnTime=0;let tried=0,pulled=0;
      for(let k=0;k<40&&tried<4;k++){T.startGame('ai',['digger','digger']);const g=T.get(),me=g.tanks[0],ai=g.tanks[1];if(me.y>ai.y-60)continue;
        T.passTurn(false);T.setHand(ai,['pull','warp']);for(let i=0;i<60*4;i++){T.update(1/60);if(T.get().phase==='aiAim')break;}
        if(me.y>ai.y-60)continue;   // the height that counts is the settled one the computer planned from
        tried++;if(ai.arm==='pull')pulled++;}
      S.aiSkill=sk;S.turnTime=tt;return {tried,pulled};})()""")
    check("computer pulls the player down from much higher ground", r["tried"] == 0 or r["pulled"] >= r["tried"] - 1, r)

    # ---- computer: difficulty, moving, delay-aware shells, thinking spread over frames ----
    r = ev("""(()=>{const T=window.__tc;const S=T.S(),tt=S.turnTime,sk=S.aiSkill;S.turnTime=0;const out={};const mobs=T.MOBILES.map(m=>m.id);let worst=0;
      for(const [name,v] of [['easy',0.2],['hard',0.85]]){S.aiSkill=v;let hits=0,n=0;
        for(let k=0;k<60;k++){T.startGame('ai',[mobs[k%4],mobs[(k>>2)%4]]);T.passTurn(false);const me=T.get().tanks[0],hp0=me.hp;let fired=false;
          for(let i=0;i<60*12;i++){const t0=performance.now();T.update(1/60);const ms=performance.now()-t0;const ph=T.get().phase;if(ph==='aiThink')worst=Math.max(worst,ms);
            if(ph==='flying')fired=true;if(fired&&(ph==='aim'||ph==='over'))break;}
          n++;if(me.hp<hp0)hits++;}
        out[name]=+(hits/n).toFixed(2);}
      S.turnTime=tt;S.aiSkill=sk;out.worstThinkFrameMs=Math.round(worst);return out;})()""")
    # 120 games per level measured easy ~0.32, hard ~0.80-0.85; 60 games and a 0.25 margin keep chance failures rare
    check("difficulty: hard hits clearly more often than easy", r["hard"] - r["easy"] >= 0.25 - 1e-9, r)
    check("computer thinks a few ms per frame instead of freezing one frame", r["worstThinkFrameMs"] < 20, r)

    r = ev("""(()=>{const T=window.__tc;const S=T.S(),wm=S.windMax,tt=S.turnTime,sk=S.aiSkill;S.windMax=0;S.turnTime=0;S.aiSkill=0.85;const out=[];
      for(let k=0;k<16;k++){T.startGame('ai',['digger','light']);const g=T.get(),me=g.tanks[0],ai=g.tanks[1];
        const side=ai.x>1700?-1:1;me.x=Math.max(40,Math.min(T.W-40,ai.x+side*2200));me.y=0;for(let i=0;i<120;i++)T.update(1/60);
        T.passTurn(false);const x0=ai.x;let fired=false;
        for(let i=0;i<60*12;i++){T.update(1/60);const ph=T.get().phase;if(ph==='flying')fired=true;if(fired&&(ph==='aim'||ph==='over'))break;}
        const log=T.aiLog().slice(-2),mv=log.find(l=>l.move!==undefined),shot=log[log.length-1];
        out.push({moved:!!mv,toward:mv?Math.sign(mv.move-x0)===side:null,dx:Math.round(ai.x-x0),here:mv&&Math.round(mv.missHere),there:mv&&Math.round(mv.missThere),miss:Math.round(shot.miss)});}
      S.windMax=wm;S.turnTime=tt;S.aiSkill=sk;return out;})()""")
    # Blocked (no clean shot here): it must drive toward the player and end up with a better shot.
    # Tactical moves (it already had a shot; added later for dodging and better ground) must keep a clean shot.
    moved = [o for o in r if o["moved"]]
    blocked = [o for o in moved if o["here"] > 12]
    tactical = [o for o in moved if o["here"] <= 12]
    check("computer drives toward the player when blocked, and never moves to a spot it cannot hit from",
          blocked and all(o["toward"] and abs(o["dx"]) >= 15 and o["there"] < o["here"] for o in blocked)
          and all(o["there"] <= 18 for o in tactical) and all(o["moved"] or o["miss"] <= 12 for o in r),
          {"blocked": len(blocked), "tactical": len(tactical), "cases": r})

    r = ev("""(()=>{const T=window.__tc;const S=T.S(),wm=S.windMax,tt=S.turnTime,sk=S.aiSkill;S.windMax=0;S.turnTime=0;S.aiSkill=0.85;const res=[];
      for(let k=0;k<20&&res.length<4;k++){T.startGame('ai',['digger','digger']);const g=T.get(),me=g.tanks[0],ai=g.tanks[1];me.x=ai.x-420;me.y=0;for(let i=0;i<120;i++)T.update(1/60);
        T.passTurn(false);me.delay=0;ai.delay=0;T.setAmmo(ai,['heavy','heavy','heavy']);const tight=T.planShot(ai);
        if(tight.miss>0)continue;me.delay=900;T.setAmmo(ai,['heavy','heavy','heavy']);const loose=T.planShot(ai);res.push([tight.sel,loose.sel]);}
      S.windMax=wm;S.turnTime=tt;S.aiSkill=sk;return res;})()""")
    check("computer skips the heavy shell when its delay would give the player two turns in a row",
          len(r) >= 2 and all(a == "basic" and b == "heavy" for a, b in r), r)

    ev("document.getElementById('btn-menu').click()"); time.sleep(0.2)
    pg.click("[data-mode=ai]"); time.sleep(0.2)
    pg.click("#pick-diff [data-skill='0.85']"); time.sleep(0.1)
    r = ev("({skill:window.__tc.S().aiSkill,on:document.querySelector('#pick-diff .chip.on').textContent,shown:!document.getElementById('pick-diff').hidden})")
    pg.click("#pick-back"); time.sleep(0.1); pg.click("[data-mode=duo]"); time.sleep(0.2)
    r["duoShown"] = ev("!document.getElementById('pick-diff').hidden")
    pg.click("#pick-back"); time.sleep(0.1)
    ev("window.__tc.S().aiSkill=0.5")
    check("picker: difficulty chips set the computer's skill (only against the computer)",
          r["skill"] == 0.85 and r["on"] == "어려움" and r["shown"] and not r["duoShown"], r)

    # ---- fixes from the review ----
    r = ev("""(()=>{const T=window.__tc;T.S().turnTime=0;T.startGame('duo',['light','digger']);for(let i=0;i<30;i++)T.update(1/60);const a=T.get().tanks[0];
      T.setHand(a,['pull','warp']);T.toggleFxPop(true);const open=!document.getElementById('fxpop').hidden;
      const c=document.getElementById('game');c.dispatchEvent(new PointerEvent('pointerdown',{pointerId:7,clientX:600,clientY:380,bubbles:true}));
      c.dispatchEvent(new PointerEvent('pointerup',{pointerId:7,clientX:600,clientY:380,bubbles:true}));
      T.S().turnTime=20;return {open,closed:document.getElementById('fxpop').hidden};})()""")
    check("touching the battlefield puts the card hand away", r["open"] and r["closed"], r)

    pg.set_viewport_size({"width": 360, "height": 780})
    time.sleep(0.3)
    r = ev("""(()=>{const T=window.__tc;T.S().turnTime=0;T.startGame('duo',['howitzer','digger']);for(let i=0;i<30;i++)T.update(1/60);
      const a=T.get().tanks[0];a.facing=1;a.elev=85;T.fire(a,95);let worst=0;
      for(let i=0;i<600;i++){T.update(1/60);const v=T.view();const bottom=T.toScreen(0,T.H).y;if(T.get().phase==='flying')worst=Math.max(worst,v.playBot-bottom);if(T.get().phase!=='flying')break;}
      T.S().turnTime=20;return {worstGapAboveConsole:Math.round(worst)};})()""")
    pg.set_viewport_size({"width": 1280, "height": 720})
    time.sleep(0.3)
    check("tall screen, high shot: the world's bottom never floats above the console", r["worstGapAboveConsole"] <= 1, r)

    # ---- genre terms and the touch latency check ----
    ev("document.getElementById('btn-menu').click()"); time.sleep(0.2)
    r = ev("""(()=>{const T=window.__tc;T.S().turnTime=0;T.startGame('duo',['light','digger']);
      const b=document.getElementById('banner').textContent;T.S().turnTime=20;
      return {banner:b,tune:document.getElementById('btn-tune').textContent,cap:document.querySelector('.power-row .cap').textContent,
        item:document.getElementById('fx-btn').textContent.includes('아이템'),font:getComputedStyle(document.querySelector('.chip')).fontFamily};})()""")
    check("genre terms: 턴, 설정, 파워, 아이템; labels in Jua", r["banner"] == "1P 턴" and r["tune"] == "설정" and r["cap"] == "파워" and r["item"] and r["font"].startswith('Jua'), r)

    ev("window.__tc.S().latencyOn=true; window.__tc.lat.list.length=0")
    pg.mouse.click(640, 380); time.sleep(0.3)
    r = ev("({n: window.__tc.lat.list.length, ms: window.__tc.lat.list.map(Math.round)})")
    ev("window.__tc.S().latencyOn=false")
    check("touch latency check records a time after a press", r["n"] >= 1 and all(0 <= v < 500 for v in r["ms"]), r)

    # ---- fixes from the 2026-11-04 inspection ----
    r = ev("""(()=>{const T=window.__tc;T.S().turnTime=20;T.startGame('duo',['digger','digger']);const g=T.get(),a=g.tanks[0],hp0=a.hp;
      for(let i=0;i<Math.round(60*19.95);i++)T.update(1/60);   // press fire with a few hundredths of a second left
      window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space'}));for(let i=0;i<30;i++)T.update(1/60);
      window.dispatchEvent(new KeyboardEvent('keyup',{code:'Space'}));const s=T.get();
      return {shots:s.stats[0].shots,cur:s.cur,hp:a.hp,hp0};})()""")
    check("time running out at very low power passes the turn instead of dropping a shell on the shooter",
          r["shots"] == 0 and r["cur"] == 1 and r["hp"] == r["hp0"], r)

    r = ev("""(()=>{const T=window.__tc;T.S().turnTime=0;T.startGame('duo',['digger','digger']);for(let i=0;i<20;i++)T.update(1/60);
      const a=T.get().tanks[0];T.setHand(a,['warp','warp']);a.deck=['pull'];T.armFx(1);T.toggleFxPop(true);
      const on=[...document.querySelectorAll('#fxpop .fxcard')].map(c=>c.classList.contains('on'));
      a.sel='basic';a.facing=-1;a.elev=80;T.fire(a,20);T.S().turnTime=20;return {on,hand:a.hand.slice()};})()""")
    check("two identical items: the tapped one shows as chosen and is the one used", r["on"] == [False, True] and r["hand"] == ["warp", "pull"], r)

    r = ev("""(()=>{const T=window.__tc;const S=T.S(),sk=S.aiSkill;S.aiSkill=0;let lo=999;
      for(let k=0;k<25;k++){T.startGame('ai',['digger','digger']);const g=T.get();const b=g.tanks[1];g.tanks[0].x=b.x-260;g.tanks[0].y=0;for(let i=0;i<90;i++)T.update(1/60);
        lo=Math.min(lo,T.planShot(b).power);}
      S.aiSkill=sk;return {minPower:+lo.toFixed(1)};})()""")
    check("the computer never plans a shot below the tap threshold", r["minPower"] >= 12, r)

    # Coming back repaints the terrain once per return: not on the first load's pageshow, not twice when pageshow
    # and visibilitychange both arrive, and still on a second quick return (an old 500 ms guard skipped it).
    r = ev("""(()=>{const T=window.__tc;const c=T.layers.terr.getContext('2d');
      const mark=()=>{c.fillStyle='#ff00ff';c.fillRect(5,5,2,2);};const marked=()=>{const d=c.getImageData(5,5,1,1).data;return d[0]===255&&d[1]===0&&d[2]===255;};
      let hid=false;Object.defineProperty(document,'hidden',{configurable:true,get:()=>hid});
      const vis=()=>document.dispatchEvent(new Event('visibilitychange')),show=()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:false}));
      mark();show();const firstLoad=marked();
      hid=true;vis();hid=false;vis();const back=marked();
      mark();show();const twice=marked();
      hid=true;vis();hid=false;vis();const again=marked();
      delete document.hidden;return {firstLoad,back,twice,again};})()""")
    check("resume repaints once per real return, not on first load", r == {"firstLoad": True, "back": False, "twice": True, "again": False}, r)

    # Out of time while falling: the pass waits for the landing but charges no more than the time limit.
    r = ev("""(()=>{const T=window.__tc;const S=T.S(),gv=S.gravity;S.turnTime=20;T.startGame('duo');for(let i=0;i<60*19.8;i++)T.update(1/60);
      const a=T.get().tanks[0];S.gravity=120;a.y-=400;let land=0;
      for(let i=0;i<60*5;i++){const was=a.airborne;T.update(1/60);if(was&&!a.airborne&&!land)land=T.get().turnT;}
      S.gravity=gv;const g=T.get();return {land:+land.toFixed(2),cur:g.cur,d:g.tanks.map(t=>t.delay)};})()""")
    check("timeout while falling charges at most the time limit", r["land"] >= 21 and r["cur"] == 1 and r["d"] == [700, 0], r)

    # The computer's flight model sees a split piece coming down on the shooter (it used to score only the best piece).
    r = ev("""(()=>{const T=window.__tc;T.S().turnTime=0;let seed=7,bad=0,self=0;const R=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648;};
      for(let k=0;k<40;k++){T.startGame('duo',['howitzer','howitzer']);let g=T.get();const a=g.tanks[0],b=g.tanks[1];
        b.x=Math.max(60,Math.min(T.W-60,a.x+(R()<0.5?-1:1)*(100+R()*200)));b.y=0;for(let i=0;i<40;i++)T.update(1/30);
        T.setAmmo(a,['split']);a.sel='split';a.facing=R()<0.5?-1:1;a.elev=84+R()*6;const p=12+R()*88;T.setWind((R()*2-1)*40);
        const sim=T.simulate(a,a.facing,a.elev,p,T.SHELL.split,b),hp0=a.hp;T.fire(a,p);
        for(let i=0;i<400;i++){T.update(1/30);const ph=T.get().phase;if(ph!=='flying'&&ph!=='settle'&&i>5)break;}
        if(a.hp<hp0){self++;if(sim<600)bad++;}}
      T.setWind(0);T.S().turnTime=20;return {self,bad};})()""")
    check("split: a piece landing on the shooter counts against the shot", r["self"] >= 3 and r["bad"] == 0, r)

    # On the basic maps the wind holds for windEvery (4) turns, then changes.
    r = ev("""(()=>{const T=window.__tc;T.S().turnTime=20;T.startGame('duo',['digger','digger'],'frontier');const w=[];
      for(let k=0;k<9;k++){for(let i=0;i<5;i++)T.update(1/60);w.push(T.get().wind);T.passTurn();}
      return {w:w.map(x=>+x.toFixed(2)),every:T.MAPS.map(m=>m.windEvery)};})()""")
    w = r["w"]
    check("wind holds for four turns on the basic maps", r["every"] == [4, 4, 4] and len(set(w[0:4])) == 1 and len(set(w[4:8])) == 1 and w[4] != w[0] and w[8] != w[4], r)

    check("no page errors", not errs, errs[:5])
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
