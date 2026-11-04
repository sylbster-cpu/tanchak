"""Balance numbers from computer-vs-computer games (not a pass/fail check).

Plays every pairing of mobiles, both seat orders, with the computer on both sides at one skill level,
and prints win rates per mobile and per pairing, what each shell does per use and per 1000 delay, how
long games run, and how often the side that shoots first wins.

    python tests/balance.py                 # 6 games per seat order per pairing at skill 0.7
    python tests/balance.py --games 12 --skill 0.5

Needs: pip install playwright && python -m playwright install chromium (or CHROME=/path/to/chrome)
"""
import argparse, json, os, pathlib, time
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = (ROOT / "index.html").as_uri() + "?test"

ap = argparse.ArgumentParser()
ap.add_argument("--games", type=int, default=6, help="games per seat order per pairing")
ap.add_argument("--skill", type=float, default=0.7)
ap.add_argument("--max-turns", type=int, default=60)
args = ap.parse_args()

GAME = """(([a, b, skill, maxTurns]) => {
  const T = window.__tc, S = T.S();
  S.aiSkill = skill; S.turnTime = 20;
  T.setAutoAll(true); T.startGame('ai', [a, b]);
  const uses = [];           // [shooter, shell, delay, damage to the other side]
  let open = null, turns = 0, last = '', firstShooter = null;
  for (let f = 0; f < 60 * 60 * 30; f++){
    T.update(1 / 60);
    const g = T.get();
    if (g.phase === 'flying' && last !== 'flying' && g.shells.length){
      const sh = g.shells[0], t = g.tanks[g.cur], o = g.tanks[1 - g.cur];
      if (firstShooter === null) firstShooter = g.cur;
      open = { who: g.cur, shell: sh.type, hp0: o.hp, o }; turns++;
    }
    if (open && (g.phase === 'over' || (last === 'settle' && g.phase !== 'settle'))){
      uses.push([open.who, open.shell, open.hp0 - open.o.hp]); open = null;
    }
    last = g.phase;
    if (g.phase === 'over' || turns >= maxTurns) break;
  }
  const g = T.get();
  T.setAutoAll(false);
  const alive = g.tanks.map(t => t.alive);
  return { winner: alive[0] && !alive[1] ? 0 : alive[1] && !alive[0] ? 1 : -1, turns, firstShooter, uses };
})"""

with sync_playwright() as p:
    exe = os.environ.get("CHROME")
    br = p.chromium.launch(**({"executable_path": exe} if exe else {}))
    pg = br.new_page()
    pg.route("**/*fonts.g*", lambda r: r.abort())
    pg.goto(URL); time.sleep(0.5)
    info = pg.evaluate("({mobiles: window.__tc.MOBILES.map(m => [m.id, m.name])})")
    mobs = [m[0] for m in info["mobiles"]]; names = dict(info["mobiles"])
    t0 = time.time()
    games = []
    for a in mobs:
        for b in mobs:
            for k in range(args.games):
                r = pg.evaluate(GAME, [a, b, args.skill, args.max_turns])
                r["mobs"] = [a, b]; games.append(r)
    br.close()

won = {m: [0, 0] for m in mobs}; pair = {}
shell = {}; first_wins = [0, 0]; turns = []; draws = 0
for g in games:
    a, b = g["mobs"]; turns.append(g["turns"])
    if g["winner"] < 0: draws += 1
    for side, m in enumerate((a, b)):
        won[m][1] += 1
        if g["winner"] == side: won[m][0] += 1
    if a != b:
        key = (a, b); pr = pair.setdefault(key, [0, 0]); pr[1] += 1
        if g["winner"] == 0: pr[0] += 1
    if g["winner"] >= 0 and g["firstShooter"] is not None:
        first_wins[1] += 1
        if g["winner"] == g["firstShooter"]: first_wins[0] += 1
    for who, sh, dmg in g["uses"]:
        sh = "split" if sh == "child" else sh
        s = shell.setdefault(sh, [0, 0, 0]); s[0] += 1; s[1] += max(0, dmg); s[2] += 1 if dmg > 0 else 0

print(f"{len(games)} games at skill {args.skill}, {round(time.time() - t0)}s; draws/unfinished {draws}; "
      f"turns per game avg {sum(turns) / len(turns):.1f}; first shooter won {first_wins[0]}/{first_wins[1]}")
print("win rate by mobile (mirror games count once per side):")
for m in mobs: print(f"  {names[m]:4} {won[m][0] / max(1, won[m][1]):.2f}  ({won[m][0]}/{won[m][1]})")
print("pairings, row's win rate against column (both seat orders):")
print("        " + " ".join(f"{names[m]:>5}" for m in mobs))
for a in mobs:
    row = []
    for b in mobs:
        if a == b: row.append("    -"); continue
        w = pair.get((a, b), [0, 0]); l = pair.get((b, a), [0, 0])
        tot = w[1] + l[1]; row.append(f"{(w[0] + (l[1] - l[0])) / max(1, tot):5.2f}")
    print(f"  {names[a]:4} " + " ".join(row))
print("shells: uses, hit rate, damage per use:")
for sh, (n, d, h) in sorted(shell.items(), key=lambda kv: -kv[1][0]):
    print(f"  {sh:7} {n:4}  {h / n:.2f}  {d / n:5.1f}")
