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
        a.sel='split'; a.cards.split=2; a.facing=1; a.elev=el; T.fire(a,pw); for(let i=0;i<600;i++){T.update(1/60); if(T.get().phase!=='flying')break;}
        const st=T.get().stats[0], lost=100-b.hp; if(lost>best.hpLost) best={hits:st.hits, shots:st.shots, direct:st.direct, hpLost:lost};
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
      for(let i=0;i<300;i++)T.moveTank(a,1,1/60); return {gap:Math.round(b.x-a.x)};})()""")
    check("tanks cannot drive through each other", r["gap"] >= 50, r)

    # At full skill the computer's drill shots should land (it used to plan them like normal shells).
    r = ev("""(()=>{const T=window.__tc;const res=[]; const s0=T.S().aiSkill; T.S().aiSkill=1;
      for(let k=0;k<4;k++){T.startGame('ai');const g=T.get(), a=g.tanks[1], b=g.tanks[0];
        a.cards={basic:Infinity,heavy:0,split:0,drill:2,calm:0};
        let pl=T.planShot(a); for(let n=0;n<40 && a.sel!=='drill';n++) pl=T.planShot(a);
        if(a.sel!=='drill'){res.push(null);continue;}
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
      const shoot=sel=>{let g=T.get();const t=g.tanks[g.cur];t.sel=sel;t.cards[sel]=9;t.facing=t.i===0?-1:1;t.elev=45;T.fire(t,100);
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

    check("no page errors", not errs, errs[:5])
    b.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
sys.exit(1 if failed else 0)
