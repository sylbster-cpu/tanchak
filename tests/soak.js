// Autoplay soak test. Runs inside the page (loaded with ?test) and returns the invariant violations it saw.
// Plays 150,000 frames across all three modes with random movement and mostly AI-planned shots.
(() => {
  const T = window.__tc; const issues = []; const seen = new Set();
  const note = (k, m) => { if (!seen.has(k)) { seen.add(k); issues.push(m); } };
  const modes = ['ai', 'duo', 'practice'];
  let games = 0, frames = 0, phaseFrames = 0, lastPhase = '', maxOps = 0, maxParts = 0, practiceTurns = 0, turns = 0;
  let lastTurn = -1;
  T.startGame('ai');
  for (frames = 0; frames < 150000; frames++){
    let g = T.get();
    try {
      if ((g.phase === 'aim') && T.isHuman(g.cur)){
        const t = g.tanks[g.cur];
        const n = Math.floor(Math.random() * 60), dir = Math.random() < 0.5 ? -1 : 1;
        for (let i = 0; i < n; i++) T.moveTank(t, dir, 1 / 60);
        const pl = T.planShot(t); t.facing = pl.facing; t.elev = pl.elev;
        if (Math.random() < 0.15) { t.elev = Math.floor(Math.random() * 91); }
        T.fire(t, Math.random() < 0.1 ? Math.random() * 100 : pl.power);
      }
      T.update(1 / 60);
    } catch (e) { note('exc' + e.message, 'exception: ' + e.message + ' @phase ' + g.phase + ' ' + (e.stack || '').split('\n')[1]); }
    g = T.get();
    if (g.turnCount !== lastTurn){ lastTurn = g.turnCount; turns++; }
    for (const t of g.tanks){
      if (!isFinite(t.x) || !isFinite(t.y)) note('nan', 'tank position NaN in ' + g.mode);
      if (t.y >= 899 && t.alive && !t.airborne) note('bottom' + g.mode, 'alive tank resting at the world bottom (hidden under HUD) in mode ' + g.mode);
      if (t.hp < 0 || t.hp > 100) note('hp', 'hp out of range ' + t.hp);
    }
    for (const s of g.shells) if (!isFinite(s.x) || !isFinite(s.y)) note('snan', 'shell NaN');
    for (const [i, st] of g.stats.entries()){
      if (st.hits > st.shots) note('hits' + i, `stats: player ${i} hits ${st.hits} > shots ${st.shots} (mode ${g.mode})`);
      if (st.direct > st.hits) note('dir' + i, `stats: direct ${st.direct} > hits ${st.hits}`);
    }
    if (g.phase === lastPhase) phaseFrames++; else { phaseFrames = 0; lastPhase = g.phase; }
    if (phaseFrames > 60 * 30 && g.phase !== 'over') note('stuck' + g.phase, 'phase stuck >30s: ' + g.phase + ' mode ' + g.mode + ' shells ' + g.shells.length + ' timers ' + g.timers.length + ' tanks ' + JSON.stringify(g.tanks.map(t => ({ y: Math.round(t.y), air: t.airborne, vy: t.vy }))));
    maxOps = Math.max(maxOps, g.ops.length); maxParts = Math.max(maxParts, g.parts.length);
    if (g.mode === 'practice' && g.phase === 'aim') practiceTurns++;
    const switchPractice = g.mode === 'practice' && g.turnCount > 25;
    if (g.phase === 'over' || switchPractice || phaseFrames > 60 * 40){
      games++; T.startGame(modes[games % 3]); phaseFrames = 0;
    }
  }
  return { games, turns, frames, maxOps, maxParts, issues };
})()
