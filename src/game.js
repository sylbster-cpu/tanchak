
(() => {
'use strict';
// The world is several screens wide; the camera follows the action and the minimap shows the whole of it.
// solid takes W*H bytes; the two terrain canvases take W*H*4 bytes each (3200x900: 2.9 MB + 2 x 11.5 MB).
const W = 3200, H = 900;
const FEATURE = 1600;               // terrain and scenery wavelengths are set per this many px, so a wider map gets more hills, not stretched ones
const VIEW_W = 1100, VIEW_H = 520;  // at zoom 1 the screen shows about this much of the world (the tighter of the two wins)
// windEvery: the wind holds for this many turns, so both sides get to correct a shot in the same wind on these
// basic maps. A harder map can change it more often (1 = a new wind every turn).
const MAPS = [
  { id: 'frontier', name: '전선', desc: '완만한 능선과 중간 언덕', sky: ['#769caa','#7ea4ad','#88adb1','#94b6b5','#a3c0b8','#b3c9bb','#c4d1bc','#d4d8bf'], scene: ['#82a6a2','#577f7a','#3d6359'], windEvery: 4 },
  { id: 'canyon', name: '협곡', desc: '낮은 계곡을 사이에 둔 원거리 포격', sky: ['#9c928c','#ac9c91','#bda99a','#cab5a0','#d4bfa4','#dfc9ae','#e6d3ba','#edddc4'], scene: ['#b7a39a','#957b72','#6e5d58'], windEvery: 4 },
  { id: 'highland', name: '고원', desc: '높은 중앙 지형과 급경사 측면', sky: ['#687b99','#748ba7','#8196ac','#91a5b5','#a6b7bd','#bac6c2','#cbd0be','#ded5bb'], scene: ['#8c9fab','#637f91','#476777'], windEvery: 4 }
];
const MAP_BY_ID = Object.fromEntries(MAPS.map(m => [m.id, m]));
const MAP_KEY = 'shellbound-map-v1';   // key from before the name went back to 탄착점; kept so the saved choice survives
let mapChoice = 'random', currentMap = MAPS[0];
try { const savedMap = localStorage.getItem(MAP_KEY); if (savedMap === 'random' || MAP_BY_ID[savedMap]) mapChoice = savedMap; } catch(e) {}
const SPAWN_GAP = [850, 1300];      // distance between the two batteries; full power on flat ground carries about 2000
const KEY = 'tanchak-tuning-v1';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TANK_R = 27, TANK_CY = 15, PIVOT_H = 26, MUZZLE = 38;
const NO_GROUND = H + 1000;

const DEFAULTS = {
  gravity: 500, windMax: 90, powerScale: 1.0, gaugeSpeed: 70, pingPong: false, moveSpeed: 70, aimLineOn: true,
  viewZoom: 1.0, readoutOn: true, latencyOn: false,
  juice: true,
  hitStop: 70, hitStopOn: true,
  shake: reduceMotion ? 0.35 : 1.0, shakeOn: true,
  slowFactor: 0.3, slowRadius: 150, slowOn: true,
  camZoom: reduceMotion ? 1.1 : 1.25, camOn: true, camDelay: 0.4,
  particles: 1.0, particlesOn: true,
  recoil: 1.0, recoilOn: true,
  flashOn: true, numbersOn: true, trailOn: true,
  volume: 0.7, soundOn: true, musicOn: true, musicVolume: 0.4, sfxOn: true, sfxVolume: 0.85, vibrateOn: true,
  turnTime: 20, delayOn: true, handSize: 2,
  aiSkill: 0.5
};
let S = Object.assign({}, DEFAULTS);
let savedSettings = null;
try { savedSettings = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
let saveTimer = 0;
function saveSettings(){ clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }, 250); }
const J = name => S.juice && S[name + 'On'];

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rand = (a, b) => a + Math.random() * (b - a);
const randn = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const DEG = Math.PI / 180;
const $ = s => document.querySelector(s);

/* ---------- shells ---------- */
const ICONS = {
  basic: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="currentColor"/></svg>',
  heavy: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/><circle cx="9" cy="9" r="2.4" fill="#0a0e0a" opacity=".45"/></svg>',
  split: '<svg viewBox="0 0 24 24"><circle cx="5" cy="15" r="3.4" fill="currentColor"/><circle cx="12" cy="8" r="3.4" fill="currentColor"/><circle cx="19" cy="15" r="3.4" fill="currentColor"/></svg>',
  drill: '<svg viewBox="0 0 24 24"><path d="M6 4h12l-6 17z" fill="currentColor"/><path d="M8 9h8M9.5 13h5" stroke="#0a0e0a" stroke-width="1.6" opacity=".55"/></svg>',
  calm: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="currentColor"/><path d="M2 6h6M2 18h6M16 6h6M16 18h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".5"/><path d="M4 21L20 3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  pierce: '<svg viewBox="0 0 24 24"><path d="M3 12l7-5h9l3 5-3 5h-9z" fill="currentColor"/><path d="M10 7v10" stroke="#0a0e0a" stroke-width="1.6" opacity=".55"/></svg>',
  bounce: '<svg viewBox="0 0 24 24"><path d="M2 20h20" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".5"/><path d="M3 6q4 14 8 14t8-10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="2 3" stroke-linecap="round" opacity=".7"/><circle cx="19" cy="9" r="4" fill="currentColor"/></svg>'
};
const SHELLS = [
  { id: 'basic', name: '기본탄', uses: Infinity, r: 38, dmg: 32, gMul: 1, vMul: 1, windMul: 1, delay: 780, desc: '수량 제한 없이 사용할 수 있습니다.' },
  { id: 'heavy', name: '대형탄', uses: 2, r: 62, dmg: 46, gMul: 1.18, vMul: 0.96, windMul: 0.8, delay: 1450, desc: '폭발 범위가 넓고 바람의 영향을 덜 받습니다.' },
  { id: 'split', name: '분열탄', uses: 2, r: 27, dmg: 20, gMul: 1, vMul: 1, windMul: 1, split: true, delay: 1000, desc: '가장 높은 지점에서 세 갈래로 나뉩니다.' },
  { id: 'drill', name: '굴착탄', uses: 2, r: 34, dmg: 30, gMul: 1, vMul: 1, windMul: 1, drill: true, delay: 940, desc: '땅속으로 파고든 뒤 폭발합니다.' },
  { id: 'calm', name: '무풍탄', uses: 2, r: 32, dmg: 30, gMul: 1, vMul: 1, windMul: 0, delay: 840, desc: '바람의 영향을 받지 않습니다.' },
  // the two below are mobile-only shells; split and drill above are mobile-only too (see MOBILES)
  { id: 'pierce', name: '철갑탄', uses: 2, r: 26, dmg: 24, directMul: 2.4, gMul: 1, vMul: 1.05, windMul: 0.7, delay: 1000, desc: '빠르게 날아가며 직격 시 큰 피해를 줍니다.' },
  { id: 'bounce', name: '도약탄', uses: 2, r: 34, dmg: 30, gMul: 1, vMul: 1, windMul: 1, bounce: true, delay: 900, desc: '땅에 한 번 튕긴 뒤 폭발합니다.' }
];
// Mobiles (our own values, not taken from GunBound). Each has the three shared shells plus one of its own.
// ang is the barrel range measured from the hull; climb is the highest step (px) it can drive up.
const MOBILES = [
  { id: 'light', name: '스카우트', desc: '빠르고 멀리 움직이지만 체력이 낮습니다.', hp: 90, fuel: 180, speed: 1.25, climb: 14, delayMul: 0.95, ang: [0, 80], shells: ['basic', 'heavy', 'calm', 'bounce'] },
  { id: 'armored', name: '타이탄', desc: '튼튼하고 철갑탄이 강력합니다. 기동성은 낮고 발사 후 다음 턴이 늦습니다.', hp: 110, fuel: 80, speed: 0.8, climb: 9, delayMul: 1.12, ang: [0, 55], shells: ['basic', 'heavy', 'calm', 'pierce'] },
  { id: 'howitzer', name: '코멧', desc: '높은 각도로 언덕 너머를 노립니다. 분열탄은 넓게 퍼집니다.', hp: 105, fuel: 110, speed: 1, climb: 11, delayMul: 0.95, ang: [40, 90], shells: ['basic', 'heavy', 'calm', 'split'] },
  { id: 'digger', name: '드릴러', desc: '급경사를 잘 오릅니다. 굴착탄이 지형 속으로 파고듭니다.', hp: 105, fuel: 130, speed: 1, climb: 18, ang: [15, 75], shells: ['basic', 'heavy', 'calm', 'drill'] }
];
const MOBILE = Object.fromEntries(MOBILES.map(m => [m.id, m]));
// a shot's delay on this mobile (some reload faster or slower: MOBILES[].delayMul)
function shotDelay(t, id){ return Math.round(SHELL[id].delay * (t.m.delayMul || 1)); }
const DEFAULT_PICKS = ['digger', 'digger'];   // used when a game starts without a choice (tests, the idle scene picks its own)
// white silhouettes for the player plates, facing right (the right-hand plate mirrors them)
const MOBILE_ICONS = {
  light: '<svg viewBox="0 0 32 22" aria-hidden="true"><path d="M4 15h24l-4-5h-6l-1-2h-5l-1 2H7z" fill="#fff"/><path d="M15 8l15-5" stroke="#fff" stroke-width="2" stroke-linecap="round"/><rect x="3" y="15" width="26" height="5" rx="2.5" fill="#0b0f0c" opacity=".55"/></svg>',
  armored: '<svg viewBox="0 0 32 22" aria-hidden="true"><path d="M2 15h28l-2-8h-7l-1-3h-9l-1 3H4z" fill="#fff"/><path d="M16 5l10-3" stroke="#fff" stroke-width="4" stroke-linecap="round"/><rect x="1" y="15" width="30" height="6" rx="3" fill="#0b0f0c" opacity=".55"/></svg>',
  howitzer: '<svg viewBox="0 0 32 22" aria-hidden="true"><path d="M3 15h26l-3-5H6z" fill="#fff"/><rect x="11" y="7" width="9" height="4" rx="1" fill="#fff"/><path d="M16 8l6-7" stroke="#fff" stroke-width="5" stroke-linecap="round"/><rect x="2" y="15" width="28" height="6" rx="3" fill="#0b0f0c" opacity=".55"/></svg>',
  digger: '<svg viewBox="0 0 32 22" aria-hidden="true"><path d="M3 15h21l-3-6h-5l-1-2h-5l-1 2H6z" fill="#fff"/><path d="M24 8l7 4-7 4z" fill="#fff"/><path d="M14 7l11-4" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><rect x="2" y="15" width="24" height="6" rx="3" fill="#0b0f0c" opacity=".55"/></svg>'
};
// Turn order follows GunBound's delay rule: each action adds delay, every second of thinking adds 10,
// and whoever has the lower total moves next. Skipping costs less than shooting.
const PASS_DELAY = 500;
const MIN_FIRE_POWER = 12;  // a quick tap cancels; it must not launch a zero-speed shell into the shooter
const TURN_PHASES = ['aim', 'charging', 'aiThink', 'aiMove', 'aiAim', 'aiCharge'];
const SHELL = Object.fromEntries(SHELLS.map(s => [s.id, s]));
const SPLIT_SPREAD = [-115, 0, 115];   // sideways speed added to each piece of a split shell
const SPLIT_REPEAT = 0.5;              // a second or third piece hitting the same tank does this share of its damage
SHELL.child = { id: 'child', r: 27, dmg: 20, gMul: 1, vMul: 1, windMul: 1 };

/* ---------- canvas & view ---------- */
const cvs = $('#game'), gameCtx = cvs.getContext('2d');
let ctx = gameCtx;   // drawing functions use ctx; the mobile previews point it at their own canvas for a moment
let cw = 0, ch = 0, dpr = 1, hudTopBottom = 80;
let portraitOk = false;
function resize(){
  dpr = Math.min(2, window.devicePixelRatio || 1);
  cw = window.innerWidth; ch = window.innerHeight;
  cvs.width = Math.round(cw * dpr); cvs.height = Math.round(ch * dpr);
  measureHud();
  sizeDial(); sizeMinimap();
  checkRotate();
}
window.addEventListener('resize', resize);
// The play area is the strip between the top HUD and the console; the camera frames things inside it.
function measureHud(){
  const top = $('#hud-top').getBoundingClientRect(), con = $('#console').getBoundingClientRect();
  hudTopBottom = Math.max(60, top.bottom);
  playTop = hudTopBottom;
  playBot = (con.height > 0 && con.top > playTop + 40) ? con.top : ch;
  $('#toast').style.top = Math.round(hudTopBottom + 8) + 'px';
  if (fxOpen) renderFxPop();   // the hand sits on the console; follow it when the layout changes
}

/* ---------- terrain ---------- */
// Two off-screen layers: a dark back wall (never carved) and the destructible ground on top of it.
// Browsers may wipe off-screen canvases when they drop drawing resources, so both can always be
// repainted from data: the surface line, the grass tufts and the list of craters.
const terr = document.createElement('canvas'); terr.width = W; terr.height = H;
const tctx = terr.getContext('2d');
const back = document.createElement('canvas'); back.width = W; back.height = H;
const bctx = back.getContext('2d');
let solid = new Uint8Array(W * H);
let top0 = new Float32Array(W).fill(H), tufts = [], ops = [];
let edgeL = H * 0.6, edgeR = H * 0.6;
let terrLost = false, terrVer = 0;   // terrVer counts terrain changes so the minimap knows when to redraw
function isSolid(x, y){
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || x >= W || y < 0 || y >= H) return false;
  return solid[y * W + x] === 1;
}
function groundY(x, y0){
  x = Math.round(x);
  if (x < 0 || x >= W) return NO_GROUND;
  let y = Math.max(0, Math.floor(y0));
  for (; y < H; y++) if (solid[y * W + x]) return y;
  return NO_GROUND;
}
function hash2(x, y){
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const C = [0, 0, 0];
// A restrained, stepped palette: grass, dry topsoil, then broad rock strata. Texture is
// clustered on a 3 px grid; individual collision pixels are still kept at full resolution.
const SOIL_PALETTES = {
  frontier: [[34,65,58], [172,194,119], [111,149,84], [65,105,68], [66,72,53], [167,137,91], [126,106,79], [143,117,83], [113,96,77], [133,110,82]],
  canyon: [[83,86,61], [207,177,112], [174,138,84], [153,119,76], [114,88,65], [179,130,96], [151,111,86], [162,117,86], [123,91,75], [145,103,80]],
  highland: [[36,59,68], [164,188,144], [106,149,130], [73,110,106], [69,77,89], [133,139,140], [98,105,116], [119,121,126], [84,91,108], [101,111,129]]
};
function soil(y, depth, wob){
  const band = depth < 2 ? 0 : depth < 6 ? 1 : depth < 11 ? 2 : depth < 17 ? 3 : depth < 26 ? 4 : depth < 54 ? 5 : 6 + Math.floor((y + wob * 7) / 74) % 4;
  const c = SOIL_PALETTES[currentMap.id][band];
  const shade = depth > 400 ? 0.68 : depth > 230 ? 0.83 : 1;
  C[0] = c[0] * shade; C[1] = c[1] * shade; C[2] = c[2] * shade;
}
function pickSpawns(){
  const gap = rand(SPAWN_GAP[0], SPAWN_GAP[1]), x0 = rand(180, W - 180 - gap);
  return [Math.round(x0), Math.round(x0 + gap)];
}
function genTerrain(spawns){
  const top = new Float32Array(W);
  const a1 = rand(0, 6.28), a2 = rand(0, 6.28), a3 = rand(0, 6.28);
  // Terrain features define different lines of fire, not just different background colors.
  const center = (spawns[0] + spawns[1]) / 2;
  const bumps = [];
  if (currentMap.id === 'canyon'){
    bumps.push({ x: center, w: rand(165, 235), h: -rand(110, 165) }); // open low valley
    bumps.push({ x: center - 340, w: 125, h: rand(45, 90) });
    bumps.push({ x: center + 340, w: 125, h: rand(45, 90) });
  } else if (currentMap.id === 'highland'){
    bumps.push({ x: center, w: rand(210, 290), h: rand(135, 180) }); // central plateau
    bumps.push({ x: center - 410, w: 125, h: rand(-45, 55) });
    bumps.push({ x: center + 410, w: 125, h: rand(-45, 55) });
  } else bumps.push({ x: center, w: rand(128, 224), h: rand(70, 170) });
  for (let k = 0, n = Math.round(2 * W / FEATURE); k < n; k++) bumps.push({ x: rand(0, W), w: rand(120, 260), h: rand(-60, 120) });
  for (let x = 0; x < W; x++){
    const t = x / FEATURE;
    const wave = currentMap.id === 'canyon' ? 0.62 : currentMap.id === 'highland' ? 0.8 : 1;
    let y = H * 0.55 + Math.sin(t * 6.9 + a1) * 50 * wave + Math.sin(t * 17 + a2) * 24 * wave + Math.sin(t * 40 + a3) * 7 * wave;
    for (const b of bumps) y -= Math.exp(-(((x - b.x) / b.w) ** 2)) * b.h;
    top[x] = clamp(y, H * 0.28, H * 0.69);
  }
  for (const sx of spawns){
    let avg = 0, n = 0;
    for (let x = sx - 30; x <= sx + 30; x++){ avg += top[x]; n++; }
    avg = Math.min(avg / n, H * 0.6);
    for (let x = sx - 70; x <= sx + 70; x++){
      if (x < 0 || x >= W) continue;
      const k = clamp(1 - (Math.abs(x - sx) - 30) / 40, 0, 1);
      top[x] = top[x] * (1 - k) + avg * k;
    }
  }
  top0 = top; edgeL = top[0]; edgeR = top[W - 1];
  solid = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) for (let y = Math.max(0, Math.ceil(top[x])); y < H; y++) solid[y * W + x] = 1;
  tufts = [];
  for (let x = 2; x < W; x += 4) tufts.push([x, top[x], rand(-2.5, 2.5), rand(3, 8)]);
  ops = [];
  terrVer++;
  paintTerrain();
}
// Painted in vertical strips so the temporary pixel buffers stay small (a full-size pair would be 23 MB at 3200x900).
const STRIP = 256;
function paintTerrain(){
  const fi = tctx.createImageData(STRIP, H), fd = fi.data;
  const bi = bctx.createImageData(STRIP, H), bd = bi.data;
  tctx.save();
  tctx.globalCompositeOperation = 'source-over';
  tctx.clearRect(0, 0, W, H);
  for (let x0 = 0; x0 < W; x0 += STRIP){
    fd.fill(0); bd.fill(0);
    for (let x = x0, x1 = Math.min(W, x0 + STRIP); x < x1; x++){
      const sy = Math.max(0, Math.ceil(top0[x]));
      const wob = Math.round(Math.sin(Math.floor(x / 6) * 0.024) * 3);
      for (let y = sy; y < H; y++){
        const i = y * W + x, p = (y * STRIP + x - x0) * 4, depth = y - top0[x];
        const grain = hash2(Math.floor(x / 3), Math.floor(y / 3));
        const n = grain < 0.1 ? -5 : grain > 0.92 ? 5 : 0;
        soil(y, Math.max(depth, 26), wob);
        bd[p] = C[0] * 0.38 + n * 0.25; bd[p + 1] = C[1] * 0.42 + n * 0.25; bd[p + 2] = C[2] * 0.48 + n * 0.25; bd[p + 3] = 255;
        if (!solid[i]) continue;
        if (depth < 26) soil(y, depth, wob);
        fd[p] = C[0] + n; fd[p + 1] = C[1] + n; fd[p + 2] = C[2] + n; fd[p + 3] = 255;
      }
    }
    bctx.putImageData(bi, x0, 0);
    tctx.putImageData(fi, x0, 0);
  }
  // Broad, uneven rock faces leave quiet stretches of soil between them. Integer
  // strips keep the pixel edge; source-atop preserves every existing alpha value.
  tctx.globalCompositeOperation = 'source-atop';
  for (let row = 0, y = 105; y < H; row++, y += 117){
    for (let x = -90 + (row % 2) * 79; x < W; x += 171){
      const n = hash2(x, y), q = hash2(y, x), v = hash2(x + 37, y + 91);
      if (n < 0.3) continue;
      const px = Math.floor((x + q * 90) / 3) * 3, py = Math.floor((y + (n - 0.5) * 57) / 3) * 3;
      const w = 87 + Math.floor(q * 38) * 3, h = 33 + Math.floor(v * 17) * 3;
      let surface = 0;
      for (let sx = Math.max(0, px); sx < Math.min(W, px + w); sx += 3) surface = Math.max(surface, top0[sx]);
      if (py < surface + 57) continue;
      const shade = py - surface > 240, cut = 0.24 + n * 0.3, fold = 0.18 + v * 0.38;
      tctx.fillStyle = shade ? (v < 0.5 ? '#625a48' : '#6b5e49') : (v < 0.5 ? '#897250' : '#78664d');
      for (let dy = 0; dy < h; dy += 3){
        const t = dy / h;
        const left = t < cut ? (1 - t / cut) * w * (0.12 + v * 0.16) : (t - cut) * w * (v - 0.25) * 0.45;
        const right = t < fold ? w * (0.64 + q * 0.24 + t / fold * (0.36 - q * 0.24)) : w * (1 - (t - fold) * (0.12 + n * 0.32));
        const chip = n > 0.62 && t > 0.45 && t < 0.72 ? 9 : 0;
        const a = Math.floor(left / 3) * 3 + chip, b = Math.floor(right / 3) * 3;
        tctx.fillRect(px + a, py + dy, b - a, 3);
      }
      // A broken seam on a few faces is enough; no repeated bevel or dark outline.
      if (n > 0.86){
        tctx.fillStyle = shade ? '#76694f' : '#9b8058';
        const sx = px + Math.floor(w * (0.2 + v * 0.12) / 3) * 3, sy = py + Math.floor(h * cut / 3) * 3;
        const len = Math.floor(w * 0.24 / 3) * 3;
        tctx.fillRect(sx, sy, len, 3);
        tctx.fillRect(sx + len, sy - 3, 9, 3);
      }
      if (q > 0.72){
        tctx.fillStyle = shade ? '#625a48' : '#897250';
        tctx.fillRect(px + w + 12, py + h - 6, 12, 6);
        tctx.fillRect(px + w + 15, py + h - 9, 6, 3);
      }
    }
  }
  // Sparse mineral seams and roots give the ground scale without covering it in dots.
  for (let x = 31; x < W; x += 117){
    const y = Math.ceil(top0[x]) + 30, n = hash2(x, 45);
    tctx.fillStyle = '#c1a576';
    tctx.fillRect(x, y + Math.floor(n * 7) * 3, 12 + Math.floor(n * 7) * 3, 3);
    tctx.fillStyle = '#464c36';
    if (n > 0.35){ tctx.fillRect(x + 8, y - 13, 3, 18); tctx.fillRect(x + 11, y, 9, 3); }
  }
  tctx.globalCompositeOperation = 'source-over';
  for (const [x, y, dx, h] of tufts){
    if (!isSolid(x, Math.ceil(y) + 4) || hash2(x, 71) < 0.42) continue;
    const px = Math.floor(x / 3) * 3, py = Math.floor(y), ph = Math.round(h / 3) * 3;
    tctx.fillStyle = '#315c48'; tctx.fillRect(px, py - ph, 3, ph + 2);
    tctx.fillStyle = '#a9c77e'; tctx.fillRect(px, py - ph, 3, 3);
    if (dx > 0.8){ tctx.fillStyle = '#6c995b'; tctx.fillRect(px + 3, py - 3, 3, 4); }
  }
  // Groundcover stays attached to the destructible layer, so a crater removes it too.
  for (let x = 48; x < W - 20; x += 89){
    const n = hash2(x, 203), y = Math.floor(top0[x]);
    if (!isSolid(x, y + 4) || n < 0.3) continue;
    if (n > 0.78){
      tctx.fillStyle = '#384c46'; tctx.fillRect(x - 6, y - 4, 15, 6); tctx.fillRect(x - 3, y - 7, 9, 3);
      tctx.fillStyle = '#98aa82'; tctx.fillRect(x - 3, y - 7, 6, 3); tctx.fillRect(x - 6, y - 4, 3, 3);
    } else {
      tctx.fillStyle = '#386d50'; tctx.fillRect(x - 6, y - 6, 12, 6); tctx.fillRect(x - 3, y - 9, 6, 3);
      tctx.fillStyle = '#80a966'; tctx.fillRect(x - 3, y - 9, 3, 3); tctx.fillRect(x + 3, y - 6, 3, 3);
    }
  }
  tctx.restore();
  for (const o of ops) drawCarve(o);
  terrLost = false;
}
function carve(cx, cy, r, scorch){
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++){
    const dy = y - cy, row = y * W;
    for (let x = x0; x <= x1; x++){ const dx = x - cx; if (dx * dx + dy * dy <= r2) solid[row + x] = 0; }
  }
  const o = { cx, cy, r, scorch };
  ops.push(o); drawCarve(o); terrVer++;
}
function drawCarve(o){
  const { cx, cy, r, scorch } = o;
  tctx.save();
  tctx.globalCompositeOperation = 'destination-out';
  tctx.beginPath(); tctx.arc(cx, cy, r, 0, Math.PI * 2); tctx.fill();
  tctx.globalCompositeOperation = 'source-atop';
  if (scorch){
    const g = tctx.createRadialGradient(cx, cy, r * 0.92, cx, cy, r + 15);
    g.addColorStop(0, 'rgba(34,16,10,.6)'); g.addColorStop(1, 'rgba(34,16,10,0)');
    tctx.fillStyle = g; tctx.beginPath(); tctx.arc(cx, cy, r + 15, 0, Math.PI * 2); tctx.fill();
  }
  tctx.strokeStyle = 'rgba(52,30,18,.95)'; tctx.lineWidth = scorch ? 5 : 3.5;
  tctx.beginPath(); tctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2); tctx.stroke();
  tctx.restore();
}
terr.addEventListener('contextlost', () => { terrLost = true; });
terr.addEventListener('contextrestored', () => paintTerrain());
back.addEventListener('contextlost', () => { terrLost = true; });
back.addEventListener('contextrestored', () => paintTerrain());
function checkTerrain(){
  if (visualArtRestorePending) restoreVisualArt();
  if ((tctx.isContextLost && tctx.isContextLost()) || (bctx.isContextLost && bctx.isContextLost())){ terrLost = true; return; }
  if (terrLost) paintTerrain();
}
// Repaint only after the page was really hidden: pageshow and visibilitychange both fire when a page comes
// back, and pageshow also fires on the first load, when start() has just painted everything.
let wasHidden = false;
function onResume(){
  if (document.hidden){ wasHidden = true; return; }
  if (wasHidden){
    wasHidden = false;
    paintTerrain();
    restoreVisualArt(true);
    Snd.resume();
  }
  lastT = performance.now();   // after the repaint: coming back does not use up the paused turn clock
}
document.addEventListener('visibilitychange', onResume);
window.addEventListener('pagehide', () => { wasHidden = true; });
window.addEventListener('pageshow', onResume);

/* ---------- scenery ---------- */
// Mobile browsers can discard any offscreen canvas, not just the terrain. Track
// restoration once for the whole art cache, and ignore events from retired canvases.
let visualArtEpoch = 0, visualArtLost = false, visualArtRestorePending = false;
function visualCanvas(w, h){
  const cv = document.createElement('canvas'), epoch = visualArtEpoch;
  cv.width = w; cv.height = h;
  cv.addEventListener('contextlost', () => { if (epoch === visualArtEpoch) visualArtLost = true; });
  cv.addEventListener('contextrestored', () => {
    if (epoch !== visualArtEpoch) return;
    visualArtLost = true; visualArtRestorePending = true;
  });
  return cv;
}
let hills = [], clouds = [], motes = [];
const SCENE_PIXEL = 4, SCENE_X = -900;
let cloudArt = null, sunArt = null;
function pixelDisc(g, x, y, r, color){
  g.fillStyle = color;
  for (let dy = -r; dy <= r; dy++){
    const dx = Math.floor(Math.sqrt(r * r - dy * dy));
    g.fillRect(x - dx, y + dy, dx * 2 + 1, 1);
  }
}
function pixelLine(g, x0, y0, x1, y1, color){
  g.fillStyle = color;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let e = dx + dy;
  while (true){
    g.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const d = e * 2;
    if (d >= dy){ e += dy; x0 += sx; }
    if (d <= dx){ e += dx; y0 += sy; }
  }
}
function sceneryPine(g, x, y, h, dark, light){
  g.fillStyle = dark; g.fillRect(x - 1, y - h, 2, h + 2);
  for (let i = 2; i < h; i += 2){
    const tier = i < h * 0.34 ? 0.64 : i < h * 0.66 ? 0.8 : 1;
    const w = Math.max(1, Math.floor(i * 0.31 * tier));
    g.fillStyle = dark; g.fillRect(x - w, y - h + i, w * 2 + 1, 2);
    g.fillStyle = light; g.fillRect(x - w, y - h + i, Math.max(1, Math.floor(w * 0.44)), 1);
  }
}
function makeSceneryLayer(L, index){
  const cv = visualCanvas(Math.ceil((W + 1800) / SCENE_PIXEL), Math.ceil((H + 600) / SCENE_PIXEL));
  const g = cv.getContext('2d'), ridge = new Int16Array(cv.width);
  // Paint one integer column at a time: even slopes have a deliberate pixel edge.
  for (let x = 0; x < cv.width; x++){
    const t = (x * SCENE_PIXEL + SCENE_X) / FEATURE;
    const y = H * L.base - L.amp * (0.55 * Math.sin(t * L.f[0] + L.ph[0]) + 0.3 * Math.sin(t * L.f[1] + L.ph[1]) + 0.15 * Math.sin(t * L.f[2] + L.ph[2]) + 0.6);
    ridge[x] = Math.round(y / SCENE_PIXEL);
    g.fillStyle = L.col; g.fillRect(x, ridge[x], 1, cv.height - ridge[x]);
  }
  if (index === 0){
    // Broken rock faces on the distant range, kept low-contrast for clear aiming.
    for (let x = 30; x < cv.width - 55; x += 73){
      const y = ridge[x], w = 18 + Math.floor(hash2(x, 13) * 20);
      g.fillStyle = '#95b5ad';
      for (let j = 0; j < w; j++){
        const top = ridge[x + j] + 3;
        const h = Math.max(0, y + 22 - top - Math.floor(j * 0.48));
        if (h) g.fillRect(x + j, top, 1, h);
      }
    }
  } else {
    const tints = currentMap.id === 'canyon' ? ['#896e65','#b09578','#685b57','#917b66']
                : currentMap.id === 'highland' ? ['#526f80','#6b9197','#385c69','#64858c']
                : ['#4f7776','#648d84','#355c59','#477467'];
    const dark = index === 1 ? tints[0] : tints[2], light = index === 1 ? tints[1] : tints[3];
    for (let x = 5; x < cv.width - 12; x += 9 + index * 3){
      const n = hash2(x, index * 97), h = Math.round((index === 1 ? 10 : 14) + n * (index === 1 ? 15 : 23));
      if (currentMap.id === 'canyon'){
        if (n > 0.57){ // sparse weathered rock spires instead of forest silhouettes
          const sx = x - 2, sy = ridge[x] + 4, rh = Math.round(h * 0.72);
          g.fillStyle = dark; g.fillRect(sx, sy - rh, 5 + Math.round(n * 3), rh + 3);
          g.fillStyle = light; g.fillRect(sx + 1, sy - rh, 2, rh - 2);
        }
      } else {
        sceneryPine(g, x, ridge[x] + 6, h, dark, light);
        if (n > 0.67) sceneryPine(g, x + 5, ridge[x + 5] + 7, Math.round(h * 0.7), dark, light);
      }
    }
  }
  if (index === 1){
    // The radio posts are scenery, never targets or collision geometry.
    for (let x = 170; x < cv.width - 30; x += 296){
      const y = ridge[x] + 7, h = 35;
      pixelLine(g, x, y - h, x - 8, y, '#476f72');
      pixelLine(g, x, y - h, x + 8, y, '#476f72');
      for (let j = 7; j < h; j += 7){
        const w = Math.floor(j * 0.23), yy = y - h + j;
        g.fillStyle = '#476f72'; g.fillRect(x - w - 2, yy, w * 2 + 5, 1);
        pixelLine(g, x - w, yy, x + w + 1, yy + 6, '#476f72');
      }
      g.fillStyle = '#476f72'; g.fillRect(x, y - h - 6, 1, 7); g.fillRect(x - 5, y - h + 2, 11, 1);
      g.fillStyle = '#d2ba7c'; g.fillRect(x, y - h - 7, 1, 2);
      g.fillStyle = '#557e78'; g.fillRect(x + 10, y - 8, 21, 9); g.fillRect(x + 13, y - 11, 15, 3);
      g.fillStyle = '#8aa18a'; g.fillRect(x + 14, y - 7, 4, 2); g.fillRect(x + 22, y - 7, 4, 2);
    }
  }
  return { cv, p: L.p, recipe: L, index };
}
function buildSkyArt(){
  cloudArt = visualCanvas(76, 30);
  const g = cloudArt.getContext('2d');
  for (const [x, y, r] of [[15, 19, 7], [28, 14, 12], [43, 16, 9], [56, 20, 7]]) pixelDisc(g, x, y, r, '#b2c6b7');
  g.fillStyle = '#b2c6b7'; g.fillRect(11, 20, 51, 6);
  for (const [x, y, r] of [[15, 16, 6], [27, 11, 10], [42, 13, 8], [54, 18, 6]]) pixelDisc(g, x, y, r, '#e7e5c9');
  g.fillStyle = '#e7e5c9'; g.fillRect(11, 18, 49, 5);
  g.fillStyle = '#f2edd3'; g.fillRect(23, 2, 9, 2); g.fillRect(13, 11, 6, 2); g.fillRect(39, 6, 7, 2);
  sunArt = visualCanvas(49, 49);
  const sg = sunArt.getContext('2d');
  pixelDisc(sg, 24, 24, 24, '#d8d6ad'); pixelDisc(sg, 24, 24, 20, '#f3e7b6');
  sg.fillStyle = '#f9efc7'; sg.fillRect(13, 10, 12, 3);
}
function genScenery(){
  const sceneColors = currentMap.scene;
  hills = [
    { col: sceneColors[0], base: 0.42, amp: 145, f: [3.3, 7.7, 13.4], ph: [rand(0, 6), rand(0, 6), rand(0, 6)], p: 0.67 },
    { col: sceneColors[1], base: 0.53, amp: 100, f: [3.2, 7.7, 15], ph: [rand(0, 6), rand(0, 6), rand(0, 6)], p: 0.47 },
    { col: sceneColors[2], base: 0.68, amp: 60, f: [4.4, 9.1, 19], ph: [rand(0, 6), rand(0, 6), rand(0, 6)], p: 0.25 }
  ].map(makeSceneryLayer);
  if (!cloudArt) buildSkyArt();
  clouds = Array.from({ length: Math.round(5 * W / FEATURE) }, () => ({ x: rand(-700, W + 700), y: rand(H * 0.05, H * 0.27), s: rand(0.65, 1.25) }));
  motes = Array.from({ length: Math.round(24 * W / FEATURE) }, () => ({ x: rand(-200, W + 200), y: rand(H * 0.04, H * 0.6), ph: rand(0, 6.28), l: rand(0.5, 1) }));
}
function drawScenery(vw, vh){
  const sunX = cam.x + vw * 0.28 - (cam.x - W / 2) * 0.04, sunY = cam.y - vh * 0.3;
  if (sunArt) ctx.drawImage(sunArt, Math.round(sunX - 72), Math.round(sunY - 72), 144, 144);
  // Clouds sit behind the mountains, so distant peaks occlude them naturally.
  for (const c of clouds){
    const cx = Math.round(c.x + (cam.x - W / 2) * 0.55), cy = Math.round(c.y + (cam.y - H / 2) * 0.42), k = c.s * 3;
    ctx.drawImage(cloudArt, cx, cy, Math.round(cloudArt.width * k), Math.round(cloudArt.height * k));
  }
  for (const L of hills){
    const ox = Math.round((cam.x - W / 2) * L.p), oy = Math.round((cam.y - H / 2) * L.p * 0.5);
    ctx.drawImage(L.cv, SCENE_X + ox, oy, L.cv.width * SCENE_PIXEL, L.cv.height * SCENE_PIXEL);
  }
  ctx.fillStyle = '#e1e6cc'; ctx.globalAlpha = 0.38;
  for (const m of motes){
    const len = 2 + Math.floor(Math.abs(wind) * 0.12 * m.l / 3) * 3;
    ctx.fillRect(Math.round(m.x / 3) * 3, Math.round(m.y / 3) * 3, Math.sign(wind || 1) * len, 2);
  }
  ctx.globalAlpha = 1;
}

function restoreVisualArt(force = false){
  if (document.hidden || (!force && (!visualArtLost || !visualArtRestorePending))) return;
  visualArtEpoch++;
  visualArtLost = false; visualArtRestorePending = false;
  // Keep the exact scenery recipe and moving-cloud positions: resuming must not
  // generate a different map or consume gameplay randomness.
  hills = hills.map(L => makeSceneryLayer(L.recipe, L.index));
  buildSkyArt();
  tankArt.clear(); shellArt.clear(); battleArt = null;
  tankFrame = visualCanvas(96, 80); tankFrameCtx = tankFrame.getContext('2d');
  // Vehicle pickers are static canvases rather than part of the animation loop.
  requestAnimationFrame(() => {
    if (typeof renderLobby === 'function') renderLobby();
    if (!$('#pick').hidden) $('#mobiles').querySelectorAll('.mob').forEach(b => drawPreview(b.querySelector('canvas'), b.dataset.mob, pickStep));
  });
}

// Small cached effect sprites keep the battlefield on the same pixel grid as its vehicles.
const shellArt = new Map();
let battleArt = null;
function getShellArt(type){
  if (shellArt.has(type)) return shellArt.get(type);
  const cv = visualCanvas(11, 11);
  const g = cv.getContext('2d'), r = type === 'heavy' ? 4 : 3;
  const colors = { basic: '#e7ba68', heavy: '#d58b54', split: '#acd39b', child: '#acd39b', drill: '#d7d8b0', calm: '#9ed6d0', pierce: '#e8dfaa', bounce: '#dbaa85' };
  pixelDisc(g, 5, 5, r + 1, '#172e3a'); pixelDisc(g, 5, 5, r, colors[type] || colors.basic);
  g.fillStyle = '#fff0c5'; g.fillRect(4, 3, 2, 1);
  g.fillStyle = '#655747'; g.fillRect(4, 7, 3, 1);
  if (type === 'pierce' || type === 'drill'){
    g.fillStyle = '#172e3a'; g.fillRect(1, 3, 4, 5); g.fillRect(9, 4, 2, 3);
    g.fillStyle = '#c7c8a3'; g.fillRect(2, 4, 7, 3); g.fillStyle = '#fff0c5'; g.fillRect(5, 4, 4, 1);
  }
  shellArt.set(type, cv); return cv;
}
function getBattleArt(){
  if (battleArt) return battleArt;
  const smoke = [false, true].map(dust => {
    const cv = visualCanvas(13, 13); const g = cv.getContext('2d');
    for (const [x, y, r] of [[5, 5, 4], [9, 7, 3], [5, 9, 3], [3, 7, 3]]) pixelDisc(g, x, y, r, dust ? '#b8a37d' : '#53676c');
    pixelDisc(g, 4, 4, 2, dust ? '#d0ba8e' : '#778780'); return cv;
  });
  const blast = Array.from({ length: 6 }, (_, frame) => {
    const cv = visualCanvas(64, 64); const g = cv.getContext('2d');
    if (frame === 0){
      g.fillStyle = '#e6a957'; g.fillRect(5, 28, 54, 8); g.fillRect(28, 5, 8, 54);
      pixelDisc(g, 32, 32, 17, '#efb75f'); pixelDisc(g, 32, 32, 12, '#fff2c6');
      g.fillStyle = '#fff2c6'; g.fillRect(12, 31, 40, 2); g.fillRect(31, 12, 2, 40);
    } else if (frame < 4){
      const r = 18 + frame * 2;
      pixelDisc(g, 32, 32, r, '#9b5947');
      for (let i = 0; i < 9; i++){
        const a = i * Math.PI * 2 / 9, x = Math.round(32 + Math.cos(a) * (r - 4)), y = Math.round(32 + Math.sin(a) * (r - 4));
        pixelDisc(g, x, y, 5 + (i % 3), '#c27449');
        pixelDisc(g, x - 1, y - 2, 3 + (i % 2), '#efaa59');
      }
      pixelDisc(g, 31, 31, r - 4, '#edaa58'); pixelDisc(g, 30, 29, r - 8, '#f6d07e');
      if (frame < 3) pixelDisc(g, 28, 27, r - 13, '#fff2c6');
      g.fillStyle = '#f6d07e'; g.fillRect(18, 20, 4, 4); g.fillRect(42, 35, 4, 3);
    } else {
      pixelDisc(g, 32, 32, 26 + (frame - 4), '#7b8174');
      pixelDisc(g, 31, 30, 24 + (frame - 4), '#c0bc96');
      g.globalCompositeOperation = 'destination-out'; pixelDisc(g, 32, 33, 20 + (frame - 4) * 2, '#000'); g.globalCompositeOperation = 'source-over';
      g.fillStyle = '#e9d38d'; g.fillRect(9, 16, 3, 3); g.fillRect(48, 43, 3, 3); g.fillRect(40, 9, 2, 3);
    }
    return cv;
  });
  battleArt = { smoke, blast }; return battleArt;
}

/* ---------- game state ---------- */
let mode = 'ai';
let phase = 'menu';
let tanks = [], shells = [], parts = [], texts = [], rings = [], timers = [];
let cur = 0, wind = 0, turnCount = 0;
let power = 0, powerDir = 1;
let phaseT = 0, settleT = 0, turnT = 0, tickSec = -1;
let aiPlan = null, aiJob = null, aiMoved = false, aiMoveTo = 0, aiStuck = 0, aiLog = [];
let hitStop = 0, trauma = 0, shakeT = 0, screenFlash = 0, timeScale = 1;
const cam = { x: W / 2, y: H / 2, z: 1 };
const held = { left: false, right: false, up: false, down: false };
const holdSources = Object.fromEntries(Object.keys(held).map(k => [k, new Set()]));
const holdT = { up: 0, down: 0 };
let fireHeld = false;
let fireSource = null;
const stats = [mkStats(), mkStats()];
function mkStats(){ return { shots: 0, hits: 0, direct: 0, best: 0 }; }

const NAMES = { ai: ['나', '컴퓨터'], duo: ['1P', '2P'], practice: ['나', '과녁'] };
const COLORS = [
  { main: '#53cbb2', dark: '#277d7c', light: '#b5ebcf', ink: '#143d49' },
  { main: '#f27766', dark: '#a04e53', light: '#ffd2aa', ink: '#563441' }
];

// Shells: each mobile has its four (MOBILES[].shells). The basic shell never runs out; the others have
// SPECIAL_USES each per game.
const SPECIAL_USES = 2;
function hasShell(t, id){ return t.ammo[id] > 0; }

// Effect cards ride on a turn's shot. They are dealt from a per-game deck (FX_DECK) into a hand of S.handSize;
// one may be played per turn, it adds its delay to the shot and takes effect where the shot first bursts.
// Playing one draws the next; an empty deck leaves the slot empty (practice mode deals a fresh deck).
const PULL_RANGE = 160, PULL_MIN = 100;
const POWER_MUL = 1.25, RUSH_MUL = 1.5;   // 파워업: this shot's damage. 과열: the other side's gauge speed on its next turn
const FX = [
  { id: 'pull', name: '끌어오기', delay: 150, desc: '포탄이 터진 곳 근처의 상대를 내 탱크 옆으로 끌어옵니다.' },
  { id: 'warp', name: '탄착 이동', delay: 120, desc: '포탄이 폭발한 곳 근처의 안전한 지점으로 이동합니다.' },
  { id: 'power', name: '파워업', delay: 250, desc: '이번 포탄의 피해가 25% 커집니다.' },
  { id: 'rush', name: '과열', delay: 150, desc: '포탄이 터진 곳 근처의 상대는 다음 턴에 파워 게이지가 1.5배 빨라집니다.' }
];
const FXD = Object.fromEntries(FX.map(f => [f.id, f]));
const FX_DECK = [['pull', 2], ['warp', 2], ['power', 2], ['rush', 2]];
// The moving cards' delays are kept small on purpose: with +350 a pull usually handed the pulled player two shots
// in a row at point-blank range, which made the card a loss. 파워업 costs more: on a heavy shell it turns a direct
// hit of 58 into 72, most of a Scout's 90. Even at +250 it stays a little ahead per 1000 delay (+370 would be even).
// 과열 at 1.5x: one frame of a 70/s gauge already moves the shot about 33 px at power 70; at 2x a frame is 64 px,
// about the whole basic-shell hit zone, which turns aiming into luck on a phone.
const FX_ICONS = {
  power: '<svg viewBox="0 0 24 24"><path d="M5 12l7-7 7 7M5 19l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  rush: '<svg viewBox="0 0 24 24"><rect x="2" y="10" width="20" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="4.5" y="12.5" width="12" height="3" fill="currentColor"/><path d="M9 3.5l2 3.5M14 3l1.5 4M19 4l1 3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  pull: '<svg viewBox="0 0 24 24"><path d="M20 12H8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M12 7l-5 5 5 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="20" cy="12" r="2.6" fill="currentColor"/><path d="M3 5v14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".6"/></svg>',
  warp: '<svg viewBox="0 0 24 24"><path d="M3 19C5 7 15 4 20 12" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="2.5 3" stroke-linecap="round"/><path d="M17 8l3.5 4.5L15 13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 21h8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  stack: '<svg viewBox="0 0 24 24"><rect x="7" y="3" width="12" height="16" rx="2" fill="currentColor" opacity=".45"/><rect x="4" y="6" width="12" height="16" rx="2" fill="currentColor"/></svg>'
};
function buildDeck(){
  const d = [];
  for (const [id, n] of FX_DECK) for (let k = 0; k < n; k++) d.push(id);
  for (let i = d.length - 1; i > 0; i--){ const j = (Math.random() * (i + 1)) | 0; [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
function playFx(t, id, slot){
  const k = t.hand[slot] === id ? slot : t.hand.indexOf(id);
  if (k < 0) return;
  if (!t.deck.length && mode === 'practice') t.deck = buildDeck();
  t.hand[k] = t.deck.length ? t.deck.pop() : null;
  t.fresh = t.hand[k] ? k : -1;
}
function makeTank(i, x, mid){
  const m = MOBILE[mid] || MOBILE[DEFAULT_PICKS[i]];
  const ammo = {}; m.shells.forEach(id => ammo[id] = id === 'basic' ? Infinity : SPECIAL_USES);
  const deck = buildDeck(), hand = [];
  for (let k = 0; k < S.handSize; k++) hand.push(deck.length ? deck.pop() : null);
  return { i, x, m, y: 0, vy: 0, hp: m.hp, maxHp: m.hp, shownHp: m.hp, alive: true, gone: false, facing: i === 0 ? 1 : -1, elev: clamp(45, m.ang[0], m.ang[1]),
    fuel: m.fuel, ammo, hand, deck, arm: null, armSlot: -1, rush: false, rushNow: false, hop: null, fresh: -1, freshUntil: 0, lastHitTurn: -100, sel: 'basic', delay: 0, lastPower: null, lastElev: null, lastFacing: null, recoil: 0, hurt: 0, airborne: false, tilt: 0, tread: 0 };
}
function clampElev(t, e){ return clamp(e, t.m.ang[0], t.m.ang[1]); }
function randomMobile(){ return MOBILES[(Math.random() * MOBILES.length) | 0].id; }
let autoAll = false;   // tests/balance.py: the computer plays both sides
function isHuman(i){ return !autoAll && (mode !== 'ai' || i === 0); }
function shooterCanAct(){ return mode !== 'practice' || cur === 0; }

let gamePicks = DEFAULT_PICKS.slice();
function startGame(m, picks, mapOverride){
  currentMap = MAP_BY_ID[mapOverride] || (mapChoice === 'random' ? MAPS[(Math.random() * MAPS.length) | 0] : MAP_BY_ID[mapChoice]);
  $('#minimap').title = '전장: ' + currentMap.name + ' — 누르거나 끌어 다른 곳을 볼 수 있습니다.';
  resetInputs(); clearTimeout(overTimer);
  Snd.chargeStop(); Snd.whistleStop();
  panelEl.hidden = true; $('#panel-shade').hidden = true; $('#help').hidden = true;
  mode = m;
  gamePicks = (picks || DEFAULT_PICKS).slice();
  armBackTrap();
  const sx = pickSpawns();
  genTerrain(sx); genScenery();
  tanks = [makeTank(0, sx[0], gamePicks[0]), makeTank(1, sx[1], gamePicks[1])];
  tanks.forEach(t => { t.y = groundY(t.x, 0); });
  shells = []; parts = []; texts = []; rings = []; timers = []; lastShot = null;
  stats[0] = mkStats(); stats[1] = mkStats();
  cur = 0; wind = 0; turnCount = 0; hitStop = 0; trauma = 0; timeScale = 1;
  clearLook(); camSnap = true; cam.z = 1;
  setBadges();
  $('#start').hidden = true; $('#over').hidden = true; $('#pick').hidden = true;
  Snd.setScene('battle');
  beginTurn();
  updateHUD();
}
function timed(){ return S.turnTime > 0 && mode !== 'practice'; }
function beginTurn(again){
  resetInputs();
  turnCount++;
  clearLook();
  turnT = 0; tickSec = -1;
  if ((turnCount - 1) % (currentMap.windEvery || 1) === 0){
    const prev = wind / Math.max(1, S.windMax);
    wind = clamp(prev * 0.35 + rand(-1, 1) * 0.85, -1, 1) * S.windMax;
  }
  const t = tanks[cur];
  t.fuel = t.m.fuel;
  if (!hasShell(t, t.sel)) t.sel = 'basic';
  t.arm = null; t.armSlot = -1; fxOpen = false;
  t.rushNow = t.rush; t.rush = false;   // 과열 lasts the hit tank's next turn, whenever that comes
  if (t.rushNow) toast(`${FXD.rush.name}: 이번 턴은 파워 게이지가 ${RUSH_MUL}배 빠릅니다`, 2200);
  if (t.fresh >= 0){ t.fresh = -1; t.freshUntil = performance.now() + 1600; }   // light up the card button: a new card came in
  power = 0; powerDir = 1;
  phaseT = 0;
  phase = isHuman(cur) ? 'aim' : 'aiThink';
  aiJob = null; aiMoved = false;
  renderCards();
  let label;
  if (mode === 'ai') label = again ? (cur === 0 ? '한 번 더!' : '컴퓨터 한 번 더') : (cur === 0 ? '내 턴' : '컴퓨터 턴');
  else if (mode === 'duo') label = (cur === 0 ? '1P' : '2P') + (again ? ' 한 번 더!' : ' 턴');
  else label = turnCount === 1 ? '과녁을 맞혀 보세요' : '다음 발';
  banner(label, COLORS[cur].light);
  Snd.tick(0.5);
}
function respawn(t){
  t.alive = true; t.gone = false; t.hp = t.maxHp; t.shownHp = t.maxHp; t.vy = 0; t.airborne = false;
  let x = clamp(t.x, 30, W - 30);
  if (groundY(x, 0) >= H - 30){
    outer: for (let k = 1; k < W; k += 2) for (const s of [-1, 1]){
      const xx = x + s * k;
      if (xx > 30 && xx < W - 30 && groundY(xx, 0) < H - 60){ x = xx; break outer; }
    }
  }
  t.x = x; t.y = groundY(x, 0);
}
function endTurn(){
  if (mode === 'practice'){
    const dummy = tanks[1];
    if (!dummy.alive){ respawn(dummy); toast('과녁을 다시 세웠습니다'); }
    if (!tanks[0].alive){ respawn(tanks[0]); toast('내 탱크가 복귀했습니다'); }
    tanks[0].delay = tanks[1].delay = 0;
    cur = 0; beginTurn(); return;
  }
  if (tanks.some(t => !t.alive)){ gameOver(); return; }
  const prev = cur;
  if (S.delayOn){
    const [a, b] = tanks;
    cur = a.delay === b.delay ? 1 - prev : (a.delay < b.delay ? 0 : 1);
    const m = Math.min(a.delay, b.delay); a.delay -= m; b.delay -= m;
  } else cur = 1 - prev;
  beginTurn(cur === prev);
}
function passTurn(timeout){
  if (!canControl() || mode === 'practice') return;
  const t = tanks[cur];
  Snd.chargeStop(); Snd.rumble(false); fireHeld = false; power = 0;
  // a timeout can wait for a falling tank to land; the time past the limit is not charged
  t.delay += PASS_DELAY + Math.floor(timed() ? Math.min(turnT, S.turnTime) : turnT) * 10;
  toast(timeout ? '시간이 다 되어 턴을 넘깁니다' : '턴을 넘겼습니다', 1600);
  Snd.tick(0.8);
  endTurn();
}
let overTimer = 0;
function gameOver(){
  phase = 'over';
  const [a, b] = tanks;
  Snd.result(!a.alive && !b.alive ? 'draw' : mode === 'ai' && !a.alive ? 'lose' : 'win');
  let title, eyebrow;
  if (!a.alive && !b.alive){ title = '무승부'; eyebrow = '함께 쓰러짐'; }
  else {
    const w = a.alive ? 0 : 1;
    if (mode === 'ai'){ title = w === 0 ? '승리' : '패배'; eyebrow = w === 0 ? '상대 탱크를 격파했습니다' : '내 탱크가 격파되었습니다'; }
    else { title = (w === 0 ? '1P' : '2P') + ' 승리'; eyebrow = '결과'; }
  }
  $('#over-title').textContent = title;
  $('#over-eyebrow').textContent = eyebrow;
  const line = (n, i) => { const s = stats[i]; return `${n}(${tanks[i].m.name}): ${s.shots}발 중 ${s.hits}발 명중, 직격 ${s.direct}번, 한 발 최대 피해 ${s.best}`; };
  $('#over-stats').innerHTML = mode === 'ai' ? line('나', 0) : line('1P', 0) + '<br>' + line('2P', 1);
  clearTimeout(overTimer);
  overTimer = setTimeout(() => { if (phase === 'over') $('#over').hidden = false; }, 900);
}

/* ---------- aiming ---------- */
// The angle is measured from the tank's hull (GunBound-style), so a tilted tank fires at elev minus its slope.
function pivot(t){ const a = t.tilt || 0; return { x: t.x + Math.sin(a) * PIVOT_H, y: t.y - Math.cos(a) * PIVOT_H }; }
function worldElev(t, facing, rel){ return rel - facing * (t.tilt || 0) / DEG; }
function aimDir(t, facing, rel){ const e = worldElev(t, facing, rel) * DEG; return { x: facing * Math.cos(e), y: -Math.sin(e) }; }

let lastShot = null;
function fire(t, p){
  const def = SHELL[t.sel];
  const fx = t.arm && t.hand.includes(t.arm) ? t.arm : null;
  t.delay += shotDelay(t, t.sel) + (fx ? FXD[fx].delay : 0) + Math.floor(turnT) * 10;
  if (t.ammo[t.sel] !== Infinity) t.ammo[t.sel]--;
  if (fx) playFx(t, fx, t.armSlot);
  t.arm = null; t.armSlot = -1; fxOpen = false;
  const pv = pivot(t), dir = aimDir(t, t.facing, t.elev);
  const v = p / 100 * 1000 * S.powerScale * def.vMul;
  const shot = { owner: t, hit: false, direct: false, pieceHits: new Map(), fx, fxDone: false };
  lastShot = shot;
  shells.push({ x: pv.x + dir.x * MUZZLE, y: pv.y + dir.y * MUZZLE, vx: dir.x * v, vy: dir.y * v, type: t.sel, owner: t, shot, age: 0, trail: [], dead: false, drilling: false, drillLeft: 0, carveAcc: 0, splitDone: false, bounced: false, bounceT: 0 });
  t.lastPower = p; t.lastElev = t.elev; t.lastFacing = t.facing;
  stats[t.i].shots++;
  if (!hasShell(t, t.sel)) t.sel = 'basic';
  renderCards();
  if (J('recoil')){
    t.recoil = 1;
    const n = Math.round(10 * (S.particlesOn ? S.particles : 0.5));
    const mx = pv.x + dir.x * (MUZZLE - 2), my = pv.y + dir.y * (MUZZLE - 2);
    for (let k = 0; k < n; k++){
      const a = Math.atan2(dir.y, dir.x) + rand(-0.5, 0.5), sp = rand(80, 320) * S.recoil;
      parts.push({ x: mx, y: my, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.12, 0.3), max: 0.3, size: rand(2, 5), kind: 'spark', g: 0 });
    }
    for (let k = 0; k < 3; k++) parts.push({ x: mx, y: my, vx: dir.x * 60, vy: dir.y * 60, life: 0.16, max: 0.16, size: rand(8, 13), kind: 'fire', g: 0 });
    for (let k = 0; k < 4; k++) parts.push({ x: mx, y: my, vx: dir.x * rand(30, 70) + rand(-15, 15), vy: dir.y * rand(30, 70) - 10, life: rand(0.5, 0.9), max: 0.9, size: rand(7, 12), kind: 'smoke', g: -20 });
  }
  if (J('shake')) addTrauma(0.12 * S.recoil);
  Snd.chargeStop(); Snd.fire(); Snd.whistleStart(); buzz(18);
  phase = 'flying'; phaseT = 0; power = 0;
  clearLook(); camBlast = null; hopCam = null;
}
function addTrauma(a){ trauma = Math.min(1, trauma + a * S.shake); }

/* ---------- explosions ---------- */
function explode(x, y, def, direct, owner, shot){
  carve(x, y, def.r, true);
  camBlast = { x, y };
  let anyHit = false, hitEnemy = false, bestEnemy = 0;
  for (const t of tanks){
    if (!t.alive) continue;
    const cx = t.x, cy = t.y - TANK_CY, d = Math.hypot(cx - x, cy - y);
    let dmg = 0;
    const pm = shot && shot.fx === 'power' ? POWER_MUL : 1;
    if (t === direct) dmg = Math.round(def.dmg * (def.directMul || 1.25) * pm);
    else if (d < def.r + TANK_R) dmg = Math.round(def.dmg * clamp(1 - (d - 10) / (def.r + TANK_R), 0, 1) * pm);
    if (dmg <= 0) continue;
    if (shot && def.id === 'child'){   // pieces of one split shell do not stack in full on one tank
      const n = shot.pieceHits.get(t) || 0;
      if (n) dmg = Math.round(dmg * SPLIT_REPEAT);
      shot.pieceHits.set(t, n + 1);
    }
    anyHit = true;
    const actualDamage = Math.min(t.hp, dmg);
    if (t !== owner){
      hitEnemy = true;
      bestEnemy = Math.max(bestEnemy, actualDamage);
      if (shot) shot.enemyDamage = (shot.enemyDamage || 0) + actualDamage;
    }
    t.hp = Math.max(0, t.hp - dmg); t.hurt = 1;
    if (t !== owner) t.lastHitTurn = turnCount;
    if (J('numbers')) texts.push({ x: cx, y: cy - 42, val: dmg, direct: t === direct, t: 0 });
    if (t.hp <= 0 && t.alive){ t.alive = false; timers.push({ at: 0.35, fn: () => deathBoom(t) }); }
  }
  if (owner){
    const s = stats[owner.i];
    // count each shot once, however many pieces it splits into
    if (shot && hitEnemy && !shot.hit){ shot.hit = true; s.hits++; }
    if (shot && direct && direct !== owner && !shot.direct){ shot.direct = true; s.direct++; }
    if (hitEnemy) s.best = Math.max(s.best, shot ? shot.enemyDamage : bestEnemy);
  }
  const big = def.r / 38;
  if (J('particles')) spawnBlast(x, y, big, !!direct);
  if (J('flash')){ rings.push({ x, y, r: def.r, t: 0 }); screenFlash = Math.max(screenFlash, direct ? 0.36 : anyHit ? 0.2 : 0.1); }
  if (J('shake')) addTrauma(0.26 * big + (anyHit ? 0.18 : 0) + (direct ? 0.22 : 0));
  if (J('hitStop')) hitStop = Math.max(hitStop, S.hitStop / 1000 * (direct ? 1.6 : anyHit ? 1 : 0.35));
  Snd.boom(big, !!direct);
  buzz(direct ? 90 : anyHit ? 55 : 30);
  if (direct) toast('직격!', 700);
  if (shot && shot.fx && !shot.fxDone){ shot.fxDone = true; timers.push({ at: 0.3, fn: () => applyFx(shot, x, y) }); }
}
/* ---------- effect cards: moving tanks ---------- */
// Somewhere a tank can stand on the surface at x: inside the map, not over a hole to the bottom, level enough,
// and clear of the other tank.
function standAt(x, other){
  x = Math.round(x);
  if (x < 30 || x > W - 30) return null;
  const y = groundY(x, 0), gl = groundY(x - 16, 0), gr = groundY(x + 16, 0);
  if (y >= H - 40 || gl >= H - 20 || gr >= H - 20) return null;
  if (Math.abs(gl - gr) > 16 || Math.abs(gl - y) > 22 || Math.abs(gr - y) > 22) return null;
  if (other && other.alive && !other.gone && Math.abs(other.x - x) < 60 && Math.abs(other.y - y) < 50) return null;
  return { x, y };
}
// the nearest standing spot to x0, searching outward up to maxR; dirs limits the side (1, -1) or both (0)
function nearestStand(x0, other, minR, maxR, dir){
  for (let k = minR; k <= maxR; k += 4){
    for (const s of dir ? [dir] : [1, -1]){
      const p = standAt(x0 + s * k, other);
      if (p) return p;
      if (k === 0) break;
    }
  }
  return null;
}
function applyFx(shot, x, y){
  const me = shot.owner, o = tanks[1 - me.i], f = FXD[shot.fx];
  if (shot.fx === 'warp'){
    if (!me.alive || me.gone) return;
    const p = nearestStand(x, o, 0, 260, 0);
    if (p) hopTo(me, p); else toast(`${f.name}: 설 곳이 없습니다`, 1600);
  } else if (shot.fx === 'pull'){
    if (!o || !o.alive || o.gone) return;
    if (Math.hypot(o.x - x, o.y - TANK_CY - y) > PULL_RANGE){ toast(`${f.name}: 상대가 범위 밖입니다`, 1600); return; }
    const side = Math.sign(o.x - me.x) || 1;
    // at least PULL_MIN away, outside the puller's own basic-shell blast
    const p = nearestStand(me.x, me, PULL_MIN, 300, side) || nearestStand(me.x, me, PULL_MIN, 300, -side);
    if (p) hopTo(o, p); else toast(`${f.name}: 데려올 곳이 없습니다`, 1600);
  } else if (shot.fx === 'rush'){
    if (!o || !o.alive || o.gone) return;
    if (Math.hypot(o.x - x, o.y - TANK_CY - y) > PULL_RANGE){ toast(`${f.name}: 상대가 범위 밖입니다`, 1600); return; }
    o.rush = true; toast(`${f.name}: 상대의 다음 턴 게이지가 ${RUSH_MUL}배 빨라집니다`, 1800); Snd.tick(1);
  }   // 파워업 already acted in explode()
}
// a short arc to the new spot, so the eye can follow where the tank went
function hopTo(t, p){
  const dist = Math.hypot(p.x - t.x, p.y - t.y);
  t.hop = { x0: t.x, y0: t.y, x1: p.x, y1: p.y, t: 0, dur: clamp(dist / 900, 0.45, 1.0), lift: 50 + dist * 0.18 };
  t.airborne = true; t.vy = 0; t.facing = Math.sign(p.x - t.x) || t.facing;
  hopCam = t;
  if (J('particles')) for (let k = 0; k < 10; k++) parts.push({ x: t.x + rand(-18, 18), y: t.y - 4, vx: rand(-50, 50), vy: rand(-70, -20), life: 0.6, max: 0.6, size: rand(4, 9), kind: 'smoke', g: -10, dust: true });
  Snd.pop(); Snd.tick(1);
}
function deathBoom(t){
  if (t.gone) return;
  const x = t.x, y = t.y - TANK_CY;
  carve(x, y + 8, 48, true);
  if (J('particles')){ spawnBlast(x, y, 1.7, true); for (let k = 0; k < 16; k++) parts.push({ x: x + rand(-14, 14), y: y + rand(-10, 4), vx: rand(-40, 40), vy: rand(-90, -30), life: rand(1.2, 2.2), max: 2.2, size: rand(10, 20), kind: 'smoke', g: -30 }); }
  if (J('flash')){ rings.push({ x, y, r: 72, t: 0 }); screenFlash = Math.max(screenFlash, 0.45); }
  if (J('shake')) addTrauma(0.55);
  if (J('hitStop')) hitStop = Math.max(hitStop, S.hitStop / 1000 * 1.8);
  Snd.boom(1.8, true); buzz([60, 40, 120]);
}
const DIRT = ['#c8763f', '#a65a34', '#7cc444', '#d99a5e', '#7a4128', '#e0ad73'];
const FIRE = ['#fff4b8', '#ffd166', '#ffa24a', '#ff6a2c'];
function spawnBlast(x, y, big, direct){
  const n = Math.min(160, Math.round((24 + (direct ? 12 : 0)) * big * S.particles));
  for (let k = 0; k < n; k++){
    const a = rand(-Math.PI, 0) + rand(-0.3, 0.3), sp = rand(120, 520) * Math.sqrt(big);
    parts.push({ x: x + rand(-6, 6), y: y + rand(-6, 6), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.6, 1.4), max: 1.4, size: rand(2.5, 6), kind: 'dirt', g: 900, color: DIRT[(Math.random() * DIRT.length) | 0], rest: false });
  }
  const f = Math.round(12 * big * Math.max(0.4, S.particles));
  for (let k = 0; k < f; k++){
    const a = rand(0, Math.PI * 2), sp = rand(20, 160) * big;
    parts.push({ x: x + rand(-8, 8), y: y + rand(-8, 8), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, life: rand(0.25, 0.5), max: 0.5, size: rand(10, 22) * Math.sqrt(big), kind: 'fire', g: -60, color: FIRE[(Math.random() * FIRE.length) | 0] });
  }
  const m = Math.round(8 * big * S.particles);
  for (let k = 0; k < m; k++) parts.push({ x: x + rand(-14, 14), y: y + rand(-14, 6), vx: rand(-50, 50), vy: rand(-80, -20), life: rand(0.8, 1.6), max: 1.6, size: rand(10, 22) * big, kind: 'smoke', g: -25 });
  const sp = Math.round((direct ? 26 : 12) * S.particles);
  for (let k = 0; k < sp; k++){ const a = rand(0, Math.PI * 2), v = rand(200, 700); parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.1, 0.28), max: 0.28, size: rand(1.5, 3.5), kind: 'spark', g: 300 }); }
  if (parts.length > 700) parts.splice(0, parts.length - 700);
}

/* ---------- bouncing shell ---------- */
// The bounce shell reflects off the ground once (keeping BOUNCE_KEEP of its speed) and then bursts on the next
// contact, or BOUNCE_FUSE seconds after the bounce. simulate() below uses the same rule so the computer can aim it.
const BOUNCE_KEEP = 0.62, BOUNCE_FUSE = 1.6;
function surfaceNormal(x, y){
  let nx = 0, ny = 0;
  for (let dy = -6; dy <= 6; dy += 2) for (let dx = -6; dx <= 6; dx += 2) if (isSolid(x + dx, y + dy)){ nx -= dx; ny -= dy; }
  const l = Math.hypot(nx, ny);
  return l ? { x: nx / l, y: ny / l } : { x: 0, y: -1 };
}
// b holds x, y, vx, vy; h is the step that just moved it into the ground
function bounceOff(b, h){
  const n = surfaceNormal(b.x, b.y);
  b.x -= b.vx * h; b.y -= b.vy * h;
  const dot = b.vx * n.x + b.vy * n.y;
  if (dot < 0){ b.vx -= 2 * dot * n.x; b.vy -= 2 * dot * n.y; }
  b.vx *= BOUNCE_KEEP; b.vy *= BOUNCE_KEEP;
  b.x += n.x * 2; b.y += n.y * 2;
}

/* ---------- computer opponent ---------- */
function simulate(t, facing, rel, p, def, target){
  const pv = pivot(t), dir = aimDir(t, facing, rel);
  const v = p / 100 * 1000 * S.powerScale * def.vMul;
  return flight(t, pv.x + dir.x * MUZZLE, pv.y + dir.y * MUZZLE, dir.x * v, dir.y * v, def, target, 0);
}
// How close a shell from this state lands to the target (0 = direct hit), following updateShells' rules.
// Landing near the shooter adds 600 and sets out.self. A split shell follows all three pieces from the top
// of its arc and scores the closest one, plus 600 if any piece comes down on the shooter.
function flight(t, x, y, vx, vy, def, target, age, out){
  // A bounce depends on exactly where the shell meets the ground, and split pieces fall a long way from where they part;
  // both are stepped like the real shells (1/240 s), or the computer's planned hits miss on the steeper maps.
  const h = (def.bounce || def.split || def.id === 'child') ? 1 / 240 : 1 / 120, tx = target.x, ty = target.y - TANK_CY, g = S.gravity * def.gMul, wa = wind * def.windMul;
  let drilling = false, left = 150, bounced = false, fuse = 0;
  const b = { x: 0, y: 0, vx: 0, vy: 0 };
  const score = (x, y) => { let d = Math.hypot(x - tx, y - ty); if (Math.hypot(x - t.x, y - t.y) < 90){ d += 600; if (out) out.self = true; } return d; };
  for (let i = 0, n = Math.ceil((12.5 - age) / h); i < n; i++){
    age += h;
    if (def.split && vy > 0 && age > 0.2){
      let best = 1e9; const o = { self: false };
      for (const off of SPLIT_SPREAD) best = Math.min(best, flight(t, x, y, vx + off, vy, SHELL.child, target, 0.3, o));
      return o.self ? best + 600 : best;
    }
    if (drilling){ vy += S.gravity * 0.35 * h; x += vx * h; y += vy * h; left -= Math.hypot(vx, vy) * h; }
    else { vx += wa * h; vy += g * h; x += vx * h; y += vy * h; }
    if ((x - tx) * (x - tx) + (y - ty) * (y - ty) < TANK_R * TANK_R) return 0;
    // like updateShells, a shell coming back (a bounce, a lob in a headwind) bursts on its own tank
    if (age > 0.25 && (x - t.x) * (x - t.x) + (y - t.y + TANK_CY) * (y - t.y + TANK_CY) < TANK_R * TANK_R) return score(x, y);
    if (x < -400 || x > W + 400 || y > H + 60) return 1e9;
    if (drilling){ if (left <= 0) return score(x, y); continue; }
    if (bounced && (fuse += h) > BOUNCE_FUSE) return score(x, y);
    if (isSolid(x, y)){   // from the first step, like updateShells: a muzzle in a wall bursts there
      if (def.drill){ drilling = true; vx *= 0.5; vy *= 0.5; continue; }
      if (def.bounce && !bounced){
        b.x = x; b.y = y; b.vx = vx; b.vy = vy; bounceOff(b, h);
        x = b.x; y = b.y; vx = b.vx; vy = b.vy; bounced = true; continue;
      }
      return score(x, y);
    }
  }
  return 1e9;
}

// Difficulty is one number, aiSkill: it sets the aiming error, and from AI_SMART up the computer also drives
// to a better spot when it has no clean shot and weighs each shell's damage against its delay.
const AI_LEVELS = [['쉬움', 0.2], ['보통', 0.5], ['어려움', 0.85]];
const AI_SMART = 0.35;
function tiltAt(x, y){
  const gl = groundY(x - 16, y - 24), gr = groundY(x + 16, y - 24);
  return (gl < NO_GROUND && gr < NO_GROUND) ? clamp(Math.atan2(gr - gl, 32), -0.38, 0.38) : 0;
}
// where the tank would stop if it drove toward tx, by moveTank's rules (fuel, climbing, the other tank)
function driveTo(t, tx){
  const dir = Math.sign(tx - t.x);
  let x = t.x, y = t.y, fuel = t.fuel;
  while (dir && (tx - x) * dir > 1 && fuel > 0){
    const nx = clamp(x + dir * 2, 26, W - 26);
    if (nx === x) break;
    const gt = stepGround(t, x, y, nx, dir);
    if (gt === null) break;
    let g = NO_GROUND; for (const ox of [-16, -8, 0, 8, 16]) g = Math.min(g, groundY(nx + ox, Math.min(y, gt) - 14));
    if (g >= H - 20) break;   // would drop into a hole to the bottom
    x = nx; fuel -= 2; y = g;
  }
  return { x, y };
}
// damage a shell landing d px from the target's centre would do (0 = direct hit), as explode() works it out
function shotDamage(def, d){
  if (d === 0) return def.dmg * (def.directMul || 1.25);
  return d < def.r + TANK_R ? def.dmg * clamp(1 - (d - 10) / (def.r + TANK_R), 0, 1) : 0;
}
// Tries every angle and power for one shell from v (the tank, or a copy of it standing somewhere else).
// coarse uses a quarter of the grid, for comparing spots and shells. The pick favours shots whose neighbours
// also land close, so the aiming error added afterwards still tends to hit; ev is the damage to expect once
// that error (the same spread planJob adds) is taken into account. Yields every 8 simulations and after each angle.
function* searchShot(v, def, target, coarse){
  const facing = target.x >= v.x ? 1 : -1;
  const es = [], ps = [], de = coarse ? 4 : 2, dp = coarse ? 3 : 1.5;
  for (let e = Math.max(v.m.ang[0], 4); e <= v.m.ang[1]; e += de) es.push(e);
  for (let p = 22; p <= 100; p += dp) ps.push(p);
  const np = ps.length, d = new Float32Array(es.length * np);
  // Yield every few shots, not once per angle: a row of long split or bounce flights can take tens of ms on a phone.
  for (let i = 0; i < es.length; i++){
    for (let j = 0; j < np; j++){
      d[i * np + j] = simulate(v, facing, es[i], ps[j], def, target);
      if ((j & 7) === 7) yield;
    }
    yield;
  }
  let best = { sc: Infinity, d: 1e9, e: clampElev(v, 45), p: 70 };
  for (let i = 0; i < es.length; i++) for (let j = 0; j < np; j++){
    const dij = d[i * np + j];
    if (dij >= 1e8) continue;
    let sum = 0, n = 0;
    for (let a = -1; a <= 1; a++) for (let b = -2; b <= 2; b++){
      const ii = i + a, jj = j + b;
      if (ii >= 0 && jj >= 0 && ii < es.length && jj < np){ sum += Math.min(d[ii * np + jj], 300); n++; }
    }
    const sc = dij * 2 + sum / n;
    if (sc < best.sc) best = { sc, d: dij, e: es[i], p: ps[j], i, j };
  }
  let ev = 0;
  if (best.i !== undefined){
    const err = 1 - S.aiSkill, se = Math.max(0.5, 4 * err), sp = Math.max(0.75, 9 * err);
    let wsum = 0;
    for (let a = -2; a <= 2; a++) for (let b = -3; b <= 3; b++){
      const ii = best.i + a, jj = best.j + b;
      if (ii < 0 || jj < 0 || ii >= es.length || jj >= np) continue;
      const w = Math.exp(-((a * de / se) ** 2 + (b * dp / sp) ** 2) / 2);
      ev += w * shotDamage(def, d[ii * np + jj]); wsum += w;
    }
    ev /= wsum;
  }
  return { facing, d: best.d, e: best.e, p: best.p, ev };
}
// what a shell is worth this turn: likely damage, a bonus for a finishing blow, minus the cost of its delay
function shellValue(t, target, def, r){
  if (r.ev <= 0) return def.id === 'basic' ? -0.5 : -1;   // nothing lands: keep the cards
  let v = r.ev;
  if (def.id !== 'basic') v += 2;   // a card left unplayed at the end is wasted
  if (def.windMul === 0) v += Math.abs(wind) / Math.max(1, S.windMax) * 6;   // steadier in a strong wind
  if (shotDamage(def, r.d) >= target.hp) v += 40 * Math.min(1, r.ev / Math.max(1, target.hp));   // a likely finishing blow
  if (S.delayOn && mode !== 'practice'){
    const o = tanks[1 - t.i], after = t.delay + shotDelay(t, def.id) + Math.floor(turnT) * 10;
    v -= (shotDelay(t, def.id) - shotDelay(t, 'basic')) * 0.008;
    if (after - o.delay > SHELL.basic.delay) v -= 18;   // the other side would get two turns in a row
  }
  return v;
}
function* planJob(t, mayMove, force){
  const target = tanks[1 - t.i], smart = S.aiSkill >= AI_SMART;
  const hand = Object.keys(t.ammo).filter(id => t.ammo[id] > 0).sort((a, b) => (a === 'basic' ? -1 : b === 'basic' ? 1 : 0));
  let stuck = false;
  // 1. Reposition to open a firing line, or to get out of the enemy's last impact zone.
  //    Scout and Driller use their mobility more often; Titan usually holds its firing position.
  //    A retreat is accepted only if an accurate shot remains possible after moving.
  if (smart && mayMove && t.fuel > 35 && !t.airborne){
    const here = yield* searchShot(t, SHELL.basic, target, true);
    const underFire = t.lastHitTurn >= turnCount - 2 && t.hp < t.maxHp;
    const roamChance = { light: 0.38, digger: 0.22, howitzer: 0.12, armored: 0.035 }[t.m.id] || 0;
    const tactical = S.aiSkill >= 0.55 && (underFire || Math.random() < roamChance * S.aiSkill);
    if (here.d > 12 || tactical){
      let best = { d: here.d, x: t.x, score: here.d > 12 ? here.d : 0 };
      const beforeRange = Math.abs(t.x - target.x);
      const shifts = [-40, 40, -75, 75, -115, 115, -150, 150];
      for (const dx of shifts){
        if (Math.abs(dx) > t.fuel) continue;
        const p = driveTo(t, t.x + dx);
        const moved = Math.abs(p.x - t.x);
        if (moved < 26 || p.y >= H - 35) continue;
        const r = yield* searchShot(Object.assign({}, t, { x: p.x, y: p.y, tilt: tiltAt(p.x, p.y) }), SHELL.basic, target, true);
        if (!Number.isFinite(r.d) || r.d > 1e7) continue;
        if (here.d <= 12 && r.d > 18) continue; // do not escape into a position unable to hit
        const altitudeGain = clamp(t.y - p.y, -70, 70);
        const rangeGain = clamp(Math.abs(p.x - target.x) - beforeRange, -150, 150);
        const tacticalGain = altitudeGain * 0.16 + rangeGain * 0.085;
        // Accuracy dominates when blocked. Otherwise moving away from the last hit,
        // while maintaining the shot, can beat remaining stationary.
        const score = here.d > 12 ? r.d - tacticalGain * 0.1 : r.d * 0.45 - tacticalGain;
        if (score < best.score - (here.d > 12 ? 6 : 2) && (here.d > 12 || tacticalGain > 5))
          best = { d: r.d, x: p.x, score };
      }
      if (best.x !== t.x) return { move: best.x, reason: underFire ? '회피 이동' : here.d > 12 ? '사격 위치 변경' : '유리한 지형 확보', missHere: here.d, missThere: best.d };
      stuck = here.d > 12;
    }
  }
  // 2. the shell: easy picks like a beginner, otherwise the best value
  let pick = 'basic';
  if (force) pick = force;
  else if (!smart){
    const sp = hand.slice(1);
    if (sp.length && Math.random() < 0.45) pick = sp[(Math.random() * sp.length) | 0];
  } else {
    let bestV = -Infinity;
    for (const id of hand){
      const v = shellValue(t, target, SHELL[id], yield* searchShot(t, SHELL[id], target, true));
      if (v > bestV){ bestV = v; pick = id; }
    }
  }
  // 3. aim it on the full grid, then add the aiming error
  const r = yield* searchShot(t, SHELL[pick], target, false);
  const err = 1 - S.aiSkill;
  // 4. an effect card, by plain rules: pull the player down off much higher ground; follow the shot out of a spot
  //    with no shot and no way to drive to one; power up a likely hit that would not finish anyway; overheat the
  //    other side's gauge when the shot should land near it
  let fx = null;
  if (smart && r.d < 1e8){
    if (t.hand.includes('pull') && target.y < t.y - 60 && r.d < PULL_RANGE * 0.5) fx = 'pull';
    else if (t.hand.includes('warp') && stuck) fx = 'warp';
    else if (t.hand.includes('power') && r.d < 12 && shotDamage(SHELL[pick], r.d) < target.hp) fx = 'power';
    else if (t.hand.includes('rush') && r.d < PULL_RANGE * 0.5) fx = 'rush';
  }
  // The computer stops the gauge exactly, so an overheated gauge costs it power error instead. A faster gauge adds
  // the same timing slip for anyone: guessing a hand's release jitters by 30-50 ms (an assumption, not measured),
  // that is about 2.8 power on a 70/s gauge and 4.2 at 1.5x, so about 3 more, added to its usual error.
  const pe = t.rushNow ? Math.hypot(err * 9, 3) : err * 9;
  return { sel: pick, fx, facing: r.facing, elev: clampElev(t, Math.round(r.e + randn() * err * 4)), power: clamp(r.p + randn() * pe, MIN_FIRE_POWER, 100), miss: r.d };
}
// all at once (tests, and the soak test's stand-in for a human); the game itself runs planJob a few ms per frame
function planShot(t, mayMove, force){
  const job = planJob(t, mayMove, force);
  let r;
  do { r = job.next(); } while (!r.done);
  if (r.value.sel) t.sel = r.value.sel;
  return r.value;
}

/* ---------- input ---------- */
const panelEl = $('#panel');
function gamePaused(){ return (!manualTestMode && document.hidden) || !panelEl.hidden || !$('#help').hidden || !$('#rotate').hidden; }
function canControl(){ return !gamePaused() && tanks[cur]?.alive && !tanks[cur].gone && !tanks[cur].airborne && (phase === 'aim' || phase === 'charging') && isHuman(cur) && shooterCanAct(); }
function pressFire(source){
  if (!canControl() || phase !== 'aim') return false;
  fireSource = source;
  phase = 'charging'; power = 0; powerDir = 1; fireHeld = true;
  Snd.chargeStart();
  return true;
}
function releaseFire(source){
  if (fireSource !== source) return;
  fireHeld = false; fireSource = null;
  if (phase !== 'charging' || !canControl()) return;
  if (power < MIN_FIRE_POWER){
    cancelFire();
    toast('발사 버튼을 조금 더 길게 눌러 주세요', 1700);
    return;
  }
  fire(tanks[cur], power);
}
function cancelFire(source){
  if (source !== undefined && fireSource !== source) return;
  fireHeld = false; fireSource = null;
  if (phase === 'charging'){ phase = 'aim'; power = 0; powerDir = 1; Snd.chargeStop(); }
  $('#btn-fire').classList.remove('down'); $('#keycap').classList.remove('down');
}
function resetInputs(){
  const fieldPointer = drag?.id, mapPointer = mmPointer;
  drag = null; dragging = false; mmPointer = null;
  for (const [surface, id] of [[cvs, fieldPointer], [mm, mapPointer]]){
    if (id === null || id === undefined) continue;
    try { if (surface.hasPointerCapture(id)) surface.releasePointerCapture(id); } catch (err) {}
  }
  for (const k in held){ held[k] = false; holdSources[k].clear(); }
  holdT.up = holdT.down = 0;
  cancelFire(); Snd.chargeStop(); Snd.rumble(false);
  document.querySelectorAll('[data-hold]').forEach(b => b.classList.remove('down'));
}
function nudge(dir){
  if (!canControl()) return;
  const t = tanks[cur], e = clampElev(t, Math.round(t.elev) + dir);
  if (e === t.elev){ Snd.tick(0.1); return; }
  t.elev = e; Snd.tick(0.25);
}
function setHold(k, on, source = 'key'){
  if (on && !canControl()) return;
  const wasHeld = held[k];
  if (on) holdSources[k].add(source); else holdSources[k].delete(source);
  held[k] = holdSources[k].size > 0;
  if ((k === 'up' || k === 'down') && held[k] && !wasHeld){ nudge(k === 'up' ? 1 : -1); holdT[k] = 0; }
}
const GAME_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'];
const keycap = $('#keycap');
window.addEventListener('keydown', e => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.code === 'KeyT' && !e.repeat && $('#help').hidden && $('#rotate').hidden && !e.target?.closest?.('input,textarea,select')){
    e.preventDefault(); togglePanel(); return;
  }
  if (gamePaused()) return;
  if (e.target && e.target.closest && e.target.closest('#panel, .overlay:not([hidden])')) return;
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  switch (e.code){
    case 'ArrowLeft': setHold('left', true); break;
    case 'ArrowRight': setHold('right', true); break;
    case 'ArrowUp': setHold('up', true); break;
    case 'ArrowDown': setHold('down', true); break;
    case 'Space': if (pressFire('key')) keycap.classList.add('down'); break;
    case 'KeyP': passTurn(false); break;
    case 'KeyC': toggleFxPop(); break;
    default:
      if (/^Digit[1-9]$/.test(e.code) && tanks[cur]){
        const n = +e.code.slice(5), t = tanks[cur];
        if (n <= t.m.shells.length) selectCard(t.m.shells[n - 1]); else armFx(n - t.m.shells.length - 1);
      }
  }
});
window.addEventListener('keyup', e => {
  switch (e.code){
    case 'ArrowLeft': setHold('left', false); break;
    case 'ArrowRight': setHold('right', false); break;
    case 'ArrowUp': setHold('up', false); break;
    case 'ArrowDown': setHold('down', false); break;
    case 'Space': if (fireSource === 'key'){ keycap.classList.remove('down'); releaseFire('key'); } break;
  }
});
window.addEventListener('blur', resetInputs);
document.addEventListener('visibilitychange', () => { if (document.hidden) resetInputs(); });
document.querySelectorAll('[data-hold]').forEach(b => {
  const k = b.dataset.hold;
  b.addEventListener('pointerdown', e => {
    if (!canControl() || e.button !== 0) return;
    e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (err) {}
    b.classList.add('down'); setHold(k, true, 'pointer:' + e.pointerId);
  });
  const up = e => { setHold(k, false, 'pointer:' + e.pointerId); if (!held[k]) b.classList.remove('down'); };
  b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
});
const fireBtn = $('#btn-fire');
for (const b of [fireBtn, keycap]){
  const source = e => 'pointer:' + b.id + ':' + e.pointerId;
  b.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !pressFire(source(e))) return;
    e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (err) {}
    b.classList.add('down');
  });
  b.addEventListener('pointerup', e => {
    if (fireSource !== source(e)) return;
    b.classList.remove('down'); releaseFire(source(e));
  });
  b.addEventListener('pointercancel', e => cancelFire(source(e)));
  b.addEventListener('lostpointercapture', e => cancelFire(source(e)));
}
window.addEventListener('contextmenu', e => e.preventDefault());
function audioGesture(e){
  // A first press on a mute control must not start a note before its click turns audio off.
  if (e.repeat || e.target?.closest?.('[data-audio-control], [data-on="soundOn"], [data-on="musicOn"], [data-on="sfxOn"]')) return;
  Snd.init();
}
window.addEventListener('pointerdown', audioGesture, true);
window.addEventListener('keydown', audioGesture, true);
const coarse = matchMedia('(pointer: coarse)');
function setTouch(on){ document.body.classList.toggle('touch', on); checkRotate(); try { syncFull(); } catch (e) {} sizeDial(); measureHud(); sizeMinimap(); }

/* ---------- shell slots ---------- */
// Console row: the mobile's four shells, then one button for the effect-card hand (it opens #fxpop above the console).
let fxOpen = false;
function renderCards(){
  const t = tanks[cur]; const box = $('#cards');
  if (!t){ box.innerHTML = ''; renderFxPop(); return; }
  const ctl = canControl();
  const shellBtns = t.m.shells.map((id, i) => {
    const s = SHELL[id], left = t.ammo[id], none = !(left > 0), dl = shotDelay(t, id);
    return `<button class="card${t.sel === id ? ' sel' : ''}" type="button" data-shell="${id}" ${none || !ctl ? 'disabled' : ''} aria-pressed="${t.sel === id}" aria-label="${s.name}, ${left === Infinity ? '무제한' : left + '발 남음'}, 딜레이 ${dl}">
      <span class="k">${i + 1}</span><span class="well">${ICONS[id]}<span class="bd">${left === Infinity ? '∞' : left}</span></span><span class="txt"><span class="nm">${s.name}</span><span class="ct">${left === Infinity ? '∞' : left + '발'}</span></span></button>`;
  }).join('');
  const n = t.hand.filter(Boolean).length, armed = t.arm ? FXD[t.arm] : null;
  const fresh = isHuman(cur) && performance.now() < t.freshUntil;
  const fxBtn = `<button class="card fx${armed ? ' armed' : ''}${fresh ? ' fresh' : ''}" type="button" id="fx-btn" ${!ctl || !n ? 'disabled' : ''} aria-expanded="${fxOpen}" aria-label="아이템 ${n}개${armed ? ', ' + armed.name + ' 준비됨' : ''}">
      <span class="k">5</span><span class="well">${FX_ICONS[armed ? armed.id : 'stack']}<span class="bd">${n}</span></span><span class="txt"><span class="nm">${armed ? armed.name : '아이템'}</span><span class="ct">${armed ? '추가 딜레이 ' + armed.delay : '보유 ' + n + '개'}</span></span></button>`;
  box.innerHTML = shellBtns + fxBtn;
  renderFxPop();
}
// the hand, shown above the console: each card says what it does and what it adds to the delay
function renderFxPop(){
  const pop = $('#fxpop'), t = tanks[cur];
  const show = fxOpen && t && isHuman(cur) && phase === 'aim' && canControl();
  pop.hidden = !show;
  if (!show) return;
  pop.innerHTML = `<div class="fx-head"><b>아이템</b><span>한 발에 하나 · 남은 보급 ${t.deck.length}개</span></div><div class="fx-list">` +
    t.hand.map((id, k) => {
      if (!id) return `<div class="fxcard empty">빈 칸</div>`;
      const f = FXD[id], on = t.arm === id && (t.hand[t.armSlot] === id ? t.armSlot === k : t.hand.indexOf(id) === k);
      return `<button class="fxcard${on ? ' on' : ''}" type="button" data-fx="${k}" aria-pressed="${on}"><span class="well">${FX_ICONS[id]}</span><b>${f.name}</b><span class="d">${f.desc}</span><span class="c">딜레이 +${f.delay}</span><span class="k">${k + 5}</span></button>`;
    }).join('') + '</div>';
  const r = $('#cards').getBoundingClientRect(), w = Math.min(460, cw - 24);
  pop.style.width = w + 'px';
  pop.style.left = Math.round(clamp(r.left + r.width / 2 - w / 2, 12, cw - w - 12)) + 'px';
  pop.style.bottom = Math.round(ch - playBot + 8) + 'px';
}
function toggleFxPop(force){
  const t = tanks[cur];
  const can = t && isHuman(cur) && phase === 'aim' && canControl() && t.hand.some(Boolean);
  fxOpen = can && (force !== undefined ? force : !fxOpen);
  Snd.tick(0.4); renderCards();
}
function armFx(k){
  const t = tanks[cur];
  if (!t || !canControl() || phase !== 'aim' || !t.hand[k]) return;
  const id = t.hand[k];
  const same = t.arm === id && t.armSlot === k;
  t.arm = same ? null : id; t.armSlot = same ? -1 : k;
  fxOpen = false; Snd.tick(0.7); renderCards();
  if (t.arm) toast(`${FXD[id].name} 선택 · 다음 포탄에 적용됩니다`, 1600);
}
$('#fxpop').addEventListener('click', e => { const b = e.target.closest('[data-fx]'); if (b) armFx(+b.dataset.fx); });
$('#cards').addEventListener('click', e => {
  const b = e.target.closest('.card'); if (!b) return;
  if (b.id === 'fx-btn') toggleFxPop(); else selectCard(b.dataset.shell);
  b.blur();
});
function selectCard(id){
  const t = tanks[cur];
  if (!t || !canControl() || phase !== 'aim' || !hasShell(t, id)) return;
  if (t.sel !== id){ t.sel = id; Snd.tick(0.6); renderCards(); }
  const s = SHELL[id]; toast(`${s.name} · ${s.desc}` + (S.delayOn && mode !== 'practice' ? ` · 딜레이 ${shotDelay(t, id)}` : ''), 2600);
}

/* ---------- update ---------- */
function update(rdt, clockDelta = rdt){
  if (gamePaused()){ Snd.chargeStop(); Snd.whistleStop(); Snd.rumble(false); return; }
  if (phase === 'charging' || phase === 'aiCharge') Snd.chargeStart();
  if (phase === 'flying' && shells.length) Snd.whistleStart();
  shakeT += rdt;
  trauma = Math.max(0, trauma - rdt * 1.5);
  screenFlash = Math.max(0, screenFlash - rdt * 3.2);
  for (const r of rings) r.t += rdt;
  rings = rings.filter(r => r.t < 0.32);
  if (hitStop > 0){ hitStop -= rdt; return; }

  let ts = 1;
  if (phase === 'flying' && J('slow')){
    for (const s of shells){
      if (s.dead || s.vy <= 0) continue;
      for (const t of tanks){
        if (!t.alive || t === s.owner) continue;
        if (Math.hypot(s.x - t.x, s.y - (t.y - TANK_CY)) < S.slowRadius) ts = Math.min(ts, S.slowFactor);
      }
    }
  }
  timeScale += (ts - timeScale) * Math.min(1, rdt * (ts < timeScale ? 16 : 5));
  const dt = rdt * timeScale;

  updateScenery(rdt);
  updateControl(dt, rdt, clockDelta);
  updateShells(dt);
  for (const t of tanks) updateTank(t, dt);
  // A tank can fall out while aiming or driving, without a shell to start settling.
  if (phase === 'charging' && tanks[cur]?.airborne) cancelFire();
  if (TURN_PHASES.includes(phase) && tanks.some(t => !t.alive)){
    resetInputs(); aiJob = null; phase = 'settle'; settleT = 0;
  }
  updateParticles(dt);
  for (const tx of texts) tx.t += rdt;
  texts = texts.filter(tx => tx.t < 1.2);
  for (const tm of timers) tm.at -= dt;
  const due = timers.filter(tm => tm.at <= 0); timers = timers.filter(tm => tm.at > 0); due.forEach(tm => tm.fn());

  if (phase === 'flying' && shells.length === 0){
    phase = 'settle'; settleT = 0; Snd.whistleStop();
    if (lastShot && lastShot.fx && !lastShot.fxDone){ lastShot.fxDone = true; toast(`${FXD[lastShot.fx].name}: 포탄이 떨어지지 않아 효과가 없었습니다`, 1800); }
  }
  if (phase === 'settle'){
    settleT += rdt;
    const calm = tanks.every(t => !t.airborne || t.gone) && timers.length === 0;
    if ((settleT > 0.9 && calm) || settleT > 4) endTurn();
  }
  updateCamera(rdt);
}
function updateControl(dt, rdt, clockDelta = rdt){
  const t = tanks[cur];
  if (!t) return;
  if (TURN_PHASES.includes(phase) && panelEl.hidden) turnT += Math.max(0, clockDelta);
  if (timed() && isHuman(cur) && (phase === 'aim' || phase === 'charging')){
    const left = S.turnTime - turnT, sec = Math.ceil(left);
    if (sec <= 5 && sec >= 1 && sec !== tickSec){ tickSec = sec; Snd.tick(1.4); if (sec <= 3) buzz(15); }
    if (left <= 0){
      // out of time while charging: fire with that power, unless it is below the tap threshold, which would
      // only drop the shell on the shooter (the same rule as releasing early)
      if (phase === 'charging' && power >= MIN_FIRE_POWER){ fireHeld = false; fire(t, power); toast('시간이 다 되어 그대로 발사했습니다', 1600); }
      else { cancelFire(); passTurn(true); }
      return;
    }
  }
  if (canControl()){
    const dir = held.left ? -1 : held.right ? 1 : 0;
    if (dir && phase === 'aim'){ if (look && !dragging) look = null; moveTank(t, dir, rdt); } else Snd.rumble(false);
    for (const k of ['up', 'down']){
      if (held[k]){ holdT[k] += rdt; if (holdT[k] > 0.22) t.elev = clampElev(t, t.elev + (k === 'up' ? 1 : -1) * 32 * rdt); }
    }
    if (phase === 'charging') chargeStep(rdt);
  } else if (phase !== 'aiMove') Snd.rumble(false);

  if (phase === 'aiThink'){
    phaseT += rdt;
    // think a few ms per frame so the screen keeps moving; after driving, let the hull settle first
    if (!aiJob && phaseT > (aiMoved ? 0.2 : 0)) aiJob = { gen: planJob(t, !aiMoved), plan: null };
    if (aiJob && !aiJob.plan){
      const t0 = performance.now(); let r;
      do { r = aiJob.gen.next(); } while (!r.done && performance.now() - t0 < 5);
      if (r.done) aiJob.plan = r.value;
    }
    if (aiJob && aiJob.plan && phaseT > (aiMoved ? 0.35 : 0.75)){
      const plan = aiJob.plan; aiJob = null;
      aiLog.push(plan); if (aiLog.length > 50) aiLog.shift();
      if (plan.move !== undefined){ aiMoveTo = plan.move; aiMoved = true; aiStuck = 0; phase = 'aiMove'; phaseT = 0; }
      else { aiPlan = plan; t.sel = plan.sel; t.arm = plan.fx || null; t.armSlot = plan.fx ? t.hand.indexOf(plan.fx) : -1; t.facing = plan.facing; phase = 'aiAim'; phaseT = 0; renderCards(); }
    }
  } else if (phase === 'aiMove'){
    phaseT += rdt;
    const dir = Math.sign(aiMoveTo - t.x), x0 = t.x;
    const arrived = !dir || Math.abs(aiMoveTo - t.x) <= 1.5 || t.fuel <= 0;
    if (!arrived) moveTank(t, dir, rdt);
    aiStuck = (t.x === x0 && !t.airborne) ? aiStuck + rdt : 0;
    if (arrived || aiStuck > 0.3 || phaseT > 4){ Snd.rumble(false); phase = 'aiThink'; phaseT = 0; }
  } else if (phase === 'aiAim'){
    const diff = aiPlan.elev - t.elev, step = 40 * rdt;
    if (Math.abs(diff) <= step){ t.elev = aiPlan.elev; phaseT += rdt; if (phaseT > 0.35){ phase = 'aiCharge'; power = 0; powerDir = 1; Snd.chargeStart(); } }
    else t.elev += Math.sign(diff) * step;
  } else if (phase === 'aiCharge'){
    power += S.gaugeSpeed * (t.rushNow ? RUSH_MUL : 1) * rdt;
    let done = false;
    if (power >= aiPlan.power){ power = aiPlan.power; done = true; }
    Snd.chargeLevel(power);
    if (done) fire(t, power);
  }
}
function chargeStep(rdt){
  power += powerDir * S.gaugeSpeed * (tanks[cur]?.rushNow ? RUSH_MUL : 1) * rdt;
  if (power >= 100){
    if (S.pingPong){ power = 100 - (power - 100); powerDir = -1; }
    else power = 100;
  }
  if (power <= 0 && powerDir < 0){ power = 0; powerDir = 1; }
  Snd.chargeLevel(power);
}
// One step of driving from (x, y) to nx: the ground height there, or null when the other tank is in the way
// or the ground just ahead rises more than the mobile can climb. moveTank and the computer's driveTo both use it.
function stepGround(t, x, y, nx, dir){
  const o = tanks[1 - t.i];
  if (o && o.alive && !o.gone && Math.sign(o.x - x) === dir && Math.abs(o.x - nx) < 56 && Math.abs(o.y - y) < 44) return null;
  let gt = NO_GROUND; for (const ox of [-12, 0, 12]) gt = Math.min(gt, groundY(nx + ox, y - t.m.climb - 4));
  return gt < y - t.m.climb ? null : gt;
}
function moveTank(t, dir, rdt){
  t.facing = dir;
  if (t.fuel <= 0 || t.airborne){ Snd.rumble(false); return; }
  const step = dir * S.moveSpeed * t.m.speed * rdt;
  const nx = clamp(t.x + step, 26, W - 26);
  const gt = stepGround(t, t.x, t.y, nx, dir);
  if (gt === null){ Snd.rumble(false); return; }
  t.x = nx; t.fuel = Math.max(0, t.fuel - Math.abs(step)); t.tread += step;
  if (gt < t.y) t.y = gt;
  Snd.rumble(true);
  if (Math.random() < 0.3 && J('particles')) parts.push({ x: t.x - dir * 22, y: t.y - 2, vx: -dir * rand(10, 40), vy: rand(-30, -10), life: 0.5, max: 0.5, size: rand(3, 6), kind: 'smoke', g: -10, dust: true });
}
function updateTank(t, dt){
  if (!t || t.gone) return;
  if (t.hop){
    const h = t.hop; h.t += dt;
    const k = Math.min(1, h.t / h.dur);
    t.x = h.x0 + (h.x1 - h.x0) * k; t.y = h.y0 + (h.y1 - h.y0) * k - h.lift * 4 * k * (1 - k);
    t.airborne = true; t.tread += (h.x1 - h.x0) * dt / h.dur;
    if (k >= 1){ t.hop = null; t.x = h.x1; t.y = h.y1; t.airborne = false; t.vy = 0; landing(t, 400); }
    t.recoil *= Math.exp(-9 * dt); t.hurt *= Math.exp(-4 * dt);
    t.shownHp += (t.hp - t.shownHp) * Math.min(1, dt * 3);
    return;
  }
  let gt = NO_GROUND; for (const ox of [-16, -8, 0, 8, 16]) gt = Math.min(gt, groundY(t.x + ox, t.y - 14));
  if (t.vy < 0 || gt > t.y + 0.5){
    const speed = t.vy;
    t.airborne = true; t.vy += S.gravity * dt; const ny = t.y + t.vy * dt;
    if (t.vy > 0 && ny >= gt){ t.y = gt; t.airborne = false; t.vy = 0; landing(t, speed); }
    else t.y = ny;
    if (t.y > H + 50) fallOut(t);
  } else { t.y = gt; t.vy = 0; t.airborne = false; }
  if (!t.airborne){
    const gl = groundY(t.x - 16, t.y - 24), gr = groundY(t.x + 16, t.y - 24);
    if (gl < NO_GROUND && gr < NO_GROUND){
      const tt = clamp(Math.atan2(gr - gl, 32), -0.38, 0.38);
      t.tilt += (tt - t.tilt) * Math.min(1, dt * 12);
    }
  }
  t.recoil *= Math.exp(-9 * dt); t.hurt *= Math.exp(-4 * dt);
  t.shownHp += (t.hp - t.shownHp) * Math.min(1, dt * 3);
}
function fallOut(t){
  t.gone = true; t.airborne = false; t.vy = 0;
  if (t.alive){ t.alive = false; t.hp = 0; toast((NAMES[mode][t.i]) + ' 탱크가 추락했습니다', 1800); Snd.thud(); if (J('shake')) addTrauma(0.3); }
}
function landing(t, speed){
  if (speed < 220) return;
  if (J('shake')) addTrauma(Math.min(0.25, speed / 2400));
  if (J('particles')) for (let k = 0; k < 10; k++) parts.push({ x: t.x + rand(-20, 20), y: t.y - 2, vx: rand(-60, 60), vy: rand(-50, -10), life: 0.6, max: 0.6, size: rand(4, 9), kind: 'smoke', g: -10, dust: true });
  Snd.thud();
}
function updateShells(dt){
  const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / steps;
  for (let k = 0; k < steps; k++){
    for (const s of shells){
      if (s.dead) continue;
      const def = SHELL[s.type];
      s.age += h;
      if (def.split && !s.splitDone && s.vy > 0 && s.age > 0.2){
        s.splitDone = true; s.dead = true;
        for (const off of SPLIT_SPREAD) shells.push({ x: s.x, y: s.y, vx: s.vx + off, vy: s.vy, type: 'child', owner: s.owner, shot: s.shot, age: 0.3, trail: [], dead: false });
        if (J('particles')) for (let n = 0; n < 8; n++) parts.push({ x: s.x, y: s.y, vx: rand(-120, 120), vy: rand(-120, 60), life: 0.25, max: 0.25, size: 3, kind: 'spark', g: 0 });
        Snd.pop();
        continue;
      }
      if (s.drilling){
        s.vy += S.gravity * 0.35 * h; s.x += s.vx * h; s.y += s.vy * h;
        const sp = Math.hypot(s.vx, s.vy) * h;
        s.drillLeft -= sp; s.carveAcc += sp;
        if (s.carveAcc > 7){ s.carveAcc = 0; carve(s.x, s.y, 13, false); if (J('particles') && Math.random() < 0.5) parts.push({ x: s.x, y: s.y, vx: rand(-80, 80), vy: rand(-140, -40), life: 0.5, max: 0.5, size: rand(2, 4), kind: 'dirt', g: 900, color: DIRT[(Math.random() * DIRT.length) | 0] }); Snd.grind(); }
      } else {
        s.vx += wind * def.windMul * h; s.vy += S.gravity * def.gMul * h; s.x += s.vx * h; s.y += s.vy * h;
      }
      let hitT = null;
      for (const t of tanks){
        if (!t.alive || (t === s.owner && s.age < 0.25)) continue;
        if ((s.x - t.x) ** 2 + (s.y - (t.y - TANK_CY)) ** 2 < TANK_R * TANK_R){ hitT = t; break; }
      }
      if (hitT){ s.dead = true; explode(s.x, s.y, def, hitT, s.owner, s.shot); continue; }
      if (s.x < -400 || s.x > W + 400 || s.y > H + 60){ s.dead = true; continue; }
      if (s.drilling){ if (s.drillLeft <= 0){ s.dead = true; explode(s.x, s.y, def, null, s.owner, s.shot); } continue; }
      if (s.bounced && (s.bounceT += h) > BOUNCE_FUSE){ s.dead = true; explode(s.x, s.y, def, null, s.owner, s.shot); continue; }
      if (isSolid(s.x, s.y)){
        if (def.bounce && !s.bounced){
          bounceOff(s, h); s.bounced = true;
          if (J('particles')) for (let n = 0; n < 8; n++) parts.push({ x: s.x, y: s.y, vx: rand(-90, 90), vy: rand(-160, -40), life: 0.5, max: 0.5, size: rand(2, 4), kind: 'dirt', g: 900, color: DIRT[(Math.random() * DIRT.length) | 0] });
          Snd.thud(); Snd.pop(); buzz(15);
          continue;
        }
        if (def.drill){ s.drilling = true; s.drillLeft = 150; s.vx *= 0.5; s.vy *= 0.5; Snd.grind(true); addTrauma(0.06); }
        else { s.dead = true; explode(s.x, s.y, def, null, s.owner, s.shot); }
      }
    }
    if (hitStop > 0) break;
  }
  for (const s of shells){
    if (s.dead) continue;
    s.trail.push(s.x, s.y); if (s.trail.length > 60) s.trail.splice(0, 2);
  }
  shells = shells.filter(s => !s.dead);
  if (shells.length) Snd.whistleLevel(shells[0].vy);
}
function updateParticles(dt){
  for (const p of parts){
    p.life -= dt;
    if (p.kind === 'dirt'){
      if (p.rest){ p.life -= dt * 0.5; continue; }
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.vy > 0 && isSolid(p.x, p.y)){ p.y -= p.vy * dt; if (Math.abs(p.vy) > 180){ p.vy *= -0.3; p.vx *= 0.5; } else { p.rest = true; p.vx = p.vy = 0; } }
    } else if (p.kind === 'smoke'){
      p.vy += p.g * dt; p.vx *= Math.exp(-1.5 * dt); p.vx += wind * 0.25 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.size += dt * 14;
    } else {
      p.vy += p.g * dt; p.vx *= Math.exp(-3 * dt); p.vy *= Math.exp(-3 * dt); p.x += p.vx * dt; p.y += p.vy * dt;
    }
  }
  parts = parts.filter(p => p.life > 0);
}
function updateScenery(rdt){
  for (const c of clouds){ c.x += (6 + wind * 0.35) * rdt * c.s; if (c.x > W + 900) c.x = -900; if (c.x < -900) c.x = W + 900; }
  for (const m of motes){
    m.x += (wind * 1.1 + 6) * rdt * m.l; m.ph += rdt * 1.3; m.y += Math.sin(m.ph) * 6 * rdt;
    if (m.x > W + 220) m.x = -220; if (m.x < -220) m.x = W + 220;
  }
}

/* ---------- camera ---------- */
// The camera frames a world point at a set height inside the play area (between the top HUD and the console):
// the current tank while aiming, the shell in flight, and it holds still after the blast until the next turn.
// Dragging on the battlefield or the minimap takes the camera over ("look"); a tap, firing or a new turn gives it back.
let playTop = 80, playBot = 600;
let look = null, camSnap = true, dragging = false, camBlast = null, hopCam = null;
const goal = { x: W / 2, y: H / 2, fy: 0.6 };
let markers = [];
function baseScale(){ return Math.min(1.1, cw / VIEW_W, ch / VIEW_H) * S.viewZoom; }
function viewScale(){ return baseScale() * cam.z; }
function framed(x, y, fy, s){ return { x, y: y - (playTop + (playBot - playTop) * fy - ch / 2) / s }; }
function updateCamera(rdt){
  const live = shells.filter(s => !s.dead);
  let tz = 1, rate = 4;
  const ct = tanks[cur];
  if (phase === 'flying' && live.length){
    // Frame the shells together with the ground under them, looking a little ahead so the camera does not
    // trail behind. High shots zoom out (the play area on a phone is short); the zoom comes back in as the
    // shell drops, up to the 'follow zoom' once it has flown for camDelay.
    const lead = 0.2;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, age = 0;
    for (const sh of live){
      const fx = sh.x + sh.vx * lead, fy = sh.y + sh.vy * lead;
      const g = Math.min(H, groundY(clamp(fx, 0, W - 1), Math.max(0, Math.min(sh.y, fy))));
      x0 = Math.min(x0, sh.x, fx); x1 = Math.max(x1, sh.x, fx); y0 = Math.min(y0, sh.y, fy); y1 = Math.max(y1, sh.y, fy, g);
      age = Math.max(age, sh.age);
    }
    y0 -= 80; y1 += 40; x0 -= 120; x1 += 120;   // room above for the damage number
    const fit = Math.min((playBot - playTop) / (y1 - y0), cw / (x1 - x0)) / baseScale();
    tz = clamp(fit, 0.45, (J('cam') && age >= S.camDelay) ? S.camZoom : 1);
    // when even the widest view cannot hold both, keep the shell at the top and show as much below it as fits
    const viewH = (playBot - playTop) / (baseScale() * tz);
    goal.x = (x0 + x1) / 2; goal.y = (y1 - y0 > viewH) ? y0 + viewH / 2 : (y0 + y1) / 2; goal.fy = 0.5; rate = 6;
  } else if (phase === 'settle' && hopCam && !hopCam.gone){
    goal.x = hopCam.x; goal.y = hopCam.y - TANK_CY; goal.fy = 0.58; rate = 7;   // follow a tank an effect card is moving
  } else if (phase === 'settle' && camBlast){
    goal.x = camBlast.x; goal.y = camBlast.y; goal.fy = 0.58;   // after the blast, settle on it
  } else if ((TURN_PHASES.includes(phase) || phase === 'menu') && ct && !ct.gone){
    goal.x = ct.x; goal.y = ct.y - TANK_CY; goal.fy = 0.62;
  }
  cam.z += (tz - cam.z) * (camSnap ? 1 : 1 - Math.exp(-rdt * (tz > cam.z ? 3.2 : 3)));
  const s = viewScale();
  let tx, ty;
  if (look){ tx = look.x; ty = look.y; rate = dragging ? Infinity : 9; }
  else ({ x: tx, y: ty } = framed(goal.x, goal.y, goal.fy, s));
  const k = (camSnap || rate === Infinity) ? 1 : 1 - Math.exp(-rdt * rate);
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * k;
  clampCam(s);
  if (look && dragging){ look.x = cam.x; look.y = cam.y; }   // a drag past the map edge does not pile up
  camSnap = false;
}
function clampCam(s){
  const vw = cw / s, vh = ch / s;
  cam.x = vw >= W ? W / 2 : clamp(cam.x, vw / 2, W - vw / 2);
  // the bottom of the world may come up to the console's top edge but no further; above, leave room for high shots.
  // On a tall screen zoomed far out the two limits cross; then keep the world's bottom at the console.
  const lo = -900 + vh / 2, hi = H - (playBot - ch / 2) / s;
  cam.y = lo > hi ? hi : clamp(cam.y, lo, hi);
}
function lookAtWorld(x, y, fy){
  look = framed(x, y, fy, viewScale());
}
function worldTransform(){
  const s = viewScale();
  let sx = 0, sy = 0, rot = 0;
  if (J('shake') && trauma > 0){
    const a = trauma * trauma;
    sx = a * 22 * (Math.sin(shakeT * 61.3) * 0.6 + Math.sin(shakeT * 97.1) * 0.4);
    sy = a * 18 * (Math.sin(shakeT * 73.7 + 1.3) * 0.6 + Math.sin(shakeT * 113.9) * 0.4);
    rot = a * 0.018 * Math.sin(shakeT * 47.9);
  }
  return { s, sx, sy, rot };
}
function toScreen(x, y){ const s = viewScale(); return { x: cw / 2 + (x - cam.x) * s, y: ch / 2 + (y - cam.y) * s }; }

// drag the battlefield to look around; a tap returns to the action, or jumps to a tank marker at the screen edge
let drag = null;
cvs.addEventListener('pointerdown', e => {
  if (gamePaused()) return;
  if (fxOpen){ fxOpen = false; renderCards(); }   // touching the battlefield puts the card hand away
  if (drag || (e.pointerType === 'mouse' && e.button !== 0) || phase === 'menu') return;
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  try { cvs.setPointerCapture(e.pointerId); } catch (err) {}
});
cvs.addEventListener('pointermove', e => {
  if (gamePaused() || !drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved){
    if (Math.hypot(dx, dy) < 9) return;
    drag.moved = true; dragging = true; look = { x: cam.x, y: cam.y };
  }
  const s = viewScale();
  look.x -= dx / s; look.y -= dy / s;
  drag.x = e.clientX; drag.y = e.clientY;
});
function endDrag(e){
  if (!drag || e.pointerId !== drag.id) return;
  const tap = !drag.moved && e.type === 'pointerup';
  drag = null; dragging = false;
  if (tap) tapAt(e.clientX, e.clientY);
}
cvs.addEventListener('pointerup', endDrag);
cvs.addEventListener('pointercancel', endDrag);
cvs.addEventListener('lostpointercapture', endDrag);
function tapAt(x, y){
  const m = markers.find(m => Math.hypot(m.x - x, m.y - y) < 30);
  if (m){ lookAtWorld(m.t.x, m.t.y - TANK_CY, 0.62); return; }
  look = null;
}
function clearLook(){ look = null; dragging = false; drag = null; }

/* ---------- render ---------- */
function render(){
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  // A small set of sky bands replaces the glossy vector gradient.
  const sky = currentMap.sky;
  for (let i = 0; i < sky.length; i++){ ctx.fillStyle = sky[i]; ctx.fillRect(0, Math.floor(ch * i / sky.length), cw, Math.ceil(ch / sky.length) + 1); }

  const { s, sx, sy, rot } = worldTransform();
  ctx.save();
  ctx.translate(cw / 2 + sx, ch / 2 + sy); ctx.rotate(rot); ctx.scale(s, s); ctx.translate(-cam.x, -cam.y);

  const vw = cw / s, vh = ch / s;
  drawScenery(vw, vh);

  // ground beyond the world edges, and below its bottom (normally hidden under the console)
  ctx.fillStyle = '#5e5847';
  ctx.fillRect(-3000, edgeL, 3000, H - edgeL + 2000);
  ctx.fillRect(W, edgeR, 3000, H - edgeR + 2000);
  ctx.fillStyle = '#6f9554'; ctx.fillRect(-3000, edgeL, 3000, 9); ctx.fillRect(W, edgeR, 3000, 9);
  ctx.fillStyle = '#363d37'; ctx.fillRect(0, H, W, 2000);
  // only the part of the terrain layers that is on screen; the map is several screens wide
  {
    const pad = 40 + (Math.abs(sx) + Math.abs(sy)) / s + Math.abs(rot) * Math.max(vw, vh);
    const x0 = Math.max(0, Math.floor(cam.x - vw / 2 - pad)), x1 = Math.min(W, Math.ceil(cam.x + vw / 2 + pad));
    const y0 = Math.max(0, Math.floor(cam.y - vh / 2 - pad)), y1 = Math.min(H, Math.ceil(cam.y + vh / 2 + pad));
    if (x1 > x0 && y1 > y0){
      ctx.drawImage(back, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
      ctx.drawImage(terr, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
    }
  }

  // aim lines: current direction and the previous shot's angle
  const ct = tanks[cur];
  if (ct && ct.alive && (phase === 'aim' || phase === 'charging') && isHuman(cur)){
    const pv = pivot(ct);
    if (ct.lastElev !== null){
      const d = aimDir(ct, ct.lastFacing, ct.lastElev);
      ctx.save(); ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(pv.x + d.x * 40, pv.y + d.y * 40); ctx.lineTo(pv.x + d.x * 92, pv.y + d.y * 92); ctx.stroke(); ctx.restore();
    }
    if (S.aimLineOn){
      const d = aimDir(ct, ct.facing, ct.elev);
      ctx.save(); ctx.setLineDash([2, 8]); ctx.lineCap = 'round'; ctx.strokeStyle = COLORS[ct.i].light; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(pv.x + d.x * 42, pv.y + d.y * 42); ctx.lineTo(pv.x + d.x * 120, pv.y + d.y * 120); ctx.stroke(); ctx.restore();
    }
  }

  for (const t of tanks) drawTank(t);

  // Bright, outlined projectiles remain readable against both sky and rock.
  for (const sh of shells){
    if (J('trail') && sh.trail.length > 4){
      for (let i = 0; i < sh.trail.length; i += 4){
        const a = i / sh.trail.length, q = a > 0.65 ? 4 : 3;
        ctx.globalAlpha = 0.15 + a * 0.6; ctx.fillStyle = '#f4e8c7';
        ctx.fillRect(Math.round(sh.trail[i] / 2) * 2 - q / 2, Math.round(sh.trail[i + 1] / 2) * 2 - q / 2, q, q);
      }
      ctx.globalAlpha = 1;
    }
    const cv = getShellArt(sh.type), big = sh.type === 'heavy' ? 1.7 : 1.45;
    ctx.save(); ctx.translate(Math.round(sh.x), Math.round(sh.y)); ctx.rotate(Math.atan2(sh.vy, sh.vx));
    ctx.drawImage(cv, -5.5 * big, -5.5 * big, 11 * big, 11 * big); ctx.restore();
  }

  const art = getBattleArt();
  for (const p of parts){
    const a = clamp(p.life / p.max, 0, 1), x = Math.round(p.x / 2) * 2, y = Math.round(p.y / 2) * 2;
    if (p.kind === 'dirt'){
      const q = Math.max(2, Math.round(p.size / 2) * 2); ctx.globalAlpha = Math.min(1, a * 1.6); ctx.fillStyle = p.color;
      ctx.fillRect(x - q / 2, y - q / 2, q, q);
    } else if (p.kind === 'smoke'){
      const q = Math.round(p.size); ctx.globalAlpha = a * (p.dust ? 0.48 : 0.58);
      ctx.drawImage(art.smoke[p.dust ? 1 : 0], x - q, y - q, q * 2, q * 2);
    }
  }
  for (const p of parts){
    const a = clamp(p.life / p.max, 0, 1), x = Math.round(p.x / 2) * 2, y = Math.round(p.y / 2) * 2;
    if (p.kind === 'fire'){
      const q = Math.max(2, Math.round(p.size * (0.5 + a * 0.6) / 2) * 2);
      ctx.globalAlpha = a; ctx.fillStyle = '#e89950'; ctx.fillRect(x - q, y - q / 2, q * 2, q); ctx.fillRect(x - q / 2, y - q, q, q * 2);
      ctx.fillStyle = '#f8d786'; ctx.fillRect(x - q / 2, y - q / 2, q, q);
    } else if (p.kind === 'spark'){
      ctx.globalAlpha = a; ctx.fillStyle = '#fff0b9'; ctx.fillRect(x, y, 3, 3);
    }
  }
  ctx.globalAlpha = 1;
  for (const r of rings){
    const k = clamp(r.t / 0.32, 0, 0.999), q = Math.round(r.r * (0.75 + k * 0.8));
    ctx.globalAlpha = k < 0.6 ? 1 : (1 - k) / 0.4;
    ctx.drawImage(art.blast[Math.floor(k * 6)], Math.round(r.x - q), Math.round(r.y - q), q * 2, q * 2);
  }
  ctx.globalAlpha = 1;
  // damage numbers
  for (const tx of texts){
    const pop = 1 + 0.9 * Math.exp(-tx.t * 11);
    const a = tx.t > 0.85 ? 1 - (tx.t - 0.85) / 0.35 : 1;
    ctx.save(); ctx.globalAlpha = clamp(a, 0, 1);
    ctx.translate(tx.x, tx.y - tx.t * 46); ctx.scale(pop, pop);
    ctx.font = `${tx.direct ? 42 : 34}px 'Black Han Sans', sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = 7; ctx.strokeStyle = '#1a1208'; ctx.strokeText('-' + tx.val, 0, 0);
    ctx.fillStyle = tx.direct ? '#ffd27a' : '#fff6e6'; ctx.fillText('-' + tx.val, 0, 0);
    ctx.restore();
  }
  // A small notched chevron marks the active tank without hiding the barrel.
  if (ct && ct.alive && !ct.gone && (phase === 'aim' || phase === 'charging' || phase.startsWith('ai'))){
    const bob = reduceMotion ? 0 : Math.round(Math.sin(performance.now() / 180) * 3), y = Math.round(ct.y - 87 + bob), x = Math.round(ct.x);
    ctx.fillStyle = '#132733'; ctx.fillRect(x - 11, y, 22, 5); ctx.fillRect(x - 8, y + 5, 16, 4); ctx.fillRect(x - 4, y + 9, 8, 4);
    ctx.fillStyle = COLORS[ct.i].main; ctx.fillRect(x - 8, y + 2, 16, 3); ctx.fillRect(x - 5, y + 5, 10, 3); ctx.fillRect(x - 2, y + 8, 4, 3);
    ctx.fillStyle = COLORS[ct.i].light; ctx.fillRect(x - 8, y + 2, 16, 1);
  }
  ctx.restore();

  // shells above the top of the screen
  for (const sh of shells){
    const scr = toScreen(sh.x, sh.y);
    if (scr.y < hudTopBottom - 10){
      const x = clamp(scr.x, 24, cw - 24), y = hudTopBottom + 6;
      ctx.fillStyle = '#fff6e6'; ctx.strokeStyle = '#0b0f0c'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 9, y + 15); ctx.lineTo(x + 9, y + 15); ctx.closePath(); ctx.stroke(); ctx.fill();
    }
  }
  drawMarkers();
  drawReadout();
  drawLatency();
  if (screenFlash > 0 && J('flash')){ ctx.fillStyle = `rgba(255,244,220,${screenFlash})`; ctx.fillRect(0, 0, cw, ch); }
}

// Angle and power under the tank while aiming, so the eyes can stay on the battlefield (the console has them too).
function drawReadout(){
  const t = tanks[cur];
  if (!S.readoutOn || !t || !t.alive || t.gone || !isHuman(cur) || (phase !== 'aim' && phase !== 'charging')) return;
  const p = toScreen(t.x, t.y);
  let y = p.y + 18;
  if (y > playBot - 10) y = toScreen(t.x, t.y - 92).y;   // no room under it: put it above the hp bar
  if (p.x < 0 || p.x > cw || y < playTop || y > playBot) return;
  const pw = phase === 'charging' ? `파워 ${Math.round(power)}` : (t.lastPower !== null ? `이전 ${Math.round(t.lastPower)}` : '');
  const text = `${Math.round(t.elev)}°` + (pw ? `  ${pw}` : '');
  ctx.save();
  ctx.font = "15px 'Black Han Sans', sans-serif"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(11,15,12,.85)'; ctx.strokeText(text, p.x, y);
  ctx.fillStyle = phase === 'charging' ? '#ffd27a' : '#fff6e6'; ctx.fillText(text, p.x, y);
  ctx.restore();
}
// Touch latency check (settings): time from the input event's own timestamp to the end of the frame that drew it.
// It leaves out the touch panel's scan before the event and the compositor and display after the frame.
const lat = { down: null, list: [] };
window.addEventListener('pointerdown', e => { if (S.latencyOn) lat.down = e.timeStamp; }, true);
function noteLatency(){
  if (lat.down === null) return;
  const ms = performance.now() - lat.down;
  lat.down = null;
  if (ms >= 0 && ms < 2000){ lat.list.push(ms); if (lat.list.length > 20) lat.list.shift(); }
}
function drawLatency(){
  if (!S.latencyOn) return;
  const n = lat.list.length, last = n ? lat.list[n - 1] : 0, avg = n ? lat.list.reduce((a, b) => a + b, 0) / n : 0;
  const text = n ? `터치→그림 ${Math.round(last)}ms · 평균 ${Math.round(avg)}ms (${n}회)` : '화면이나 버튼을 눌러 보세요';
  ctx.save();
  ctx.font = "12px 'IBM Plex Sans KR', sans-serif"; ctx.textBaseline = 'top';
  const w = ctx.measureText(text).width + 14;
  ctx.fillStyle = 'rgba(10,14,10,.75)'; ctx.fillRect(10, playTop + 6, w, 22);
  ctx.fillStyle = '#ffbf4a'; ctx.fillText(text, 17, playTop + 11);
  ctx.restore();
}

// Tanks outside the play area get a marker on its edge, pointing at them. Tapping one looks at that tank.
function drawMarkers(){
  markers = [];
  if (phase === 'menu') return;
  const m = 30, top = playTop + m, bot = Math.max(top, playBot - m);
  for (const t of tanks){
    if (!t.alive || t.gone) continue;
    const p = toScreen(t.x, t.y - TANK_CY);
    if (p.x > -12 && p.x < cw + 12 && p.y > playTop - 12 && p.y < playBot + 12) continue;
    const x = clamp(p.x, m, cw - m), y = clamp(p.y, top, bot), a = Math.atan2(p.y - y, p.x - x), c = COLORS[t.i];
    markers.push({ x, y, t });
    ctx.save(); ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = c.main; ctx.strokeStyle = '#0b0f0c'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(26, 0); ctx.lineTo(13, -9); ctx.lineTo(13, 9); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.rotate(-a);
    ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // a small hull and barrel inside the disc
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(-9, 4); ctx.lineTo(9, 4); ctx.lineTo(7, -1); ctx.lineTo(-6, -1); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -1); ctx.lineTo(t.facing * 7, -6); ctx.stroke();
    if (t === tanks[cur] && phase !== 'over'){ ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 19 + Math.sin(performance.now() / 160) * 1.5, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }
}

/* ---------- minimap ---------- */
// The whole map in a strip at the top: terrain (redrawn from the collision mask when it changes), the part
// on screen, tanks and shells. Press or drag on it to look there.
const mm = $('#minimap'), mctx = mm.getContext('2d');
const mmTerr = document.createElement('canvas'), mtctx = mmTerr.getContext('2d');
const MM_Y0 = 150;   // the strip shows world heights from here down to the bottom
let mmW = 0, mmH = 0, mmK = 1, mmVer = -1, mmPainted = 0, mmPointer = null;
function sizeMinimap(){
  const r = mm.getBoundingClientRect();
  mmK = Math.min(2, window.devicePixelRatio || 1);
  mmW = Math.max(1, Math.round(r.width * mmK)); mmH = Math.max(1, Math.round(r.height * mmK));
  if (mm.width !== mmW || mm.height !== mmH){ mm.width = mmW; mm.height = mmH; mmTerr.width = mmW; mmTerr.height = mmH; }
  mmVer = -1;
}
const mmX = x => x / W * mmW, mmY = y => (y - MM_Y0) / (H - MM_Y0) * mmH;
function paintMinimapTerrain(){
  const img = mtctx.createImageData(mmW, mmH), d = img.data;
  for (let mx = 0; mx < mmW; mx++){
    const wx = Math.min(W - 1, Math.floor((mx + 0.5) / mmW * W));
    let above = false;
    for (let my = 0; my < mmH; my++){
      const wy = Math.min(H - 1, Math.floor(MM_Y0 + (my + 0.5) / mmH * (H - MM_Y0)));
      const on = solid[wy * W + wx] === 1;
      if (on){
        const p = (my * mmW + mx) * 4, edge = !above;
        d[p] = edge ? 172 : 126; d[p + 1] = edge ? 194 : 106; d[p + 2] = edge ? 119 : 79; d[p + 3] = 255;
      }
      above = on;
    }
  }
  mtctx.putImageData(img, 0, 0);
}
function drawMinimap(now){
  if (mmW < 8 || mmH < 8) return;
  // terrain changes many times while a drill shell digs, so redraw at most a few times a second
  if (mmVer !== terrVer && (now - mmPainted > 120 || phase !== 'flying')){ mmVer = terrVer; mmPainted = now; paintMinimapTerrain(); }
  const k = mmK;
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  mctx.clearRect(0, 0, mmW, mmH);
  mctx.drawImage(mmTerr, 0, 0);
  // what the screen shows
  const s = viewScale();
  const x0 = mmX(cam.x - cw / 2 / s), x1 = mmX(cam.x + cw / 2 / s);
  const y0 = mmY(cam.y + (playTop - ch / 2) / s), y1 = mmY(cam.y + (playBot - ch / 2) / s);
  const rx0 = clamp(x0, 1, mmW - 1), rx1 = clamp(x1, 1, mmW - 1), ry0 = clamp(y0, 1, mmH - 1), ry1 = clamp(y1, 1, mmH - 1);
  mctx.fillStyle = 'rgba(255,255,255,.12)'; mctx.fillRect(rx0, ry0, rx1 - rx0, ry1 - ry0);
  mctx.strokeStyle = look ? 'rgba(255,214,120,.95)' : 'rgba(255,255,255,.8)'; mctx.lineWidth = 1.5 * k;
  mctx.strokeRect(rx0, ry0, rx1 - rx0, ry1 - ry0);
  // shells
  mctx.fillStyle = '#fff6e6';
  for (const sh of shells){ mctx.beginPath(); mctx.arc(mmX(sh.x), clamp(mmY(sh.y), 2 * k, mmH - 2 * k), 1.8 * k, 0, Math.PI * 2); mctx.fill(); }
  // tanks
  for (const t of tanks){
    if (t.gone) continue;
    const x = mmX(t.x), y = clamp(mmY(t.y - TANK_CY), 4 * k, mmH - 4 * k);
    mctx.fillStyle = t.alive ? COLORS[t.i].main : '#4a4246'; mctx.strokeStyle = '#0b0f0c'; mctx.lineWidth = 1.5 * k;
    mctx.beginPath(); mctx.arc(x, y, 3.6 * k, 0, Math.PI * 2); mctx.fill(); mctx.stroke();
    if (t === tanks[cur] && t.alive && phase !== 'menu' && phase !== 'over'){
      mctx.strokeStyle = '#fff'; mctx.lineWidth = 1.2 * k;
      mctx.beginPath(); mctx.arc(x, y, (6 + Math.sin(now / 160)) * k, 0, Math.PI * 2); mctx.stroke();
    }
  }
}
function minimapLook(e){
  if (gamePaused() || phase === 'menu') return;
  const r = mm.getBoundingClientRect();
  const x = clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1) * W;
  const gy = groundY(x, 0);
  lookAtWorld(x, gy < NO_GROUND ? gy : H * 0.6, 0.62);
}
mm.addEventListener('pointerdown', e => {
  if (gamePaused() || phase === 'menu' || e.button !== 0) return;
  e.preventDefault(); mmPointer = e.pointerId;
  if (fxOpen){ fxOpen = false; renderCards(); }
  try { mm.setPointerCapture(e.pointerId); } catch (err) {}
  minimapLook(e);
});
mm.addEventListener('pointermove', e => { if (mmPointer === e.pointerId) minimapLook(e); });
const mmUp = e => { if (mmPointer === e.pointerId) mmPointer = null; };
mm.addEventListener('pointerup', mmUp); mm.addEventListener('pointercancel', mmUp); mm.addEventListener('lostpointercapture', mmUp);

// The vehicles are original, limited-palette pixel sprites. Bodies and gun parts
// are cached; only the tiny assembly canvas is rotated/redrawn during a frame.
// One sprite pixel is 1.5 world units. Collision, pivot and muzzle stay unchanged.
const TANK_PIXEL = 1.5;
const LOOKS = {
  light:    { half: 19, track: 8, barrel: [3, 25], mark: 1 },
  armored:  { half: 22, track: 10, barrel: [5, 25], mark: 2 },
  howitzer: { half: 20, track: 9, barrel: [7, 24], mark: 3 },
  digger:   { half: 19, track: 9, barrel: [4, 24], mark: 4 }
};
const tankArt = new Map();
let tankFrame = visualCanvas(96, 80);
let tankFrameCtx = tankFrame.getContext('2d');
function getTankArt(mid, ci, dead, hurt){
  const key = mid + ':' + ci + ':' + Number(dead) + ':' + Number(hurt);
  if (tankArt.has(key)) return tankArt.get(key);
  const c = COLORS[ci], L = LOOKS[mid];
  const P = {
    ink: '#132733', track: '#253a40', steel: '#53696c', hub: '#8c9f96', cream: '#f2e6ba', gold: '#d7ac62',
    main: dead ? '#48545a' : hurt ? '#fff5db' : c.main,
    dark: dead ? '#303e49' : hurt ? '#c8e2d6' : c.dark,
    light: dead ? '#718079' : hurt ? '#ffffff' : c.light
  };
  const body = visualCanvas(64, 48);
  const cap = visualCanvas(40, 32);
  const gun = visualCanvas(32, 14);
  let g = body.getContext('2d'); g.translate(32, 42);
  const r = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  const half = L.half, th = L.track;
  // Antenna, exhaust and running gear.
  r(-14, -32, 1, 19, P.ink); r(-13, -30, 1, 15, P.steel); r(-15, -33, 3, 2, P.gold);
  r(-half + 2, -th, half * 2 - 4, th, P.ink); r(-half, -th + 2, half * 2, th - 4, P.ink);
  r(-half + 2, -th + 1, half * 2 - 4, th - 2, P.steel); r(-half + 1, -th + 3, half * 2 - 2, th - 6, P.steel);
  r(-half + 3, -th + 2, half * 2 - 6, th - 4, P.track);
  for (let x = -half + 5; x < half - 3; x += 7){
    pixelDisc(g, x, -Math.ceil(th / 2), 3, P.ink); pixelDisc(g, x, -Math.ceil(th / 2), 2, P.hub);
    r(x, -Math.ceil(th / 2), 1, 1, P.cream); r(x - 1, -Math.ceil(th / 2) + 1, 2, 1, P.steel);
  }
  for (let x = -half + 3; x < half - 2; x += 4){ r(x, -1, 2, 1, P.hub); r(x, -th + 1, 2, 1, P.hub); }
  if (mid === 'light'){
    r(-20, -12, 40, 5, P.ink); r(-18, -15, 35, 5, P.ink); r(-14, -18, 27, 4, P.ink);
    r(-18, -12, 35, 4, P.dark); r(-16, -15, 31, 5, P.main); r(-12, -17, 24, 4, P.main);
    r(-12, -17, 23, 1, P.light); r(-16, -15, 3, 1, P.light); r(12, -15, 4, 1, P.light);
    r(-18, -11, 35, 1, P.light); r(-20, -18, 7, 3, P.ink); r(-20, -18, 6, 1, P.gold);
    for (let x = -12; x <= -6; x += 3) r(x, -14, 1, 3, P.ink);
    r(14, -12, 4, 2, P.cream); r(-18, -10, 2, 1, '#dc8064');
    r(-4, -14, 14, 5, P.dark); r(-3, -14, 12, 1, P.light);
  } else if (mid === 'armored'){
    r(-23, -14, 46, 7, P.ink); r(-21, -19, 42, 7, P.ink); r(-17, -22, 33, 4, P.ink);
    r(-21, -14, 42, 5, P.dark); r(-19, -18, 38, 7, P.main); r(-15, -21, 29, 4, P.main);
    r(-15, -21, 28, 1, P.light); r(-19, -18, 34, 1, P.light);
    r(-23, -10, 46, 5, P.ink);
    for (let x = -21; x < 20; x += 8){
      r(x, -12, 7, 7, P.dark); r(x, -12, 6, 1, P.light); r(x + 1, -10, 1, 1, P.hub); r(x + 5, -6, 1, 1, P.ink);
    }
    r(-7, -17, 15, 5, P.dark); r(-6, -17, 13, 1, P.light);
    r(17, -16, 3, 3, P.ink); r(17, -16, 2, 2, P.cream); r(-19, -16, 3, 2, '#dc8064');
    r(-20, -23, 6, 5, P.ink); r(-19, -23, 4, 3, P.steel);
    r(12, -19, 3, 1, P.gold);
  } else if (mid === 'howitzer'){
    r(-27, -3, 8, 3, P.ink); r(-25, -6, 5, 4, P.steel); r(-23, -11, 3, 7, P.ink);
    r(-21, -13, 42, 5, P.ink); r(-18, -16, 35, 4, P.ink);
    r(-19, -12, 38, 3, P.dark); r(-16, -15, 31, 5, P.main); r(-16, -15, 30, 1, P.light);
    r(-22, -13, 43, 1, P.light); r(12, -12, 6, 2, P.cream);
    r(-18, -22, 10, 8, P.ink); r(-17, -21, 8, 7, '#73816a'); r(-17, -21, 7, 1, '#b1b184');
    r(-14, -21, 1, 7, '#3e5149'); r(-18, -18, 10, 1, P.gold);
    r(-4, -13, 13, 4, P.dark); r(12, -17, 4, 4, P.ink); r(13, -17, 2, 3, P.gold);
  } else {
    r(-20, -14, 40, 7, P.ink); r(-18, -19, 32, 6, P.ink);
    r(-18, -13, 34, 5, P.dark); r(-16, -18, 28, 7, P.main); r(-16, -18, 27, 1, P.light);
    r(-16, -24, 10, 8, P.ink); r(-15, -23, 8, 6, P.dark); r(-14, -22, 6, 3, '#a8d3c4'); r(-14, -22, 2, 3, '#e5edcb');
    r(-19, -13, 37, 2, P.gold);
    for (let x = -17; x < 17; x += 6) r(x, -13, 3, 2, P.ink);
    r(-4, -17, 11, 4, P.dark); r(12, -16, 4, 3, P.ink); r(12, -16, 3, 2, P.cream);
    r(17, -17, 4, 13, P.ink); r(18, -16, 2, 11, P.steel);
    for (let x = 0; x < 9; x++){
      const h = 5 - Math.floor(x / 2);
      r(21 + x, -10 - h, 1, h * 2 + 1, P.ink);
      if (h > 1) r(21 + x, -9 - h, 1, h * 2 - 1, x % 3 === 0 ? P.steel : P.cream);
    }
  }
  // Tiny stencil and exposed bolts are intentionally made from pixels, not a font.
  const glyphs = ['111101101101111', '010110010010111', '110001111100111', '110001011001110', '101101111001001'];
  const markY = mid === 'armored' ? -16 : mid === 'digger' ? -17 : -13;
  [0, L.mark].forEach((digit, j) => {
    const bits = glyphs[digit];
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if (bits[y * 3 + x] === '1') r(-2 + j * 4 + x, markY + y, 1, 1, P.cream);
  });
  for (const x of [-15, 13]){ r(x, -10, 1, 1, P.light); r(x + 1, -9, 1, 1, P.ink); }
  // Independent turret, drawn over the gun's breech.
  g = cap.getContext('2d'); g.translate(20, 24);
  if (mid === 'armored'){
    r(-12, -7, 24, 10, P.ink); r(-9, -10, 17, 4, P.ink);
    r(-10, -6, 20, 7, P.dark); r(-8, -9, 15, 5, P.main); r(-7, -9, 13, 1, P.light);
    r(-10, -5, 19, 1, P.light); r(6, -4, 5, 4, P.main);
    r(-5, -12, 7, 3, P.ink); r(-4, -12, 5, 1, P.hub);
    r(-8, -2, 2, 1, P.cream); r(7, -2, 1, 1, P.cream);
  } else if (mid === 'howitzer'){
    r(-9, -3, 18, 9, P.ink); r(-7, -2, 14, 6, P.dark); r(-7, -2, 14, 1, P.light);
    r(-9, -4, 4, 8, P.steel); r(5, -4, 4, 8, P.steel); r(-9, -4, 3, 1, P.hub); r(5, -4, 3, 1, P.hub);
    r(-2, 0, 5, 4, P.gold); r(-1, 1, 2, 2, P.ink);
  } else {
    r(-9, -4, 18, 6, P.ink); r(-7, -7, 14, 4, P.ink); r(-5, -9, 10, 3, P.ink);
    r(-7, -3, 14, 4, P.dark); r(-6, -6, 12, 4, P.main); r(-4, -8, 8, 3, P.main);
    r(-4, -8, 7, 1, P.light); r(-6, -5, 11, 1, P.light);
    r(-4, -10, 6, 2, P.ink); r(-3, -10, 4, 1, P.hub);
    r(-6, -2, 2, 1, P.cream); r(5, -2, 1, 1, P.cream);
    if (mid === 'digger'){ r(-5, -4, 9, 2, P.gold); r(-2, -4, 2, 2, P.ink); }
  }
  // A square muzzle brake and a highlight along the gun read well at phone size.
  g = gun.getContext('2d'); g.translate(2, 7);
  const [bw, bl] = L.barrel, by = -Math.ceil(bw / 2);
  r(0, by - 1, bl, bw + 2, P.ink); r(1, by, bl - 2, bw, P.steel); r(2, by, bl - 5, 1, P.hub);
  r(1, by + bw - 1, bl - 3, 1, P.dark);
  r(bl - 5, by - 2, 6, bw + 4, P.ink); r(bl - 4, by - 1, 4, bw + 2, P.steel);
  r(bl - 4, by - 1, 3, 1, P.light); r(bl, by, 1, bw, '#0b1c27');
  if (mid === 'howitzer'){ r(7, by - 1, 3, bw + 2, P.gold); r(12, by - 1, 2, bw + 2, P.ink); }
  if (mid === 'armored'){ r(bl - 3, by + 1, 2, 1, P.ink); r(7, by - 1, 2, bw + 2, P.dark); }
  const art = { body, cap, gun, L }; tankArt.set(key, art); return art;
}
function drawTank(t, bare){
  if (t.gone) return;
  const c = COLORS[t.i];
  let ox = 0, oy = 0;
  if (!bare && t.alive && phase === 'charging' && t.i === cur && J('recoil')){ const k = power / 100 * 1.4 * S.recoil; ox = rand(-k, k); oy = rand(-k, k) * 0.6; }
  const rk = J('recoil') ? t.recoil * S.recoil : 0;
  const d = aimDir(t, t.facing, t.elev), pv = pivot(t);
  ox -= d.x * rk * 5; oy -= d.y * rk * 3;
  const hurt = t.hurt > 0.05 && Math.sin(performance.now() / 40) > 0;
  const art = getTankArt(t.m.id, t.i, !t.alive, hurt), g = tankFrameCtx;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, tankFrame.width, tankFrame.height); g.imageSmoothingEnabled = false;
  g.translate(48, 64);
  g.save(); g.rotate(t.tilt || 0); g.scale(t.facing, 1);
  g.drawImage(art.body, -32, -42);
  const off = ((Math.floor(t.tread / 3) % 4) + 4) % 4;
  g.fillStyle = '#a0b4a9';
  for (let x = -art.L.half + 3 + off; x < art.L.half - 2; x += 4) g.fillRect(x, -1, 2, 1);
  g.restore();
  // The little signal flag retains the old wind-direction cue.
  {
    const a = t.tilt || 0, ax = -14 * t.facing, ay = -31;
    const fx = Math.round(ax * Math.cos(a) - ay * Math.sin(a)), fy = Math.round(ax * Math.sin(a) + ay * Math.cos(a));
    const dir = Math.abs(wind) < 4 ? t.facing : Math.sign(wind), len = 5 + Math.floor(Math.min(5, Math.abs(wind) / 18));
    const wave = reduceMotion ? 0 : Math.round(Math.sin(performance.now() / 160));
    g.fillStyle = '#132733'; g.fillRect(fx, fy, dir * len, 5); g.fillRect(fx + dir * (len - 2), fy + wave, dir * 3, 5);
    g.fillStyle = t.alive ? c.main : '#59676a'; g.fillRect(fx + dir, fy + 1, dir * (len - 2), 3);
    g.fillStyle = t.alive ? c.light : '#80918a'; g.fillRect(fx + dir, fy + 1, dir * 2, 1);
  }
  // Assemble the barrel at the real world pivot, then put the turret over its breech.
  const px = (pv.x - t.x) / TANK_PIXEL, py = (pv.y - t.y) / TANK_PIXEL;
  g.save(); g.translate(px, py); g.rotate(Math.atan2(d.y, d.x));
  g.drawImage(art.gun, -2 - rk * 10 / TANK_PIXEL, -7); g.restore();
  g.save(); g.translate(px, py); g.rotate(t.tilt || 0); g.scale(t.facing, 1);
  g.drawImage(art.cap, -20, -24); g.restore();
  ctx.save(); ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = 'rgba(16,34,37,.26)'; ctx.fillRect(Math.round(t.x - 29), Math.round(t.y), 58, 3); ctx.fillRect(Math.round(t.x - 23), Math.round(t.y + 3), 46, 2);
  ctx.drawImage(tankFrame, Math.round(t.x + ox) - 48 * TANK_PIXEL, Math.round(t.y + oy) - 64 * TANK_PIXEL, 96 * TANK_PIXEL, 80 * TANK_PIXEL);
  ctx.restore();
  if (bare) return;
  if (t.alive){
    const w = 52, x = Math.round(t.x - w / 2), y = Math.round(t.y - 70);
    ctx.fillStyle = '#132733'; ctx.fillRect(x - 2, y - 2, w + 4, 10);
    ctx.fillStyle = '#d9d9b4'; ctx.fillRect(x, y, Math.round(w * clamp(t.shownHp / t.maxHp, 0, 1)), 6);
    ctx.fillStyle = c.main; ctx.fillRect(x, y, Math.round(w * clamp(t.hp / t.maxHp, 0, 1)), 6);
    ctx.fillStyle = c.light; ctx.fillRect(x, y, Math.round(w * clamp(t.hp / t.maxHp, 0, 1)), 1);
    ctx.fillStyle = '#132733'; for (let q = 10; q < w; q += 11) ctx.fillRect(x + q, y, 1, 6);
  } else if (!gamePaused() && Math.random() < 0.25 && J('particles')){
    parts.push({ x: t.x + rand(-8, 8), y: t.y - 22, vx: rand(-10, 10), vy: rand(-50, -25), life: 1.4, max: 1.4, size: rand(6, 11), kind: 'smoke', g: -10 });
  }
}
function rr(x, y, w, h, r){ ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

/* ---------- angle dial ---------- */
const dialC = $('#dial'), dctx = dialC.getContext('2d');
let dialKey = '', dialScale = 1;
function sizeDial(){
  const r = dialC.getBoundingClientRect();
  dialScale = Math.min(2, window.devicePixelRatio || 1);
  dialC.width = Math.max(1, Math.round(r.width * dialScale)); dialC.height = Math.max(1, Math.round(r.height * dialScale));
  dialKey = '';
}
function drawDial(t){
  const k = dialScale, w = dialC.width, h = dialC.height;
  dctx.setTransform(1, 0, 0, 1, 0, 0); dctx.clearRect(0, 0, w, h);
  if (w < 4) return;
  const cx = w / 2, cy = h - 5 * k, R = Math.min(w / 2 - 5 * k, h - 9 * k);
  const tiltDeg = (t.tilt || 0) / DEG;
  const stdA = (facing, rel) => facing > 0 ? rel - tiltDeg : 180 - tiltDeg - rel;
  const pt = (A, r) => [cx + Math.cos(-A * DEG) * r, cy + Math.sin(-A * DEG) * r];
  // well
  dctx.fillStyle = '#0a0e0a'; dctx.strokeStyle = '#000'; dctx.lineWidth = 2 * k;
  dctx.beginPath(); dctx.arc(cx, cy, R + 3 * k, Math.PI, 0); dctx.closePath(); dctx.fill(); dctx.stroke();
  // ticks every 10 degrees from the horizon
  dctx.strokeStyle = 'rgba(255,191,74,.45)'; dctx.lineWidth = 1.2 * k;
  for (let A = 0; A <= 180; A += 10){
    const [x1, y1] = pt(A, R), [x2, y2] = pt(A, R - (A % 30 === 0 ? 7 : 4) * k);
    dctx.beginPath(); dctx.moveTo(x1, y1); dctx.lineTo(x2, y2); dctx.stroke();
  }
  // the arc this mobile's barrel can cover
  {
    const a0 = stdA(t.facing, t.m.ang[0]), a1 = stdA(t.facing, t.m.ang[1]);
    const lo = clamp(Math.min(a0, a1), 0, 180), hi = clamp(Math.max(a0, a1), 0, 180);
    dctx.strokeStyle = 'rgba(255,191,74,.75)'; dctx.lineWidth = 3 * k; dctx.lineCap = 'butt';
    dctx.beginPath(); dctx.arc(cx, cy, R + 0.5 * k, -hi * DEG, -lo * DEG); dctx.stroke();
  }
  // hull line
  const A0 = t.facing > 0 ? -tiltDeg : 180 - tiltDeg;
  const [hx, hy] = pt(A0, R - 2 * k), [hx2, hy2] = pt(A0 + 180, R - 2 * k);
  dctx.strokeStyle = 'rgba(246,239,220,.55)'; dctx.lineWidth = 2 * k;
  dctx.beginPath(); dctx.moveTo(hx2, hy2); dctx.lineTo(hx, hy); dctx.stroke();
  // sector = the hull-relative angle
  const A = stdA(t.facing, t.elev);
  dctx.fillStyle = 'rgba(255,191,74,.22)';
  dctx.beginPath(); dctx.moveTo(cx, cy);
  if (t.facing > 0) dctx.arc(cx, cy, R * 0.72, -A0 * DEG, -A * DEG, true); else dctx.arc(cx, cy, R * 0.72, -A0 * DEG, -A * DEG, false);
  dctx.closePath(); dctx.fill();
  // previous shot
  if (t.lastElev !== null){
    const [px, py] = pt(stdA(t.lastFacing, t.lastElev), R - 4 * k);
    dctx.setLineDash([3 * k, 3 * k]); dctx.strokeStyle = 'rgba(255,255,255,.7)'; dctx.lineWidth = 1.6 * k;
    dctx.beginPath(); dctx.moveTo(cx, cy); dctx.lineTo(px, py); dctx.stroke(); dctx.setLineDash([]);
  }
  // needle
  const [nx, ny] = pt(A, R - 3 * k);
  dctx.strokeStyle = '#ffbf4a'; dctx.lineWidth = 3 * k; dctx.lineCap = 'round';
  dctx.shadowColor = 'rgba(255,191,74,.7)'; dctx.shadowBlur = 6 * k;
  dctx.beginPath(); dctx.moveTo(cx, cy); dctx.lineTo(nx, ny); dctx.stroke();
  dctx.shadowBlur = 0;
  dctx.fillStyle = '#ffbf4a'; dctx.beginPath(); dctx.arc(cx, cy, 3.5 * k, 0, Math.PI * 2); dctx.fill();
  // number
  dctx.font = `${Math.round(R * 0.42)}px 'Black Han Sans', sans-serif`; dctx.textAlign = 'center'; dctx.textBaseline = 'alphabetic';
  dctx.fillStyle = '#ffbf4a'; dctx.shadowColor = 'rgba(255,191,74,.5)'; dctx.shadowBlur = 5 * k;
  const nx0 = cx + (t.facing > 0 ? -R * 0.38 : R * 0.38);
  dctx.fillText(Math.round(t.elev) + '°', nx0, cy - R * 0.12);
  dctx.shadowBlur = 0;
  const real = Math.round(worldElev(t, t.facing, t.elev));
  if (real !== Math.round(t.elev)){
    dctx.font = `700 ${Math.max(9 * k, Math.round(R * 0.19))}px 'IBM Plex Sans KR', sans-serif`;
    dctx.fillStyle = 'rgba(246,239,220,.85)';
    dctx.fillText('수평 ' + real + '°', nx0, cy - R * 0.58);
  }
}

/* ---------- HUD ---------- */
const pips = $('#wind .pips'); pips.innerHTML = '<i></i>'.repeat(10);
const pipEls = [...pips.children];
const hud = {
  hp: [0, 1].map(i => ({ box: $('#hp' + i), bar: $(`#hp${i} .hpbar i`), ghost: $(`#hp${i} .hpbar b`), num: $(`#hp${i} .hpnum`), dly: $(`#hp${i} .dly`) })),
  timer: $('#timer'), timerNum: $('#timer b'), pass: $('#btn-pass'),
  windSvg: $('#wind svg'), windNum: $('#wind .lcd b'),
  fill: $('#gauge .fill'), prev: $('#gauge .prev'), ang: $('#ang'), angMini: $('#ang-mini'), angReal: $('#ang-real'), pow: $('#pow'), fuel: $('.fuelbar i'),
  touchBtns: [...document.querySelectorAll('.tpad button, #btn-fire')]
};
const last = {};
function setIf(key, val, fn){ if (last[key] !== val){ last[key] = val; fn(val); } }
function updateHUD(){
  setIf('lobby', phase === 'menu', on => { document.body.classList.toggle('in-lobby', on); if (on) requestAnimationFrame(renderLobby); });
  setIf('audioState', S.soundOn, syncAudioButtons);
  tanks.forEach((t, i) => {
    const h = hud.hp[i];
    setIf('hp' + i, t.hp + '/' + t.maxHp, () => { h.bar.style.width = (t.hp / t.maxHp * 100) + '%'; h.num.textContent = t.hp; });
    setIf('gh' + i, Math.round(t.shownHp) + '/' + t.maxHp, () => { h.ghost.style.width = (t.shownHp / t.maxHp * 100) + '%'; });
    setIf('act' + i, i === cur && phase !== 'over' && phase !== 'menu', v => h.box.classList.toggle('active', v));
  });
  const lvl = clamp(Math.round(Math.abs(wind) / 18), 0, 10);
  setIf('wind', lvl + (wind < 0 ? 'L' : 'R'), () => {
    hud.windNum.textContent = lvl;
    hud.windSvg.style.transform = wind < 0 ? 'scaleX(-1)' : 'none';
    hud.windSvg.style.opacity = lvl === 0 ? 0.3 : 1;
    pipEls.forEach((e, k) => { e.classList.toggle('on', k < lvl); e.classList.toggle('strong', k < lvl && lvl >= 7); });
    const box = document.getElementById('wind'); box.classList.remove('shift'); void box.offsetWidth; box.classList.add('shift');   // the wind now changes only every few turns: make a change noticeable
  });
  const t = tanks[cur];
  if (!t) return;
  // turn clock
  const inGame = phase !== 'menu' && phase !== 'over';
  setIf('tmrShow', timed() && inGame, v => { hud.timer.hidden = !v; });
  if (timed() && inGame){
    const active = TURN_PHASES.includes(phase);
    const left = active ? Math.max(0, S.turnTime - turnT) : S.turnTime;
    setIf('tmr', Math.ceil(left) + (active ? 'a' : 'i') + (isHuman(cur) ? 'h' : 'c'), () => {
      hud.timerNum.textContent = Math.ceil(left);
      hud.timer.classList.toggle('idle', !active);
      hud.timer.classList.toggle('warn', active && isHuman(cur) && left <= 5);
    });
    setIf('tmrP', Math.round(left / S.turnTime * 200), v => hud.timer.style.setProperty('--p', v / 200));
  }
  setIf('passShow', mode !== 'practice' && inGame, v => { hud.pass.hidden = !v; });
  setIf('passOn', canControl() && phase === 'aim', v => { hud.pass.disabled = !v; });
  // delay readout: committed delay, and during a turn what it becomes if you fire the selected shell now
  const showD = S.delayOn && mode !== 'practice' && inGame;
  tanks.forEach((tk, i) => {
    let html = '';
    if (showD){
      const o = tanks[1 - i], base = Math.min(tk.delay, o.delay);
      html = '딜레이 ' + (tk.delay - base);
      if (i === cur && TURN_PHASES.includes(phase)){
        const proj = tk.delay + shotDelay(tk, tk.sel) + (tk.arm ? FXD[tk.arm].delay : 0) + Math.floor(turnT) * 10 - base, again = proj < o.delay - base;
        html += ` → <em${again ? ' class="go"' : ''}>${proj}${again ? ' 한 번 더' : ''}</em>`;
      }
    }
    setIf('dly' + i, html, v => { hud.hp[i].dly.innerHTML = v; });
  });
  const selected = SHELL[t.sel];
  let shotInfo = selected.name;
  if (TURN_PHASES.includes(phase)){
    if (showD){
      const cost = shotDelay(t, t.sel) + (t.arm ? FXD[t.arm].delay : 0) + Math.floor(turnT) * 10;
      const next = t.delay + cost < tanks[1 - cur].delay ? cur : 1 - cur;
      shotInfo += ` · 딜레이 ${cost} · 다음 ${NAMES[mode][next]} 턴`;
    } else shotInfo += t.ammo[t.sel] === Infinity ? ' · 무제한' : ` · ${t.ammo[t.sel]}발 남음`;
  } else if (phase === 'flying') shotInfo += ' · 비행 중';
  else if (phase === 'settle') shotInfo += ' · 결과 확인 중';
  setIf('shotInfo', shotInfo, v => { $('#shot-info').textContent = v; $('#shot-info').title = selected.desc; });
  const showP = (phase === 'charging' || phase === 'aiCharge') ? power : 0;
  setIf('pow', Math.round(showP * 10) / 10, v => {
    hud.fill.style.width = `calc(${v}% - ${v / 100 * 4}px)`;
    hud.pow.textContent = Math.round(v);
    hud.fill.classList.toggle('max', v >= 99.5 && !S.pingPong);
  });
  setIf('rush', !!t.rushNow && TURN_PHASES.includes(phase), v => $('#gauge').classList.toggle('rush', v));
  setIf('prev', t.lastPower === null ? 'none' : Math.round(t.lastPower * 10) / 10 + ':' + cur, () => {
    hud.prev.hidden = t.lastPower === null;
    if (t.lastPower !== null) hud.prev.style.left = t.lastPower + '%';
  });
  const real = Math.round(worldElev(t, t.facing, t.elev));
  setIf('ang', Math.round(t.elev) + (t.facing > 0 ? '→' : '←'), v => { hud.ang.textContent = v.replace(/(\d+)/, '$1°'); hud.angMini.textContent = v.replace(/(\d+)/, '$1°'); });
  setIf('real', real, v => { hud.angReal.textContent = v + '°'; });
  setIf('fuel', Math.round(t.fuel) + '/' + t.m.fuel, () => { hud.fuel.style.width = (t.fuel / t.m.fuel * 100) + '%'; });
  const key = [cur, t.m.id, Math.round(t.elev * 2), Math.round((t.tilt || 0) * 200), t.facing, t.lastElev, t.lastFacing, dialC.width].join('|');
  if (key !== dialKey){ dialKey = key; drawDial(t); }
  setIf('ctl', canControl(), v => { hud.touchBtns.forEach(b => b.disabled = !v); keycap.disabled = !v; if (!v) fxOpen = false; renderCards(); });
}

/* ---------- banner & toast ---------- */
let bannerTimer = 0, toastTimer = 0;
function banner(text, color){
  const b = $('#banner'); b.textContent = text; b.style.color = color || ''; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => b.classList.remove('show'), 1450);
}
function toast(text, ms = 1500){
  const el = $('#toast'); el.textContent = text; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ---------- original chip soundtrack & synthesized effects ---------- */
// Two original 16-bar arrangements, written for this game. No samples or third-party OSTs.
// MIDI pitches; -1 holds the previous note, 0 leaves space. One entry is an eighth note.
const CHIP_SCORE = {
  roots: [40,36,43,38,40,36,45,35,40,43,36,38,45,40,35,40],
  chords: [[64,67,71],[60,64,67],[62,67,71],[62,66,69],[64,67,71],[60,64,67],[60,64,69],[59,63,66],
    [64,67,71],[62,67,71],[60,64,67],[62,66,69],[60,64,69],[64,67,71],[59,63,66],[64,67,71]],
  menu: { bpm: 96, lead: [
    [76,-1,0,79,78,-1,76,0], [72,-1,76,-1,79,-1,76,74],
    [71,-1,74,0,79,-1,78,74], [74,-1,78,-1,81,-1,78,0],
    [76,-1,79,78,76,-1,71,0], [72,-1,76,0,79,81,79,76],
    [81,-1,79,76,72,-1,74,0], [75,-1,78,-1,71,-1,0,0],
    [79,-1,83,-1,81,79,76,0], [79,-1,78,74,71,-1,74,0],
    [76,-1,79,0,84,-1,83,79], [81,-1,78,74,78,-1,81,0],
    [81,-1,79,76,72,-1,76,0], [79,-1,76,71,76,-1,78,0],
    [78,-1,75,71,75,78,83,0], [79,78,76,-1,-1,-1,0,0]
  ]},
  battle: { bpm: 122, lead: [
    [76,0,76,79,78,76,71,74], [76,-1,79,76,72,0,74,76],
    [79,0,78,74,71,74,79,83], [81,-1,78,74,78,0,74,0],
    [76,76,79,83,81,79,78,76], [79,-1,76,72,76,79,84,83],
    [81,0,79,76,72,74,76,79], [78,-1,75,71,75,78,83,0],
    [83,-1,81,79,76,-1,79,0], [83,0,86,-1,83,81,79,78],
    [84,-1,83,79,76,-1,79,83], [81,0,78,74,78,-1,81,0],
    [81,79,76,72,76,79,81,84], [83,-1,79,76,78,79,83,0],
    [78,75,71,75,78,83,81,78], [79,78,76,-1,71,74,76,-1]
  ]}
};
const Snd = {
  ac: null, master: null, fxBus: null, musicBus: null, musicDuck: null, noise: null,
  charge: null, whistle: null, rum: null, scene: 'menu', musicTimer: 0, musicStep: 0, nextNote: 0,
  voices: { fx: new Set(), music: new Set() }, resuming: false, suspending: null,
  level(v){ return Number.isFinite(+v) ? clamp(+v, 0, 1) : 0; },
  enabled(){ return !document.hidden && S.soundOn && this.level(S.volume) > 0; },
  init(){
    // Only called from a user gesture. Muted games do not create an audio context.
    if (!this.enabled() || (!S.musicOn && !S.sfxOn)) return;
    if (this.ac){ this.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      this.ac = new AC();
      this.master = this.ac.createGain();
      const limiter = this.ac.createDynamicsCompressor();
      limiter.threshold.value = -9; limiter.knee.value = 12; limiter.ratio.value = 6;
      limiter.attack.value = 0.003; limiter.release.value = 0.18;
      this.master.connect(limiter); limiter.connect(this.ac.destination);
      this.fxBus = this.ac.createGain(); this.fxBus.connect(this.master);
      this.musicBus = this.ac.createGain(); this.musicDuck = this.ac.createGain();
      const color = this.ac.createBiquadFilter(); color.type = 'lowpass'; color.frequency.value = 6000;
      this.musicBus.connect(this.musicDuck); this.musicDuck.connect(color); color.connect(this.master);
      const len = Math.ceil(this.ac.sampleRate * 1.5), buf = this.ac.createBuffer(1, len, this.ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      const real = new Float32Array(33), imag = new Float32Array(33);
      for (let n = 1; n < imag.length; n++) imag[n] = 2 * Math.sin(n * Math.PI * 0.25) / (n * Math.PI);
      this.chipWave = this.ac.createPeriodicWave(real, imag);
      this.vol(); this.resume();
    } catch (e) {
      // A browser without working Web Audio must still be able to play the game.
      if (this.ac) this.ac.close().catch(() => {});
      this.ac = null; this.master = this.fxBus = this.musicBus = this.musicDuck = null;
    }
  },
  ok(){ return this.ac && this.ac.state === 'running' && this.enabled() && S.sfxOn && this.level(S.sfxVolume) > 0; },
  musicOK(){ return this.ac && this.ac.state === 'running' && this.enabled() && S.musicOn && this.level(S.musicVolume) > 0; },
  resume(){
    if (!this.ac || !this.enabled()) return;
    if (this.suspending){ this.suspending.then(() => { if (!document.hidden) this.resume(); }); return; }
    if (this.ac.state === 'running'){ this.vol(); return; }
    if (this.resuming || this.ac.state === 'closed') return;
    this.resuming = true;
    try { Promise.resolve(this.ac.resume()).then(() => {
      this.resuming = false;
      if (document.hidden) this.pause(); else this.vol();
    }, () => { this.resuming = false; }); } catch (e) { this.resuming = false; }
  },
  pause(){
    this.stopMusic(true); this.stopEffects();
    if (this.master){ this.master.gain.cancelScheduledValues(this.ac.currentTime); this.master.gain.value = 0; }
    if (this.ac && this.ac.state !== 'closed' && !this.suspending){
      try { this.suspending = Promise.resolve(this.ac.suspend()).catch(() => {}).then(() => { this.suspending = null; }); }
      catch (e) { this.suspending = null; }
    }
  },
  vol(){
    if (!this.ac || !this.master) return;
    const t = this.ac.currentTime, gain = (node, v) => {
      node.gain.cancelScheduledValues(t); node.gain.setTargetAtTime(v, t, 0.015);
    };
    gain(this.master, this.enabled() ? this.level(S.volume) : 0);
    gain(this.fxBus, S.sfxOn ? this.level(S.sfxVolume) : 0);
    gain(this.musicBus, S.musicOn ? this.level(S.musicVolume) : 0);
    if (!this.ok()) this.stopEffects();
    if (!this.musicOK()) this.stopMusic(true); else this.startMusic();
  },
  track(source, nodes, group, envelope){
    const rec = { source, nodes, envelope }, list = this.voices[group];
    list.add(rec);
    source.onended = () => { list.delete(rec); source.disconnect(); nodes.forEach(n => n.disconnect()); };
  },
  stopVoices(group, fade = 0){
    if (!this.ac) return;
    const t = this.ac.currentTime;
    for (const rec of [...this.voices[group]]){
      try {
        if (fade && rec.envelope){
          rec.envelope.gain.cancelScheduledValues(t); rec.envelope.gain.setTargetAtTime(0.0001, t, 0.006);
          rec.source.stop(t + fade);
        } else {
          rec.source.onended = null; rec.source.stop(); rec.source.disconnect(); rec.nodes.forEach(n => n.disconnect());
          this.voices[group].delete(rec);
        }
      } catch (e) { this.voices[group].delete(rec); }
    }
  },
  stopEffects(){ this.stopVoices('fx'); this.charge = this.whistle = this.rum = null; },
  toneAt(type, f0, f1, dur, vol, t, group = 'fx'){
    const o = this.ac.createOscillator(), g = this.ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(group === 'music' ? this.musicBus : this.fxBus);
    this.track(o, [g], group, g); o.start(t); o.stop(t + dur + 0.02);
  },
  noiseAt(dur, vol, ftype, f0, f1, t, group = 'fx'){
    const s = this.ac.createBufferSource(); s.buffer = this.noise;
    const f = this.ac.createBiquadFilter(); f.type = ftype; f.Q.value = 0.7;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = this.ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(group === 'music' ? this.musicBus : this.fxBus);
    this.track(s, [f, g], group, g); s.start(t, Math.random() * 0.4); s.stop(t + dur + 0.03);
  },
  tone(type, f0, f1, dur, vol, delay = 0){ if (this.ok()) this.toneAt(type, f0, f1, dur, vol, this.ac.currentTime + delay); },
  burst(dur, vol, ftype, f0, f1, delay = 0){ if (this.ok()) this.noiseAt(dur, vol, ftype, f0, f1, this.ac.currentTime + delay); },
  duck(duration = 0.35){
    if (!this.musicOK() || !this.ok()) return;
    const g = this.musicDuck.gain, t = this.ac.currentTime;
    g.cancelScheduledValues(t); g.setTargetAtTime(0.42, t, 0.018); g.setTargetAtTime(1, t + duration, 0.14);
  },
  tick(v = 0.4){ this.tone('square', 1046, 880, 0.035, 0.045 * v); },
  pop(){ this.tone('triangle', 880, 330, 0.12, 0.18); this.burst(0.07, 0.14, 'highpass', 2800, 1200); },
  fire(){
    this.duck(0.24); this.tone('sine', 180, 45, 0.28, 0.72);
    this.burst(0.06, 0.5, 'highpass', 2400, 1000); this.burst(0.28, 0.38, 'lowpass', 1400, 150, 0.015);
    this.tone('triangle', 370, 95, 0.07, 0.13);
  },
  boom(big, direct){
    const k = Math.min(1.6, big); this.duck(0.45);
    this.burst(0.38 + 0.27 * k, Math.min(0.8, 0.48 * k + 0.1), 'lowpass', 2100, 100);
    this.tone('sine', 100, 27, 0.4 + 0.23 * k, 0.72);
    this.burst(0.055, 0.38, 'highpass', 3100, 1200);
    if (direct){ this.tone('triangle', 784, 784, 0.12, 0.19, 0.04); this.tone('square', 1175, 1175, 0.16, 0.055, 0.12); }
  },
  thud(){ this.tone('sine', 85, 40, 0.16, 0.4); this.burst(0.1, 0.19, 'lowpass', 500, 120); },
  grind(start){ if (start) this.burst(0.25, 0.3, 'bandpass', 500, 200); else if (Math.random() < 0.3) this.burst(0.05, 0.1, 'bandpass', 700, 300); },
  chargeStart(){
    if (!this.ok() || this.charge) return;
    const o = this.ac.createOscillator(), f = this.ac.createBiquadFilter(), g = this.ac.createGain();
    o.type = 'sawtooth'; o.frequency.value = 110; f.type = 'lowpass'; f.frequency.value = 900; g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.045, this.ac.currentTime + 0.05);
    o.connect(f); f.connect(g); g.connect(this.fxBus); this.track(o, [f, g], 'fx', g); o.start();
    this.charge = { o, g, f };
  },
  chargeLevel(p){ if (this.charge){ const t = this.ac.currentTime; this.charge.o.frequency.setTargetAtTime(110 + p * 4.2, t, 0.02); this.charge.f.frequency.setTargetAtTime(700 + p * 22, t, 0.03); } },
  chargeStop(){ if (this.charge){ const { o, g } = this.charge, t = this.ac.currentTime; g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0.0001, t, 0.015); o.stop(t + 0.1); this.charge = null; } },
  whistleStart(){
    if (!this.ok() || this.whistle) return;
    const o = this.ac.createOscillator(), g = this.ac.createGain();
    o.type = 'sine'; o.frequency.value = 700; g.gain.value = 0.0001; g.gain.exponentialRampToValueAtTime(0.018, this.ac.currentTime + 0.2);
    o.connect(g); g.connect(this.fxBus); this.track(o, [g], 'fx', g); o.start(); this.whistle = { o, g };
  },
  whistleLevel(vy){ if (this.whistle){ const f = 420 + 520 * clamp(0.5 - vy / 1400, 0, 1); this.whistle.o.frequency.setTargetAtTime(f, this.ac.currentTime, 0.05); } },
  whistleStop(){ if (this.whistle){ const { o, g } = this.whistle, t = this.ac.currentTime; g.gain.setTargetAtTime(0.0001, t, 0.02); o.stop(t + 0.15); this.whistle = null; } },
  rumble(on){
    if (on && !this.rum && this.ok()){
      const s = this.ac.createBufferSource(); s.buffer = this.noise; s.loop = true;
      const f = this.ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 240;
      const g = this.ac.createGain(); g.gain.value = 0.0001; g.gain.exponentialRampToValueAtTime(0.07, this.ac.currentTime + 0.05);
      s.connect(f); f.connect(g); g.connect(this.fxBus); this.track(s, [f, g], 'fx', g); s.start(); this.rum = { s, g };
    } else if (!on && this.rum){ const { s, g } = this.rum, t = this.ac.currentTime; g.gain.setTargetAtTime(0.0001, t, 0.03); s.stop(t + 0.2); this.rum = null; }
  },
  note(midi, t, dur, level, type = 'chip', pan = 0){
    const o = this.ac.createOscillator(), g = this.ac.createGain(), nodes = [g];
    if (type === 'chip') o.setPeriodicWave(this.chipWave); else o.type = type;
    o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    const attack = Math.min(type === 'sine' ? 0.12 : 0.012, dur * 0.18);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.linearRampToValueAtTime(level * 0.72, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    if (pan && this.ac.createStereoPanner){ const p = this.ac.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(this.musicBus); nodes.push(p); }
    else g.connect(this.musicBus);
    this.track(o, nodes, 'music', g); o.start(t); o.stop(t + dur + 0.02);
  },
  drum(kind, t, v){
    if (kind === 'kick') this.toneAt('sine', 140, 44, 0.16, v, t, 'music');
    else if (kind === 'snare'){
      this.noiseAt(0.115, v, 'bandpass', 1900, 1100, t, 'music');
      this.toneAt('triangle', 175, 105, 0.09, v * 0.4, t, 'music');
    } else this.noiseAt(0.035, v, 'highpass', 6500, 4800, t, 'music');
  },
  setScene(scene){
    if (this.scene === scene) return;
    this.scene = scene; this.stopMusic(); this.musicStep = 0;
    if (this.musicDuck){ this.musicDuck.gain.cancelScheduledValues(this.ac.currentTime); this.musicDuck.gain.value = 1; }
    this.startMusic();
  },
  stopMusic(hard = false){
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = 0;
    this.stopVoices('music', !hard && this.ac && this.ac.state === 'running' && !document.hidden ? 0.025 : 0);
  },
  startMusic(){
    if (this.musicTimer || !this.musicOK() || !CHIP_SCORE[this.scene]) return;
    this.musicStep = 0; this.nextNote = this.ac.currentTime + 0.04;
    this.musicTimer = setInterval(() => this.schedule(), 50);
    this.schedule();
  },
  schedule(){
    if (!this.musicOK()){ this.stopMusic(true); return; }
    const score = CHIP_SCORE[this.scene]; if (!score) return;
    const now = this.ac.currentTime, stepDur = 60 / score.bpm / 4;
    // Never play missed notes in a burst after an interruption or a throttled background tab.
    if (this.nextNote < now - 0.2){ this.musicStep = (Math.ceil(this.musicStep / 16) * 16) % 256; this.nextNote = now + 0.03; }
    let budget = 8;
    while (this.nextNote < now + 0.16 && budget-- > 0){
      this.scoreStep(this.musicStep, this.nextNote, score, stepDur);
      this.musicStep = (this.musicStep + 1) % 256; this.nextNote += stepDur;
    }
  },
  scoreStep(step, t, score, d){
    const bar = Math.floor(step / 16), i = step % 16, battle = this.scene === 'battle';
    const root = CHIP_SCORE.roots[bar], chord = CHIP_SCORE.chords[bar], phrase = score.lead[bar];
    const bridge = bar >= 8 && bar < 12;
    if (i === 0) chord.forEach((n, k) => this.note(n - 12, t, d * 14, battle ? 0.025 : 0.034, 'sine', (k - 1) * 0.2));
    if (i % (battle ? 2 : 4) === 0){
      const pattern = battle ? [0,0,12,0,7,7,12,7] : [0,7,12,7];
      this.note(root + pattern[Math.floor(i / (battle ? 2 : 4))], t, d * (battle ? 1.55 : 2.8), battle ? 0.19 : 0.145, 'triangle');
    }
    if (i % 2 === 0){
      const n = i / 2, pitch = phrase[n];
      if (pitch > 0){
        let span = 1; while (phrase[n + span] === -1) span++;
        this.note(pitch, t, d * (span * 2 - 0.28), battle ? 0.075 : 0.065, 'chip', -0.1);
      }
    }
    if ((battle || bar >= 4) && i % 2 === 1){
      const n = chord[[0,1,2,1][Math.floor(i / 2) % 4]];
      this.note(n, t, d * 0.8, battle ? 0.035 : 0.025, 'triangle', 0.24);
    }
    if (i === 0 || i === 8 || (battle && !bridge && i === 6)) this.drum('kick', t, battle ? 0.24 : 0.13);
    if (i === 4 || i === 12) this.drum('snare', t, battle ? 0.17 : 0.075);
    if (i % (battle ? 2 : 4) === 0) this.drum('hat', t, i % 4 ? 0.034 : 0.045);
    if (battle && bar % 4 === 3 && (i === 14 || i === 15)) this.drum('snare', t, 0.11 + (i - 14) * 0.025);
  },
  result(kind){
    this.chargeStop(); this.whistleStop(); this.rumble(false); this.setScene('over');
    if (!this.musicOK()) return;
    const t = this.ac.currentTime + 0.08;
    const line = kind === 'win' ? [76,79,83,88,86,83,88] : kind === 'lose' ? [76,74,71,67,66,64] : [71,74,76,71,76];
    const beat = kind === 'win' ? 0.15 : 0.23;
    line.forEach((n, i) => this.note(n, t + i * beat, i === line.length - 1 ? 1.05 : beat * 0.88, 0.12, 'chip', -0.08));
    const chord = kind === 'win' ? [52,59,64,68] : [40,47,52,55];
    chord.forEach((n, i) => this.note(n, t + line.length * beat * 0.55, 1.5, 0.08, 'triangle', (i - 1.5) * 0.1));
    this.drum('kick', t, 0.22);
  }
};
document.addEventListener('visibilitychange', () => { if (document.hidden) Snd.pause(); });
window.addEventListener('pagehide', () => Snd.pause());
function buzz(p){ if (J('vibrate') && navigator.vibrate){ try { navigator.vibrate(p); } catch (e) {} } }

/* ---------- tuning panel ---------- */
const PANEL = [
  { title: '규칙', rows: [
    { key: 'turnTime', label: '턴 제한 시간', min: 0, max: 60, step: 5, fmt: v => v ? v + '초' : '없음' },
    { on: 'delayOn', label: '딜레이에 따라 턴 순서 결정' },
    { key: 'handSize', label: '아이템 칸(다음 판부터)', min: 0, max: 3, step: 1, fmt: v => v ? v + '개' : '없음' }
  ]},
  { title: '화면', rows: [
    { key: 'viewZoom', label: '화면 확대', min: 0.6, max: 1.6, step: 0.05, fmt: v => '×' + v.toFixed(2) },
    { on: 'readoutOn', label: '탱크 아래 각도·파워 표시' },
    { on: 'latencyOn', label: '터치 지연 표시(입력부터 그림까지)' }
  ]},
  { title: '물리', rows: [
    { key: 'gravity', label: '중력', min: 200, max: 1000, step: 10, fmt: v => v },
    { key: 'windMax', label: '바람 최대 세기', min: 0, max: 220, step: 5, fmt: v => v },
    { key: 'powerScale', label: '포탄 속도', min: 0.6, max: 1.6, step: 0.02, fmt: v => '×' + v.toFixed(2) },
    { key: 'gaugeSpeed', label: '게이지 속도', min: 20, max: 180, step: 2, fmt: v => v + '/초' },
    { key: 'moveSpeed', label: '이동 속도', min: 20, max: 160, step: 5, fmt: v => v },
    { on: 'pingPong', label: '게이지 왕복(끝에서 되돌아옴)' },
    { on: 'aimLineOn', label: '조준선(포신 연장선)' }
  ]},
  { title: '전투 연출', rows: [
    { key: 'hitStop', on: 'hitStopOn', label: '맞는 순간 멈춤', min: 0, max: 250, step: 5, fmt: v => v + 'ms' },
    { key: 'shake', on: 'shakeOn', label: '화면 흔들림', min: 0, max: 2.5, step: 0.05, fmt: v => '×' + v.toFixed(2) },
    { key: 'slowFactor', on: 'slowOn', label: '명중 직전 느린 화면', min: 0.1, max: 1, step: 0.05, fmt: v => '×' + v.toFixed(2) },
    { key: 'slowRadius', label: '느려지기 시작하는 거리', min: 40, max: 400, step: 10, fmt: v => v },
    { key: 'camZoom', on: 'camOn', label: '포탄 따라갈 때 확대', min: 1, max: 1.8, step: 0.05, fmt: v => '×' + v.toFixed(2) },
    { key: 'camDelay', label: '확대가 시작되는 때', min: 0, max: 1.2, step: 0.05, fmt: v => v.toFixed(2) + '초 뒤' },
    { key: 'particles', on: 'particlesOn', label: '파편과 불꽃', min: 0, max: 2.5, step: 0.05, fmt: v => '×' + v.toFixed(2) },
    { key: 'recoil', on: 'recoilOn', label: '반동과 충전 떨림', min: 0, max: 2.5, step: 0.05, fmt: v => '×' + v.toFixed(2) },
    { on: 'flashOn', label: '섬광' },
    { on: 'numbersOn', label: '피해 숫자' },
    { on: 'trailOn', label: '포탄 꼬리' }
  ]},
  { title: '소리와 진동', rows: [
    { key: 'volume', on: 'soundOn', label: '전체 음량', min: 0, max: 1, step: 0.05, fmt: v => Math.round(v * 100) + '%' },
    { key: 'musicVolume', on: 'musicOn', label: '배경음악', min: 0, max: 1, step: 0.05, fmt: v => Math.round(v * 100) + '%' },
    { key: 'sfxVolume', on: 'sfxOn', label: '효과음', min: 0, max: 1, step: 0.05, fmt: v => Math.round(v * 100) + '%' },
    { on: 'vibrateOn', label: '진동(지원하는 기기)' }
  ]},
  { title: '상대', rows: [
    { key: 'aiSkill', label: '컴퓨터 난이도', min: 0, max: 1, step: 0.05, fmt: v => Math.round(v * 100) + '%' }
  ]}
];
function buildPanel(){
  const basicKeys = new Set(['volume', 'musicVolume', 'sfxVolume', 'vibrateOn', 'viewZoom', 'readoutOn', 'aimLineOn', 'shake', 'flashOn', 'numbersOn', 'trailOn']);
  const groupHTML = g => `<div class="grp"><h3>${g.title}</h3>${g.rows.map(r => {
    if (!r.key) return `<div class="prow only"><input type="checkbox" id="c-${r.on}" data-on="${r.on}"><label for="c-${r.on}">${r.label}</label></div>`;
    const chk = r.on ? `<input type="checkbox" id="c-${r.on}" data-on="${r.on}" aria-label="${r.label} 켜기">` : '';
    return `<div class="prow" data-row="${r.key}"><div class="lab">${chk}<label for="r-${r.key}">${r.label}</label></div><input type="range" id="r-${r.key}" data-key="${r.key}" min="${r.min}" max="${r.max}" step="${r.step}"><span class="val" id="v-${r.key}"></span></div>`;
  }).join('')}</div>`;
  const basic = title => ({ title, rows: PANEL.flatMap(g => g.rows).filter(r => basicKeys.has(r.key || r.on) && (title === '소리와 진동' ? ['volume','musicVolume','sfxVolume','vibrateOn'].includes(r.key || r.on) : !['volume','musicVolume','sfxVolume','vibrateOn'].includes(r.key || r.on))) });
  $('#panel-body').innerHTML = [basic('소리와 진동'), basic('화면과 조작')].map(groupHTML).join('');
  $('#advanced-body').innerHTML = PANEL.map(g => ({ ...g, rows: g.rows.filter(r => !basicKeys.has(r.key || r.on)) })).filter(g => g.rows.length).map(groupHTML).join('');
  syncPanel();
}
const FMT = Object.fromEntries(PANEL.flatMap(g => g.rows).filter(r => r.key).map(r => [r.key, r]));
function normalizeSettings(raw){
  const clean = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clean;
  for (const [key, fallback] of Object.entries(DEFAULTS)){
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const value = raw[key];
    if (typeof fallback === 'boolean'){
      if (typeof value === 'boolean') clean[key] = value;
    } else if (typeof value === 'number' && Number.isFinite(value)){
      const row = FMT[key];
      clean[key] = row ? clamp(value, row.min, row.max) : value;
      if (row?.step === 1) clean[key] = Math.round(clean[key]);
    }
  }
  return clean;
}
function syncPanel(){
  document.querySelectorAll('#panel [data-key]').forEach(inp => { inp.value = S[inp.dataset.key]; $('#v-' + inp.dataset.key).textContent = FMT[inp.dataset.key].fmt(+S[inp.dataset.key]); });
  document.querySelectorAll('#panel [data-on]').forEach(inp => { inp.checked = !!S[inp.dataset.on]; });
  PANEL.flatMap(g => g.rows).filter(r => r.key && r.on).forEach(r => { const row = document.querySelector(`[data-row="${r.key}"]`); if (row) row.classList.toggle('off', !S[r.on]); });
  const m = $('#juice-master'); m.classList.toggle('on', S.juice); m.textContent = S.juice ? '전투 연출 켜짐' : '전투 연출 꺼짐';
  syncAudioButtons();
}
$('#panel').addEventListener('input', e => {
  const k = e.target.dataset.key, o = e.target.dataset.on;
  if (k){ S[k] = +e.target.value; $('#v-' + k).textContent = FMT[k].fmt(S[k]); if (['volume', 'musicVolume', 'sfxVolume'].includes(k)){ Snd.init(); Snd.vol(); } if (k === 'windMax' && tanks.length) wind = clamp(wind, -S.windMax, S.windMax); }
  if (o){ S[o] = e.target.checked; syncPanel(); if (['soundOn', 'musicOn', 'sfxOn'].includes(o)){ Snd.init(); Snd.vol(); } }
  saveSettings();
});
$('#juice-master').addEventListener('click', () => { S.juice = !S.juice; syncPanel(); saveSettings(); toast(S.juice ? '전투 연출을 켰습니다' : '전투 연출을 껐습니다'); });
$('#btn-reset').addEventListener('click', () => { S = { ...DEFAULTS }; wind = clamp(wind, -S.windMax, S.windMax); syncPanel(); Snd.vol(); saveSettings(); toast('설정을 기본값으로 되돌렸습니다'); });
$('#btn-copy').addEventListener('click', () => {
  const text = '탄착점 설정값 ' + JSON.stringify(S);
  const box = $('#copy-box');
  const fallback = () => { box.hidden = false; box.value = text; box.focus(); box.select(); toast('글자를 길게 눌러 복사해 주세요', 2200); };
  try { navigator.clipboard.writeText(text).then(() => { toast('수치를 복사했습니다'); box.hidden = true; }, fallback); }
  catch (e) { fallback(); }
});
let panelFocus = null;
function togglePanel(force){
  const p = $('#panel'); const open = force !== undefined ? force : p.hidden;
  if (open === !p.hidden) return;
  if (open){ panelFocus = document.activeElement; resetInputs(); fxOpen = false; Snd.chargeStop(); Snd.whistleStop(); }
  p.hidden = !open; $('#panel-shade').hidden = !open;
  if (open){
    syncPanel(); const inGame = phase !== 'menu' && phase !== 'over';
    $('#pause-note').hidden = !inGame; $('#panel-close').textContent = inGame ? '계속하기' : '닫기';
    $('#panel-close').focus();
  } else if (panelFocus?.isConnected) panelFocus.focus();
  updateHUD();
}
$('#btn-tune').addEventListener('click', () => togglePanel());
$('#btn-pass').addEventListener('click', e => { passTurn(false); e.currentTarget.blur(); });
$('#panel-close').addEventListener('click', () => togglePanel(false));
$('#panel-shade').addEventListener('click', () => togglePanel(false));
$('#panel').addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const controls = [...panelEl.querySelectorAll('button:not(:disabled),input:not(:disabled),summary,textarea:not([hidden])')].filter(el => el.getClientRects().length);
  const first = controls[0], last = controls[controls.length - 1];
  if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last?.focus(); }
  else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first?.focus(); }
});

/* ---------- menus ---------- */
const LOBBY_META = { light: ['01', 'SCOUT'], armored: ['02', 'TITAN'], howitzer: ['03', 'COMET'], digger: ['04', 'DRILLER'] };
function renderLobby(){
  if ($('#start').hidden) return;
  const m = MOBILE[previewPick] || MOBILE.digger, meta = LOBBY_META[m.id];
  $('#hero-role').textContent = meta[1];
  $('#hero-name').textContent = m.name; $('#hero-desc').textContent = m.desc;
  $('#hero-shell').textContent = '전용탄 · ' + SHELL[m.shells[m.shells.length - 1]].name;
  $('#hangar-tabs').innerHTML = MOBILES.map(k => `<button type="button" data-preview="${k.id}" aria-pressed="${k.id === m.id}">${k.name}</button>`).join('');
  drawPreview($('#hero-tank'), m.id, 0);
}
function syncAudioButtons(){
  document.querySelectorAll('[data-audio-toggle]').forEach(b => { b.textContent = S.soundOn ? '소리 켜짐' : '소리 꺼짐'; b.setAttribute('aria-pressed', String(!S.soundOn)); b.setAttribute('aria-label', S.soundOn ? '전체 소리 끄기' : '전체 소리 켜기'); });
}
document.querySelectorAll('[data-audio-toggle]').forEach(b => {
  b.setAttribute('data-audio-control', '');
  b.addEventListener('click', () => { S.soundOn = !S.soundOn; Snd.init(); Snd.vol(); syncPanel(); saveSettings(); syncAudioButtons(); });
});
$('#hangar-tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-preview]'); if (!b) return;
  previewPick = b.dataset.preview;
  Snd.init(); Snd.tick(0.4); renderLobby();
});
$('#lobby-settings').addEventListener('click', () => togglePanel(true));
$('#map-choice').addEventListener('change', e => {
  const value = e.target.value;
  if (value !== 'random' && !MAP_BY_ID[value]) return;
  mapChoice = value;
  try { localStorage.setItem(MAP_KEY, value); } catch(err) {}
  Snd.tick(0.3);
});
let helpFocus = null;
function openHelp(){ helpFocus = document.activeElement; resetInputs(); $('#help').hidden = false; $('#help-close').focus(); }
$('#lobby-help').addEventListener('click', openHelp);
$('#panel-help').addEventListener('click', openHelp);
function closeHelp(){ $('#help').hidden = true; if (helpFocus?.isConnected) helpFocus.focus(); }
$('#help-close').addEventListener('click', closeHelp);
$('#help').addEventListener('keydown', e => { if (e.key === 'Tab'){ e.preventDefault(); $('#help-close').focus(); } });
window.addEventListener('keydown', e => { if (e.key === 'Escape'){ if (!$('#help').hidden) closeHelp(); else if (!$('#panel').hidden) togglePanel(false); } });
window.addEventListener('resize', () => requestAnimationFrame(() => { renderLobby(); if (!$('#pick').hidden) renderPick(); }));
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { Snd.init(); Snd.tick(0.4); openPick(b.dataset.mode); }));
// again: same mobiles for the players; the computer (or practice target) gets a fresh random one
$('#btn-again').addEventListener('click', () => { Snd.init(); startGame(mode, mode === 'duo' ? gamePicks : [gamePicks[0], randomMobile()]); });
$('#btn-home').addEventListener('click', goHome);
$('#btn-menu').addEventListener('click', goHome);
function goHome(){
  clearTimeout(overTimer);
  clearTimeout(bannerTimer); clearTimeout(toastTimer);
  $('#banner').classList.remove('show'); $('#toast').classList.remove('show');
  resetInputs(); panelEl.hidden = true; $('#panel-shade').hidden = true; $('#help').hidden = true;
  Snd.chargeStop(); Snd.whistleStop(); Snd.rumble(false);
  phase = 'menu'; shells = []; timers = []; lastShot = null; parts = []; texts = []; rings = []; hitStop = 0; trauma = 0; screenFlash = 0;
  clearLook(); aiJob = null; $('#over').hidden = true; $('#pick').hidden = true; $('#start').hidden = false;
  Snd.setScene('menu');
  updateHUD(); renderLobby();
}
/* ---------- mobile picker ---------- */
const PICK_KEY = 'tanchak-mobile-v1';
const MODE_NAMES = { ai: 'AI 대전', duo: '둘이서 대전', practice: '연습 사격' };
let lastPicks = DEFAULT_PICKS.slice();
try { const o = JSON.parse(localStorage.getItem(PICK_KEY) || 'null'); if (Array.isArray(o)) lastPicks = DEFAULT_PICKS.map((d, i) => MOBILE[o[i]] ? o[i] : d); } catch (e) {}
let previewPick = lastPicks[0];
let pickMode = 'ai', pickStep = 0, pickNow = [];
function openPick(m){
  pickMode = m; pickStep = 0; pickNow = [];
  $('#start').hidden = true; $('#over').hidden = true; $('#pick').hidden = false;
  renderPick();
}
function renderPick(){
  const who = pickMode === 'duo' ? (pickStep === 0 ? '1P ' : '2P ') : '';
  $('#pick-eyebrow').textContent = MODE_NAMES[pickMode];
  $('#pick-title').textContent = who + '탱크 고르기';
  renderDiff();
  const box = $('#mobiles');
  const topHp = Math.max(...MOBILES.map(m => m.hp)), topFuel = Math.max(...MOBILES.map(m => m.fuel));
  box.innerHTML = MOBILES.map(m => {
    const own = SHELL[m.shells[m.shells.length - 1]];
    const shortRole = { light: '빠른 이동 · 낮은 체력', armored: '튼튼한 장갑 · 강한 직격', howitzer: '고각 사격 · 분열탄', digger: '급경사 이동 · 굴착탄' }[m.id];
    return `<button class="mob${lastPicks[pickStep] === m.id ? ' last' : ''}" type="button" data-mob="${m.id}" aria-label="${m.name}. ${m.desc} 체력 ${m.hp}, 이동력 ${m.fuel}, 조준각 ${m.ang[0]}~${m.ang[1]}도, 딜레이 배율 ${m.delayMul || 1}, 전용탄 ${own.name}">
      <span class="mob-code">${LOBBY_META[m.id][1]}</span><canvas aria-hidden="true"></canvas><b>${m.name}</b><span class="role">${m.desc}</span><span class="role-short" aria-hidden="true">${shortRole}</span>
      <dl><dt>체력</dt><dd><span class="bar"><i style="width:${Math.round(m.hp / topHp * 100)}%"></i></span>${m.hp}</dd>
      <dt>이동력</dt><dd><span class="bar"><i style="width:${Math.round(m.fuel / topFuel * 100)}%"></i></span>${m.fuel}</dd>
      <dt>조준각</dt><dd>${m.ang[0]}~${m.ang[1]}°</dd>
      <dt>딜레이</dt><dd>${(m.delayMul || 1) === 1 ? '보통' : (m.delayMul < 1 ? '짧은 편' : '긴 편')}</dd>
      <dt>전용</dt><dd>${own.name}</dd></dl><span class="deploy-line">선택하여 출격 <span aria-hidden="true">▶</span></span></button>`;
  }).join('');
  requestAnimationFrame(() => box.querySelectorAll('.mob').forEach(b => drawPreview(b.querySelector('canvas'), b.dataset.mob, pickStep)));
}
// draws a mobile with the battlefield's own drawTank, pointed at the middle of its angle range
function drawPreview(cv, mid, ci){
  const r = cv.getBoundingClientRect(), k = Math.min(2, window.devicePixelRatio || 1);
  if (r.width < 4 || r.height < 4) return;
  cv.width = Math.round(r.width * k); cv.height = Math.round(r.height * k);
  const g = cv.getContext('2d'), m = MOBILE[mid];
  // A visual preview must not shuffle an item deck or consume gameplay randomness.
  const t = { i: ci, x: 0, y: 0, m, alive: true, gone: false, facing: 1, elev: (m.ang[0] + m.ang[1]) / 2, tilt: 0, recoil: 0, hurt: 0, tread: 0 };
  const sc = Math.min((r.height - 10) / 76, (r.width - 12) / 112) * k;
  g.imageSmoothingEnabled = false;
  g.setTransform(sc, 0, 0, sc, cv.width / 2 - 2 * sc, cv.height - 7 * k);
  ctx = g;
  try { drawTank(t, true); } finally { ctx = gameCtx; }
}
$('#mobiles').addEventListener('click', e => {
  const b = e.target.closest('.mob'); if (!b) return;
  const id = b.dataset.mob;
  Snd.init(); Snd.tick(0.6);
  pickNow[pickStep] = id; lastPicks[pickStep] = id;
  try { localStorage.setItem(PICK_KEY, JSON.stringify(lastPicks)); } catch (err) {}
  if (pickMode === 'duo' && pickStep === 0){ pickStep = 1; renderPick(); return; }
  if (pickMode !== 'duo') pickNow[1] = randomMobile();
  startGame(pickMode, pickNow);
});
$('#pick-back').addEventListener('click', () => {
  if (pickStep > 0){ pickStep--; renderPick(); return; }
  $('#pick').hidden = true; $('#start').hidden = false; renderLobby();
});
// plate badge shows the mobile's silhouette, and its name sits small beside the player's name
// vs computer: three difficulty presets for aiSkill (the tuning panel can set any value in between)
function renderDiff(){
  const el = $('#pick-diff');
  el.hidden = pickMode !== 'ai';
  if (el.hidden) return;
  const near = AI_LEVELS.reduce((b, l) => Math.abs(l[1] - S.aiSkill) < Math.abs(b[1] - S.aiSkill) ? l : b);
  el.innerHTML = '<span class="cap">컴퓨터</span>' + AI_LEVELS.map(l => `<button class="chip${l === near ? ' on' : ''}" type="button" data-skill="${l[1]}" aria-pressed="${l === near}">${l[0]}</button>`).join('');
}
$('#pick-diff').addEventListener('click', e => {
  const b = e.target.closest('[data-skill]'); if (!b) return;
  S.aiSkill = +b.dataset.skill; saveSettings(); renderDiff(); Snd.tick(0.5);
});
function setBadges(){
  tanks.forEach((t, i) => {
    const b = $(`#hp${i} .badge`); b.innerHTML = MOBILE_ICONS[t.m.id]; b.title = t.m.name;
    $(`#hp${i} .nm`).innerHTML = `${NAMES[mode][i]}<small>${t.m.name}</small>`;
  });
}

function checkRotate(){
  const show = document.body.classList.contains('touch') && ch > cw && !portraitOk;
  if (show) resetInputs();
  $('#rotate').hidden = !show;
}
$('#btn-portrait').addEventListener('click', () => { portraitOk = true; checkRotate(); });

/* ---------- back gesture and fullscreen ---------- */
// On a phone, a swipe from the screen edge is the system "back" gesture. When the game runs as its own
// page, keep one extra history entry so an accidental back swipe stays inside the game.
const topLevel = (() => { try { return window.top === window.self; } catch (e) { return false; } })();
let trapArmed = false;
function armBackTrap(){
  if (!topLevel || trapArmed) return;
  try { history.pushState({ tanchak: 1 }, ''); trapArmed = true; } catch (e) {}
}
window.addEventListener('popstate', () => {
  if (!topLevel) return;
  trapArmed = false;
  if (phase !== 'menu' && phase !== 'over'){
    armBackTrap();
    toast('대전을 끝내려면 화면의 메뉴로 버튼을 누르세요', 2400);
  }
});
const fullBtn = $('#btn-full');
const canFull = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
function syncFull(){
  const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
  fullBtn.textContent = on ? '전체화면 끄기' : '전체화면';
  fullBtn.hidden = !(canFull && document.body.classList.contains('touch'));
}
fullBtn.addEventListener('click', () => {
  const el = document.documentElement;
  const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
  try {
    const pr = on ? (document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen())
                  : (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen());
    if (pr && pr.catch) pr.catch(() => toast('이 브라우저에서는 전체화면을 쓸 수 없습니다'));
  } catch (e) { toast('이 브라우저에서는 전체화면을 쓸 수 없습니다'); }
});
document.addEventListener('fullscreenchange', syncFull);
document.addEventListener('webkitfullscreenchange', syncFull);

/* ---------- loop ---------- */
let lastT = performance.now();
let manualTestMode = false;
function frame(now){
  const elapsed = Math.max(0, (now - lastT) / 1000), rdt = Math.min(0.05, elapsed); lastT = now;
  if (!manualTestMode){ checkTerrain(); update(rdt, elapsed); render(); drawMinimap(now); updateHUD(); noteLatency(); }
  requestAnimationFrame(frame);
}
function start(data){
  S = normalizeSettings(data?.settings || savedSettings);
  setTouch(coarse.matches);
  window.addEventListener('touchstart', () => setTouch(true), { passive: true, once: true });
  resize(); buildPanel(); syncFull();
  if (window.ResizeObserver){
    new ResizeObserver(() => sizeDial()).observe(dialC);
    const ro = new ResizeObserver(() => { measureHud(); sizeMinimap(); });
    ro.observe($('#console')); ro.observe($('#hud-top')); ro.observe(mm);
  }
  // idle scene behind the start menu
  currentMap = MAP_BY_ID[mapChoice] || MAPS[0];
  $('#map-choice').value = mapChoice;
  const sx = pickSpawns(); genTerrain(sx); genScenery();
  tanks = [makeTank(0, sx[0], randomMobile()), makeTank(1, sx[1], randomMobile())]; tanks.forEach(t => t.y = groundY(t.x, 0));
  setBadges();
  wind = 40; camSnap = true;
  renderCards();
  renderLobby(); syncAudioButtons();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { dialKey = ''; renderLobby(); });
  requestAnimationFrame(frame);
}
// Test hook: open the page with ?test to expose internals to the scripts in tests/.
if (/[?&]test\b/.test(location.search)) window.__tc = { update, startGame, planShot, fire, moveTank, endTurn, isHuman, carve, passTurn, setTouch,
  syncView: () => { checkTerrain(); render(); drawMinimap(performance.now()); updateHUD(); noteLatency(); },
  setManualTestMode: v => { manualTestMode = !!v; lastT = performance.now(); }, defaults: () => ({ ...DEFAULTS }),
  toScreen, paintTerrain, aiLog: () => aiLog, shellValue, searchShot, driveTo, drawMinimap, W, H, layers: { terr, back, minimap: mm }, MOBILES, openPick, renderCards,
  setHand: (t, ids) => { t.hand = ids.slice(); t.deck = []; }, setAutoAll: v => { autoAll = !!v; }, lat,
  setAmmo: (t, ids) => { t.ammo = { basic: Infinity }; for (const id of ids) t.ammo[id] = (t.ammo[id] || 0) + 1; },
  standAt, applyFx, toggleFxPop, armFx, FXD, explode, Snd, simulate, SHELL, setWind: v => { wind = v; }, MAPS, map: () => currentMap.id, setMapChoice: id => { if (id === 'random' || MAP_BY_ID[id]) mapChoice = id; },
  view: () => ({ x: cam.x, y: cam.y, z: cam.z, s: viewScale(), cw, ch, playTop, playBot, look: look && { ...look }, markers: markers.map(m => ({ x: m.x, y: m.y, i: m.t.i })) }),
  get: () => ({ phase, cur, mode, tanks, shells, parts, ops, stats, timers, wind, hitStop, turnCount, turnT }), S: () => S };
start({});
})();
