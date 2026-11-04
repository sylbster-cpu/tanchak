"""Screenshots for checking layout by eye: desktop and the phone sizes that have caused trouble.
For each size: start menu, aiming, the turn clock running low, and looking around by dragging.

    python tests/screens.py          # writes PNGs to tests/out/

Phones are emulated in landscape with touch on, so the touch console is used. The page's viewport
meta tag matters here: without it a phone lays the page out 980px wide and the small-screen rules
never apply, which hides real problems.
"""
import os, pathlib, time
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = (ROOT / "index.html").as_uri() + "?test"
OUT = pathlib.Path(__file__).parent / "out"
OUT.mkdir(exist_ok=True)

SIZES = [  # name, width, height, touch
    ("desktop", 1440, 810, False),
    ("phone-780x360", 780, 360, True),     # common Galaxy landscape size
    ("phone-915x412", 915, 412, True),
    ("phone-658x320", 658, 320, True),     # smallest we support
]

# Park the player's tank on the steepest slope on its side, so the hull-relative angle readout shows.
# The turn clock is switched off during the search so the computer does not take turns meanwhile.
SETUP = """(()=>{const T=window.__tc;const tt=T.S().turnTime;T.S().turnTime=0;T.startGame('ai');const g=T.get();const a=g.tanks[0];
  let bx=a.x,bs=0; const x0=a.x;
  for(let x=Math.max(60,x0-400);x<Math.min(g.tanks[1].x-220,x0+400);x+=12){ a.x=x; a.y=260; a.vy=0; for(let i=0;i<100;i++)T.update(1/60);
    if(Math.abs(a.tilt)>bs){bs=Math.abs(a.tilt);bx=x;} }
  a.x=bx; a.y=260; a.vy=0; a.fuel=120; for(let i=0;i<90;i++)T.update(1/60);
  T.S().turnTime=tt; T.endTurn(); T.endTurn();  // two hand-overs restart the clock on the player's turn
  a.elev=52; a.lastPower=63; a.lastElev=48; a.lastFacing=1;})()"""

with sync_playwright() as p:
    exe = os.environ.get("CHROME")
    b = p.chromium.launch(**({"executable_path": exe} if exe else {}))
    errs = []
    for name, w, h, touch in SIZES:
        c = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=2 if touch else 1,
                          has_touch=touch, is_mobile=touch)
        pg = c.new_page()
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.route("**/*fonts.g*", lambda r: r.abort())
        pg.goto(URL); time.sleep(1.0)
        pg.screenshot(path=str(OUT / f"{name}-menu.png"))
        pg.evaluate(SETUP); time.sleep(1.8)
        pg.screenshot(path=str(OUT / f"{name}-aim.png"))
        pg.evaluate("(()=>{const T=window.__tc;for(let i=0;i<60*16;i++)T.update(1/60);})()"); time.sleep(0.3)
        pg.screenshot(path=str(OUT / f"{name}-clock.png"))
        # drag the battlefield toward the opponent: free look, the minimap frame and the edge marker for our tank
        y = h * 0.5
        pg.mouse.move(w * 0.85, y); pg.mouse.down()
        for k in range(1, 11): pg.mouse.move(w * 0.85 - w * 0.07 * k, y)
        pg.mouse.up(); time.sleep(0.4)
        pg.screenshot(path=str(OUT / f"{name}-look.png"))
        c.close()
    b.close()
    print("saved to", OUT, "| page errors:", errs[:5])
