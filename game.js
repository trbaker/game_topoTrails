/* Topo Trails — game */
"use strict";
/* ============================================================
   MATH TRAILS v2 — powered by the Matter.js physics engine.
   Rigid-body chassis, spring suspension, torque-driven rear
   wheel, jumping, race timer, finish line + Top-10 riders.
   ============================================================ */
if(window.__WRONG_HOST){
  throw new Error('Topo Trails only runs at https://trbaker.github.io');
}
if(typeof Matter === 'undefined'){
  document.getElementById('startOverlay').innerHTML =
    '<div class="card"><h1>⚠️ Can\'t start</h1><div class="sub">The game engine script could not load from <b>cdnjs.cloudflare.com</b>.<br><br>' +
    'Check your internet connection (or a firewall / content filter blocking that site), then reload this page.</div></div>';
  throw new Error('Matter.js failed to load from CDN');
}
const { Engine, World, Bodies, Body, Composite, Constraint } = Matter;

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const gameArea = document.getElementById('gameArea');
let topoMap = null, bikeMarker = null, routeLatLngAt = null;   // declared early: resize() runs before the map section
let W = 0, H = 0, DPR = 1;
function resize(){
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = gameArea.clientWidth; H = gameArea.clientHeight;
  cv.width = W * DPR; cv.height = H * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if(topoMap) setTimeout(()=> topoMap.invalidateSize(), 50);
}
window.addEventListener('resize', resize); resize();

/* ---------------- ArcGIS Online topographic map (top half) ----------------
   Uses Esri's ArcGIS Online "World Topographic Map" tile service via Leaflet.
   The race route is anchored on real trail country near Moab, Utah — change
   ROUTE_START / ROUTE_BEND to relocate the course anywhere on Earth. */
function initMap(){
  const mapDiv = document.getElementById('map');
  if(typeof L === 'undefined'){
    mapDiv.innerHTML += '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:700;color:#28325c;text-align:center;padding:20px;">🗺️ Map couldn\'t load (no internet connection?)<br>The race still works below!</div>';
    return;
  }

  topoMap = L.map('map', {
    zoomControl: true, keyboard: false,       // keyboard off so arrow keys drive the bike, not the map
    scrollWheelZoom: false, dragging: true, attributionControl: true
  });

  // IMPORTANT: give the map its view FIRST — adding vector layers to a view-less
  // map and reordering them is what crashed Safari ("t.parentNode" in Leaflet).
  const routeBounds = L.latLngBounds(routeLatLngAt(0), routeLatLngAt(COURSE_M));
  topoMap.fitBounds(routeBounds, { padding: [36, 36] });   // frames the 1.875 km course (≈ 1:12,000)

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri — ArcGIS Online World Topographic Map'
  }).on('tileerror', function(){
    if(mapDiv.dataset.tileWarned) return;
    mapDiv.dataset.tileWarned = '1';
    const n = document.createElement('div');
    n.style.cssText = 'position:absolute;top:8px;right:8px;z-index:1200;background:#fff3d6;border:3px solid #28325c;border-radius:12px;padding:6px 12px;font:700 12px sans-serif;color:#28325c;max-width:240px;';
    n.textContent = '🗺️ Map tiles couldn\'t load — this viewer may block Esri\'s tile server. Open the file in your regular browser with internet.';
    mapDiv.appendChild(n);
  }).addTo(topoMap);
  L.control.scale({ imperial: true, metric: true }).addTo(topoMap);

  routeLayer = L.layerGroup().addTo(topoMap);
  rebuildRouteLayers();
  initDrawTool();
  initSearchTool();
}

/* collapsible place search: expands from a 🔍 button, pans the map to the result */
function initSearchTool(){
  const box = document.getElementById('searchBox');
  const btn = document.getElementById('searchToggle');
  const input = document.getElementById('searchInput');
  box.classList.remove('hidden');
  btn.addEventListener('click', () => {
    box.classList.toggle('open');
    if(box.classList.contains('open')) setTimeout(() => input.focus(), 80);
    else input.value = '';
  });
  input.addEventListener('keydown', async e => {
    if(e.key === 'Escape'){ box.classList.remove('open'); input.value = ''; input.blur(); return; }
    if(e.key !== 'Enter') return;
    e.preventDefault();
    const q = input.value.trim();
    if(!q) return;
    input.disabled = true;
    try{
      const res = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q));
      const results = await res.json();
      if(!results.length){
        toast('🔍 No place found — try another name');
      } else {
        const r = results[0];
        topoMap.setView([+r.lat, +r.lon], 14);
        toast('📍 ' + r.display_name.split(',')[0] + ' — draw a route here!');
        box.classList.remove('open');
        input.value = '';
        input.blur();
      }
    }catch(err){
      toast('🔍 Search unavailable right now');
    }
    input.disabled = false;
  });
}

let routeLayer = null;
function rebuildRouteLayers(){
  if(!routeLayer) return;
  routeLayer.clearLayers();
  // the race route line: white casing first, orange line on top (paint order = add order)
  L.polyline([routeLatLngAt(0), routeLatLngAt(COURSE_M)], { color: '#ffffff', weight: 9, opacity: 0.55 }).addTo(routeLayer);
  L.polyline([routeLatLngAt(0), routeLatLngAt(COURSE_M)], { color: '#ff7a1a', weight: 5, opacity: 0.9 }).addTo(routeLayer);
  const emoji = (m, e, title) => L.marker(routeLatLngAt(m), {
    icon: L.divIcon({ html: e, className: 'emoji-marker', iconSize: [22, 22], iconAnchor: [11, 11] }),
    title, interactive: false
  }).addTo(routeLayer);
  emoji(0, '🚩', 'Start');
  for(const cp of CHECKPOINTS) emoji(cp.x / PX_PER_M, '🚩', 'Checkpoint');
  for(const r of RAMPS) emoji(r.xB / PX_PER_M, '🛹', 'Super-jump ramp');
  for(const c of COWS) emoji(c.x / PX_PER_M, '🐄', 'Cow!');
  emoji(COURSE_M, '🏁', 'Finish');
  bikeMarker = L.marker(routeLatLngAt(0), {
    icon: L.divIcon({ html: '🔴', className: 'bike-marker', iconSize: [24, 24], iconAnchor: [12, 14] }),
    interactive: false, zIndexOffset: 1000
  }).addTo(routeLayer);
}

/* ---------------- DRAW YOUR OWN ROUTE (the heart of the lesson) ----------------
   Students tap two points on the topo map; the game measures their straight
   line, reads its real elevations, and rebuilds the whole track from it. */
let drawMode = false, drawFirstPt = null, drawPreview = null, drawStartMarker = null;
function initDrawTool(){
  const btn = document.getElementById('drawBtn');
  btn.classList.remove('hidden');
  btn.addEventListener('click', () => drawMode ? exitDrawMode() : enterDrawMode());
  topoMap.on('click', e => { if(drawMode) handleDrawClick(e.latlng); });
  topoMap.on('mousemove', e => {
    if(drawMode && drawFirstPt){
      if(drawPreview) drawPreview.setLatLngs([drawFirstPt, e.latlng]);
      else drawPreview = L.polyline([drawFirstPt, e.latlng], { color: '#28325c', weight: 3, dashArray: '8 8', opacity: 0.85 }).addTo(topoMap);
    }
  });
}
function enterDrawMode(){
  drawMode = true; drawFirstPt = null;
  document.getElementById('drawBtn').textContent = '✕ CANCEL DRAWING';
  document.getElementById('drawHint').classList.remove('hidden');
  document.getElementById('drawHint').textContent = '✏️ Tap a START point on the map';
  topoMap.getContainer().style.cursor = 'crosshair';
  topoMap.dragging.disable();
}
function exitDrawMode(){
  drawMode = false; drawFirstPt = null;
  if(drawPreview){ topoMap.removeLayer(drawPreview); drawPreview = null; }
  if(drawStartMarker){ topoMap.removeLayer(drawStartMarker); drawStartMarker = null; }
  document.getElementById('drawBtn').textContent = '✏️ DRAW YOUR OWN ROUTE';
  document.getElementById('drawHint').classList.add('hidden');
  topoMap.getContainer().style.cursor = '';
  topoMap.dragging.enable();
}
function handleDrawClick(latlng){
  if(!drawFirstPt){
    drawFirstPt = { lat: latlng.lat, lng: latlng.lng };
    drawStartMarker = L.circleMarker(drawFirstPt, { radius: 7, color: '#28325c', weight: 3, fillColor: '#3fbf6b', fillOpacity: 1 }).addTo(topoMap);
    document.getElementById('drawHint').textContent = '✏️ Now tap a FINISH point — cross some contour lines for big hills!';
    return;
  }
  const a = drawFirstPt, b = { lat: latlng.lat, lng: latlng.lng };
  const lenM = haversineM(a, b);
  if(lenM < 150){ toast('✏️ Too short! Tap a finish point farther away.'); return; }
  if(lenM > 15000){ toast('✏️ Whoa, that\'s over 9 miles! Try a shorter line.'); return; }
  exitDrawMode();
  applyStudentRoute(a, b, lenM);
}
function applyStudentRoute(a, b, lenM){
  const prev = { a: ROUTE_START, b: ROUTE_END, len: COURSE_M, profile: elevProfile };
  ROUTE_START = a; ROUTE_END = b;
  setCourseLength(lenM);
  // stop any race in progress; back to the start screen while we read the terrain
  ['crashOverlay','finishOverlay'].forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById('startOverlay').classList.remove('hidden');
  document.getElementById('subLine').textContent = 'Your route: ' + COURSE_FT.toLocaleString() + ' ft of real terrain! ⛰️🏁';
  state.mode = 'start';
  resetRunState();
  if(topoMap){
    topoMap.fitBounds(L.latLngBounds(routeLatLngAt(0), routeLatLngAt(COURSE_M)), { padding: [36, 36] });
    rebuildRouteLayers();
  }
  const sb = document.getElementById('startBtn');
  sb.disabled = true;
  sb.textContent = '⏳ READING YOUR ROUTE\u2019S ELEVATION…';
  loadElevationProfile().then(() => {
    toast('⛰️ Your route is ready — ' + COURSE_FT.toLocaleString() + ' ft!');
  }).catch(err => {
    console.warn('student route elevation failed', err);
    // roll back to the previous route so the game stays playable
    ROUTE_START = prev.a; ROUTE_END = prev.b;
    setCourseLength(prev.len);
    elevProfile = prev.profile;
    computeRamps(); resetWorld(); resetRunState();
    if(topoMap){
      topoMap.fitBounds(L.latLngBounds(routeLatLngAt(0), routeLatLngAt(COURSE_M)), { padding: [36, 36] });
      rebuildRouteLayers();
    }
    toast('🗺️ Couldn\'t read elevations there — try a different line!');
  }).finally(() => {
    sb.disabled = false;
    sb.textContent = 'START RACE!';
  });
}

/* ---------------- Audio ---------------- */
let AC = null, muted = false;
function audio(){ if(!AC) AC = new (window.AudioContext||window.webkitAudioContext)(); return AC; }
function beep(freq, dur, type='sine', vol=0.15, when=0){
  if(muted) return;
  try{
    const ac = audio(), o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, ac.currentTime + when);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + when + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(ac.currentTime + when); o.stop(ac.currentTime + when + dur + .02);
  }catch(e){}
}
const sfx = {
  coin(){ beep(1150,.12,'triangle',.12); beep(1500,.15,'triangle',.10,.06); },
  correct(){ beep(660,.12,'triangle',.16); beep(880,.14,'triangle',.16,.11); beep(1320,.22,'triangle',.16,.22); },
  wrong(){ beep(180,.25,'sawtooth',.10); },
  crash(){ beep(120,.3,'square',.12); },
  jump(){ beep(500,.09,'square',.08); beep(760,.12,'square',.08,.06); },
  moo(){ beep(220,.22,'sawtooth',.12); beep(165,.35,'sawtooth',.12,.16); },
  turbo(){ beep(440,.08,'square',.08); beep(560,.08,'square',.08,.07); beep(700,.1,'square',.08,.14); },
  count(n){ beep(n===0?880:440,.18,'triangle',.16); },
  finish(){ [523,659,784,1047].forEach((f,i)=>beep(f,.22,'triangle',.16,i*.13)); }
};
document.getElementById('muteBtn').addEventListener('click', e=>{
  muted = !muted; e.target.textContent = muted ? '🔇' : '🔊';
});

/* ---------------- Course / terrain: REAL elevation profile ----------------
   The hills the bike rides are the elevation profile of the orange route
   line on the topo map, sampled from the Copernicus DEM (via the free
   Open-Meteo elevation API). If the fetch fails, procedural practice
   hills are used so the game always works. */
const BASE_Y = 430;
const FINISH_X = 22500;                    // fixed px length of the ride; real length varies per route
const M2FT = 3.28084;                      // US topo maps label elevation in feet
let COURSE_M = 1875;                       // real metres of the current route
let PX_PER_M = FINISH_X / COURSE_M;
let COURSE_FT = Math.round(COURSE_M * M2FT);

// the route across the topo map (also drives the map line + markers).
// Students can redraw it — see the DRAW YOUR OWN ROUTE tool.
let ROUTE_START = { lat: 38.5725, lng: -109.5450 };         // Moab, UT — Sand Flats slickrock country
let ROUTE_END = (() => {
  const mPerDegLng = 111320 * Math.cos(ROUTE_START.lat * Math.PI/180);
  return { lat: ROUTE_START.lat + (COURSE_M * 0.28) / 110574,
           lng: ROUTE_START.lng + (COURSE_M * 0.96) / mPerDegLng };
})();
function haversineM(a, b){
  const R = 6371000, d = Math.PI / 180;
  const dLat = (b.lat - a.lat) * d, dLng = (b.lng - a.lng) * d;
  const h = Math.sin(dLat/2)**2 + Math.cos(a.lat*d) * Math.cos(b.lat*d) * Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function setCourseLength(lenM){
  COURSE_M = lenM;
  PX_PER_M = FINISH_X / COURSE_M;
  COURSE_FT = Math.round(COURSE_M * M2FT);
}
routeLatLngAt = m => {
  const t = Math.max(0, Math.min(1, m / COURSE_M));
  return [ ROUTE_START.lat + (ROUTE_END.lat - ROUTE_START.lat) * t,
           ROUTE_START.lng + (ROUTE_END.lng - ROUTE_START.lng) * t ];
};

let elevProfile = null;                    // {s:[m...], n, minE, maxE, pxPerM} once real data loads

function proceduralY(x){                   // fallback practice hills
  if(x < 0) x = 0;
  const rampIn  = Math.min(1, x / 900);
  const rampOut = 1 - Math.min(1, Math.max(0, (x - FINISH_X) / 500));
  const amp = (26 + Math.min(70, x * 0.006)) * rampIn * rampOut;
  return BASE_Y
    + Math.sin(x * 0.0031) * amp
    + Math.sin(x * 0.0013 + 4.2) * amp * 0.9
    + Math.sin(x * 0.011 + 1.3) * amp * 0.22
    + Math.sin(x * 0.027) * 4 * rampIn * rampOut;
}
function profileY(x){                      // real DEM profile, smoothly interpolated
  const P = elevProfile;
  const t = Math.max(0, Math.min(1, x / FINISH_X));
  const f = t * (P.n - 1), i = Math.floor(f), u = f - i;
  const a = P.s[i], b = P.s[Math.min(P.n - 1, i + 1)];
  let e = a + (b - a) * (1 - Math.cos(u * Math.PI)) / 2;    // cosine-smoothed between samples
  if(x < 500) e = P.s[0] + (e - P.s[0]) * (Math.max(0, x) / 500);   // gentle launch pad
  if(x > FINISH_X) e = P.s[P.n - 1];                                 // flat run-out
  return BASE_Y - (e - P.minE) * P.pxPerM;
}
function groundY(x){ return elevProfile ? profileY(x) : proceduralY(x); }

async function fetchElevations(lats, lngs){
  // primary: Open-Meteo (Copernicus DEM) — one batched GET
  try{
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch('https://api.open-meteo.com/v1/elevation?latitude=' + lats.join(',') + '&longitude=' + lngs.join(','), { signal: ctrl.signal });
    clearTimeout(timer);
    const data = await res.json();
    const s = (data.elevation || []).map(Number);
    if(s.length === lats.length && s.every(isFinite)) return s;
    throw new Error('bad data');
  }catch(e){
    // backup: Open-Elevation (SRTM) — batched POST
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    const res = await fetch('https://api.open-elevation.com/api/v1/lookup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations: lats.map((la, i) => ({ latitude: +la, longitude: +lngs[i] })) }),
      signal: ctrl.signal
    });
    clearTimeout(timer);
    const data = await res.json();
    const s = (data.results || []).map(r => Number(r.elevation));
    if(s.length === lats.length && s.every(isFinite)) return s;
    throw new Error('bad data from backup');
  }
}
async function loadElevationProfile(){
  const N = 100;                           // a sample every ~62 ft along the route
  const lats = [], lngs = [];
  for(let i = 0; i < N; i++){
    const [la, ln] = routeLatLngAt(COURSE_M * i / (N - 1));
    lats.push(la.toFixed(5)); lngs.push(ln.toFixed(5));
  }
  let s = await fetchElevations(lats, lngs);
  s = s.map((v, i) => (s[Math.max(0, i-1)] + v * 2 + s[Math.min(N-1, i+1)]) / 4);   // one light smoothing pass
  const minE = Math.min(...s), maxE = Math.max(...s);
  const range = Math.max(4, maxE - minE);
  // vertical exaggeration auto-chosen so the real hills read clearly but stay rideable (~190 px of relief)
  const pxPerM = Math.max(0.5, Math.min(8, 190 / range));
  elevProfile = { s, n: N, minE, maxE, pxPerM };
  computeRamps();                          // wooden ramps re-seat onto the real ground
  resetWorld();                            // physics terrain rebuilt from the real profile
  document.getElementById('profileBadge').textContent =
    '📈 REAL ELEVATION PROFILE — ' + COURSE_FT.toLocaleString() + ' ft course • ' + Math.round(minE * M2FT).toLocaleString() + '–' + Math.round(maxE * M2FT).toLocaleString() + ' ft elevation';
}
function groundSlope(x){ return (groundY(x+6) - groundY(x-6)) / 12; }
function normAngle(a){ return ((a + Math.PI) % (2*Math.PI) + 2*Math.PI) % (2*Math.PI) - Math.PI; }

/* ---------------- Wooden super-jump ramps ----------------
   Each ramp: takeoff incline (xA→xB), a gap to fly over, and an
   angled wooden landing platform (xC→xD) that slopes back to dirt. */
const RAMP_LEN = 260, RAMP_H = 100, RAMP_GAP = 160, LAND_LEN = 320;
const RAMPS = [];
function computeRamps(){
  RAMPS.length = 0;
  for(const x0 of [5300, 12300]){
    const xA = x0, xB = x0 + RAMP_LEN, yA = groundY(xA), yB = yA - RAMP_H;
    const xC = xB + RAMP_GAP, xD = xC + LAND_LEN;
    const yC = yB + 30, yD = groundY(xD);          // landing deck starts 30px below the lip, angles down to dirt
    RAMPS.push({ xA, xB, yA, yB, xC, xD, yC, yD, cool: 0 });
  }
}
computeRamps();
function rampSurface(x){
  for(const r of RAMPS){
    if(x >= r.xA && x <= r.xB) return r.yA + (r.yB - r.yA) * (x - r.xA) / (r.xB - r.xA);
    if(x >= r.xC && x <= r.xD) return r.yC + (r.yD - r.yC) * (x - r.xC) / (r.xD - r.xC);
  }
  return Infinity;
}
function surfaceY(x){ return Math.min(groundY(x), rampSurface(x)); }   // smaller y = higher = what wheels ride on
function surfaceSlope(x){ return (surfaceY(x+6) - surfaceY(x-6)) / 12; }

/* ---------------- Cows on the trail! Jump them or crash ---------------- */
const COW_W = 34, COW_H = 58;              // hitbox: half-width and height above the grass
const COWS = [3300, 9800, 16200].map(x => ({ x, cleared: false }));

/* ---------------- Physics world (Matter.js) ---------------- */
const engine = Engine.create();
engine.gravity.y = 1.15;
const world = engine.world;
const bikeGroup = Body.nextGroup(true);
const WHEEL_R = 20, CHASSIS_W = 82, CHASSIS_H = 14;

let terrainBodies = [], chassis = null, rearWheel = null, frontWheel = null;

function buildTerrain(){
  const SEG = 50;
  for(let x = -300; x < FINISH_X + 1600; x += SEG){
    const y1 = groundY(x), y2 = groundY(x + SEG);
    const mx = x + SEG/2, my = (y1 + y2)/2;
    const len = Math.hypot(SEG, y2 - y1) + 4;
    const ang = Math.atan2(y2 - y1, SEG);
    const seg = Bodies.rectangle(mx, my + 14, len, 30, {
      isStatic: true, angle: ang, friction: 1.0, restitution: 0,
      collisionFilter: { group: 0 }
    });
    terrainBodies.push(seg);
  }
  // wooden ramp decks (takeoff + landing) as static slabs along each surface line
  const deck = (xs, ys, xe, ye) => {
    const SEG2 = 40;
    const n = Math.ceil((xe - xs) / SEG2);
    for(let i = 0; i < n; i++){
      const ax = xs + i * (xe - xs) / n, bx = xs + (i + 1) * (xe - xs) / n;
      const ay = ys + (ye - ys) * (ax - xs) / (xe - xs), by = ys + (ye - ys) * (bx - xs) / (xe - xs);
      const len = Math.hypot(bx - ax, by - ay) + 4;
      terrainBodies.push(Bodies.rectangle((ax + bx)/2, (ay + by)/2 + 10, len, 20, {
        isStatic: true, angle: Math.atan2(by - ay, bx - ax), friction: 1.0, restitution: 0
      }));
    }
  };
  for(const r of RAMPS){
    deck(r.xA, r.yA, r.xB, r.yB);   // takeoff incline
    deck(r.xC, r.yC, r.xD, r.yD);   // angled landing platform
  }
  World.add(world, terrainBodies);
}

function buildBike(x){
  const gy = groundY(x) - WHEEL_R - 26;
  chassis = Bodies.rectangle(x, gy, CHASSIS_W, CHASSIS_H, {
    density: 0.004, friction: 0.4, restitution: 0.05,
    collisionFilter: { group: bikeGroup }
  });
  rearWheel = Bodies.circle(x - CHASSIS_W/2 + 10, gy + 24, WHEEL_R, {
    density: 0.0028, friction: 1.15, restitution: 0.08,
    collisionFilter: { group: bikeGroup }
  });
  frontWheel = Bodies.circle(x + CHASSIS_W/2 - 10, gy + 24, WHEEL_R, {
    density: 0.0028, friction: 1.05, restitution: 0.08,
    collisionFilter: { group: bikeGroup }
  });
  // spring suspension: two constraints per wheel (triangulated so wheels can't swing)
  const susp = (wheel, ax) => [
    Constraint.create({ bodyA: chassis, pointA: {x:ax, y:4},      bodyB: wheel, stiffness: 0.32, damping: 0.22, length: 24 }),
    Constraint.create({ bodyA: chassis, pointA: {x:ax + (ax<0?26:-26), y:4}, bodyB: wheel, stiffness: 0.32, damping: 0.22, length: 34 })
  ];
  World.add(world, [chassis, rearWheel, frontWheel,
    ...susp(rearWheel, -CHASSIS_W/2 + 10), ...susp(frontWheel, CHASSIS_W/2 - 10)]);
}

function resetWorld(){
  World.clear(world, false);
  terrainBodies = [];
  buildTerrain();
  buildBike(140);
}
resetWorld();

function wheelOnGround(w){ return w.position.y > surfaceY(w.position.x) - WHEEL_R - 5; }
function onGround(){ return wheelOnGround(rearWheel) || wheelOnGround(frontWheel); }

/* ---------------- Game state ---------------- */
const state = {
  mode: 'start',          // start | countdown | play | question | crash | finish
  gas:false, brake:false,
  turbo: 0,
  raceMs: 0, dist: 0,
  starCount: 0,
  lastSafeX: 140,
  jumpCooldown: 0,
  superJumps: 2,          // 2 super jumps per race
  flip: null,             // active 360-roll state {accum}
  head: null,             // popped-off head during crash animation
  tricks: 0,
  countdown: 0,
  time: 0,
  particles: [], shake: 0,
  playerName: 'Rider'
};
const TURBO_FRAMES = 60 * 5;

/* ---------------- Checkpoint flags (respawn points after a crash) ---------------- */
const CHECKPOINTS = [4500, 9000, 13500, 18000].map(x => ({ x, reached: false }));

const stars = new Map();
const STAR_SPACING = 240;
function starPos(i){
  const x = 420 + i * STAR_SPACING;
  if(x > FINISH_X - 100) return null;
  for(const r of RAMPS){ if(x > r.xA - 60 && x < r.xD + 60) return null; }
  for(const c of COWS){ if(Math.abs(x - c.x) < 90) return null; }
  return {x, y: groundY(x) - 74 - (i % 3) * 14};
}



/* ---------------- Toast ---------------- */
const toastEl = document.getElementById('toast');
let toastTimer = null;
function toast(msg){
  toastEl.textContent = msg; toastEl.style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> toastEl.style.opacity = 0, 1800);
}

/* ---------------- Input ---------------- */
function setGas(v){ state.gas = v; }
function setBrake(v){ state.brake = v; }
function doJump(superJump){
  if(state.mode !== 'play' || state.jumpCooldown > 0 || !onGround()) return;
  if(superJump && state.superJumps <= 0){
    toastQuick('🚀 No super jumps left — normal jump!');
    superJump = false;
  }
  // super jump (space bar): sqrt(2) x launch velocity = 2x jump height
  const S = superJump ? Math.SQRT2 : 1;
  if(superJump) state.superJumps--;
  state.jumpCooldown = superJump ? 65 : 45;
  const boost = (1 + Math.min(0.5, Math.abs(chassis.velocity.x) * 0.04)) * S;  // faster = bigger jump off hills
  // launch velocities scaled by sqrt(0.67) ≈ 0.82 → 33% lower jump height (height ∝ v²)
  Body.setVelocity(chassis, {x: chassis.velocity.x + 1.2, y: chassis.velocity.y - 6.95 * boost});
  Body.setVelocity(rearWheel, {x: rearWheel.velocity.x, y: rearWheel.velocity.y - 6.15 * boost});
  Body.setVelocity(frontWheel, {x: frontWheel.velocity.x, y: frontWheel.velocity.y - 6.15 * boost});
  if(superJump){ sfx.turbo(); toastQuick(state.superJumps > 0 ? `🚀 SUPER JUMP! (${state.superJumps} left)` : '🚀 SUPER JUMP! (last one!)'); }
  else sfx.jump();
  const nDust = superJump ? 14 : 6;
  for(let p=0;p<nDust;p++) state.particles.push({x:chassis.position.x, y:surfaceY(chassis.position.x), vx:(Math.random()-.5)*(superJump?5:3), vy:-Math.random()*(superJump?4:2), life:22, kind:'dust'});
}
function doFlip(){
  if(state.mode !== 'play' || state.flip) return;
  if(onGround()){ toastQuick('🌀 Jump first, then press Return!'); return; }
  state.flip = { accum: 0 };
  sfx.jump();
}
function toastQuick(msg){ toast(msg); clearTimeout(toastTimer); toastTimer = setTimeout(()=> toastEl.style.opacity = 0, 900); }
const keyDown = {
  'ArrowRight':()=>setGas(true), 'ArrowUp':()=>setGas(true), 'w':()=>setGas(true), 'W':()=>setGas(true), 'd':()=>setGas(true), 'D':()=>setGas(true),
  'ArrowLeft':()=>setBrake(true), 'ArrowDown':()=>setBrake(true), 's':()=>setBrake(true), 'S':()=>setBrake(true), 'a':()=>setBrake(true), 'A':()=>setBrake(true),
  ' ':()=>doJump(true), 'j':()=>doJump(false), 'J':()=>doJump(false),
  'Enter':doFlip
};
const keyUp = {
  'ArrowRight':()=>setGas(false), 'ArrowUp':()=>setGas(false), 'w':()=>setGas(false), 'W':()=>setGas(false), 'd':()=>setGas(false), 'D':()=>setGas(false),
  'ArrowLeft':()=>setBrake(false), 'ArrowDown':()=>setBrake(false), 's':()=>setBrake(false), 'S':()=>setBrake(false), 'a':()=>setBrake(false), 'A':()=>setBrake(false)
};
function typingInField(e){ return e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA'); }
window.addEventListener('keydown', e=>{ if(typingInField(e)) return; const f = keyDown[e.key]; if(f){ if(!e.repeat) f(); else if(![' ','j','enter'].includes(e.key.toLowerCase())) f(); e.preventDefault(); } });
window.addEventListener('keyup',   e=>{ if(typingInField(e)) return; const f = keyUp[e.key]; if(f){ f(); e.preventDefault(); } });
function bindHold(id, on, off){
  const el = document.getElementById(id);
  el.addEventListener('pointerdown', e=>{ e.preventDefault(); on(); });
  ['pointerup','pointerleave','pointercancel'].forEach(ev=> el.addEventListener(ev, e=>{ e.preventDefault(); if(off) off(); }));
}
bindHold('gasBtn', ()=>setGas(true), ()=>setGas(false));
bindHold('brakeBtn', ()=>setBrake(true), ()=>setBrake(false));
bindHold('jumpBtn', ()=>doJump(false), null);

/* ---------------- Per-frame physics control ---------------- */
function control(){
  const powerBoost = 1.3;                 // strong fixed engine (upgrades retired with the math gates)
  const turboMult = state.turbo > 0 ? 1.5 : 1;
  const maxSpin = 0.62 * powerBoost * turboMult;         // rear wheel rad/frame
  const maxVx   = 11.5 * powerBoost * turboMult;

  if(state.gas){
    if(rearWheel.angularVelocity < maxSpin)
      Body.setAngularVelocity(rearWheel, Math.min(rearWheel.angularVelocity + 0.045 * powerBoost * turboMult, maxSpin));
    if(onGround() && chassis.velocity.x < maxVx)
      Body.applyForce(chassis, chassis.position, {x: 0.0016 * powerBoost * turboMult, y: 0});
  }
  if(state.brake){
    Body.setAngularVelocity(rearWheel, rearWheel.angularVelocity * 0.85);
    Body.setAngularVelocity(frontWheel, frontWheel.angularVelocity * 0.85);
    if(onGround()) Body.setVelocity(chassis, {x: chassis.velocity.x * 0.96, y: chassis.velocity.y});
  }
  // speed cap
  if(chassis.velocity.x > maxVx) Body.setVelocity(chassis, {x: maxVx, y: chassis.velocity.y});

  // wooden ramp lip: automatic SUPER JUMP launch (free — doesn't use your 2 charges)
  for(const r of RAMPS){
    if(r.cool > 0){ r.cool--; continue; }
    const cxp = chassis.position.x;
    if(cxp > r.xB - 15 && cxp < r.xB + 55 && chassis.velocity.x > 2.5 && chassis.position.y < r.yB + 70){
      r.cool = 90;
      const k = Math.max(0.55, Math.min(1.3, chassis.velocity.x / 9));
      Body.setVelocity(chassis, {x: chassis.velocity.x, y: chassis.velocity.y - 5.5 * k});
      Body.setVelocity(rearWheel, {x: rearWheel.velocity.x, y: rearWheel.velocity.y - 5.0 * k});
      Body.setVelocity(frontWheel, {x: frontWheel.velocity.x, y: frontWheel.velocity.y - 5.0 * k});
      sfx.turbo();
      toastQuick('🛹 RAMP LAUNCH — SUPER JUMP!');
      for(let p=0;p<12;p++) state.particles.push({x:r.xB, y:r.yB, vx:(Math.random()-.5)*5, vy:-Math.random()*3, life:22, kind:'dust'});
    }
  }

  // 360 ROLL (Return key): controlled backflip while airborne
  const airborne = !wheelOnGround(rearWheel) && !wheelOnGround(frontWheel);
  if(state.flip){
    if(airborne && state.flip.accum < Math.PI * 2){
      const SPIN = 0.155;                          // rad/frame → full roll in ~40 frames
      Body.setAngularVelocity(chassis, -SPIN);
      state.flip.accum += SPIN;
      if(state.flip.accum >= Math.PI * 2){
        // roll complete!
        state.flip = null;
        state.tricks++;
        state.turbo = Math.min(TURBO_FRAMES, state.turbo + 60 * 2);   // +2s turbo bonus
        Body.setAngularVelocity(chassis, 0);
        sfx.correct();
        toastQuick('🌀 360 ROLL! +2s TURBO!');
        for(let p=0;p<10;p++) state.particles.push({x:chassis.position.x, y:chassis.position.y, vx:(Math.random()-.5)*5, vy:(Math.random()-.5)*5, life:22, kind:'spark'});
      }
    } else if(!airborne){
      // touched down mid-roll — no reward, auto-level takes over
      const tried = state.flip.accum > 0.6;
      state.flip = null;
      if(tried) toastQuick('So close! Jump higher for a full roll!');
    }
  }
  // gentle auto-level toward upcoming slope while airborne (kid-friendly) — paused during a roll
  else if(airborne){
    const target = Math.atan(surfaceSlope(chassis.position.x + 60));
    const err = normAngle(target - normAngle(chassis.angle));
    chassis.torque = err * 0.55 - chassis.angularVelocity * 0.28;
  }

  if(state.jumpCooldown > 0) state.jumpCooldown--;

  if(state.turbo > 0){
    state.turbo--;
    if(state.time % 2 === 0){
      const a = normAngle(chassis.angle);
      state.particles.push({
        x: chassis.position.x - Math.cos(a)*46, y: chassis.position.y - Math.sin(a)*46 + 8,
        vx: -Math.cos(a)*3 - Math.random()*2, vy: (Math.random()-.5)*2, life: 18, kind:'flame'
      });
    }
  }
}

function gameChecks(){
  const cx = chassis.position.x, cy = chassis.position.y;
  state.dist = Math.max(0, Math.min(Math.floor(cx / PX_PER_M), FINISH_X / PX_PER_M));

  // crash: flipped with head near dirt (a deliberate 360 roll in progress doesn't count)
  const a = normAngle(chassis.angle);
  const hx = cx + Math.sin(a) * 48, hy = cy - Math.cos(a) * 48;
  if(!state.flip && Math.abs(a) > 2.0 && hy > surfaceY(hx) - 6) return crash();

  // fell off the start
  if(cx < 40){ Body.setPosition(chassis, {x: 60, y: chassis.position.y}); Body.setVelocity(chassis, {x:0, y:chassis.velocity.y}); }

  // checkpoint flags: save your spot for crash respawns
  for(const cp of CHECKPOINTS){
    if(!cp.reached && cx > cp.x){
      cp.reached = true;
      state.lastSafeX = cp.x + 40;
      sfx.coin();
      toastQuick('🚩 Checkpoint!');
    }
  }
  // stars
  const nearIdx = Math.floor((cx - 420) / STAR_SPACING);
  for(let k = nearIdx - 1; k <= nearIdx + 2; k++){
    if(k < 0 || stars.get(k)) continue;
    const s = starPos(k); if(!s) continue;
    if(Math.hypot(cx - s.x, cy - s.y) < 48){
      stars.set(k, true); state.starCount++;
      sfx.coin();
      for(let p=0;p<8;p++) state.particles.push({x:s.x, y:s.y, vx:(Math.random()-.5)*4, vy:(Math.random()-.5)*4-1, life:24, kind:'spark'});
    }
  }
  // cows: jump them or crash!
  for(const cow of COWS){
    const cowTop = groundY(cow.x) - COW_H;
    // hit check on both wheels and the chassis belly
    const parts = [rearWheel.position, frontWheel.position, chassis.position];
    let hit = false;
    for(const p of parts){
      if(Math.abs(p.x - cow.x) < COW_W + 14 && p.y > cowTop - 6){ hit = true; break; }
    }
    if(hit){
      sfx.moo();
      toast('🐄 MOOOO!');
      return crash();
    }
    // cleanly sailed over → bonus star
    if(!cow.cleared && cx > cow.x + COW_W + 30){
      cow.cleared = true;
      state.starCount++;
      state.turbo = Math.min(TURBO_FRAMES, state.turbo + 60 * 1.5);   // +1.5s turbo for a clean cow jump
      sfx.coin();
      toastQuick('🐄 Cow jumped! +1 ⭐ +TURBO');
      for(let p=0;p<8;p++) state.particles.push({x:cow.x, y:cowTop, vx:(Math.random()-.5)*4, vy:-Math.random()*3, life:22, kind:'spark'});
    }
  }

  // finish!
  if(cx >= FINISH_X) finishRace();
}

function crash(){
  if(state.mode !== 'play') return;
  state.mode = 'crashAnim'; state.turbo = 0; state.shake = 14; state.flip = null;
  state.gas = false; state.brake = false;
  // pop the rider's head off! it bounces and rolls before the reset
  const a = normAngle(chassis.angle);
  const hx = chassis.position.x + Math.sin(a) * 48, hy = chassis.position.y - Math.cos(a) * 48;
  state.head = {
    x: hx, y: hy,
    vx: chassis.velocity.x * 0.55 + (Math.random() * 4 - 1),
    vy: -6.5 - Math.random() * 3,
    ang: 0, t: 0
  };
  sfx.crash();
}
function stepHead(){
  const h = state.head; if(!h) return;
  h.t++;
  h.vy += 0.42; h.x += h.vx; h.y += h.vy;
  const s = surfaceY(h.x) - 9;                    // head radius ~9
  if(h.y > s){
    h.y = s;
    if(Math.abs(h.vy) > 1.2){ h.vy *= -0.55; beep(240 + Math.random()*80, .06, 'square', .06); }
    else h.vy = 0;
    h.vx *= 0.94;
    if(Math.abs(h.vx) > 0.5 && h.t % 6 === 0)
      state.particles.push({x:h.x, y:h.y + 8, vx:(Math.random()-.5)*2, vy:-Math.random()*1.5, life:14, kind:'dust'});
  }
  h.ang += h.vx / 9;                              // rolling!
  if(h.t > 115){                                  // ~2 seconds of comedy, then the reset card
    state.mode = 'crash';
    document.getElementById('crashOverlay').classList.remove('hidden');
  }
}
document.getElementById('respawnBtn').addEventListener('click', ()=>{
  document.getElementById('crashOverlay').classList.add('hidden');
  state.head = null;
  respawn(Math.max(140, state.lastSafeX));
  state.mode = 'play';
});
function respawn(x){
  const gy = groundY(x) - WHEEL_R - 26;
  Body.setPosition(chassis, {x, y: gy});
  Body.setAngle(chassis, Math.atan(groundSlope(x)));
  Body.setVelocity(chassis, {x:0,y:0}); Body.setAngularVelocity(chassis, 0);
  Body.setPosition(rearWheel, {x: x - CHASSIS_W/2 + 10, y: gy + 24});
  Body.setPosition(frontWheel, {x: x + CHASSIS_W/2 - 10, y: gy + 24});
  [rearWheel, frontWheel].forEach(w=>{ Body.setVelocity(w,{x:0,y:0}); Body.setAngularVelocity(w,0); });
}

/* ---------------- Leaderboard (persistent Top 10) ---------------- */
const BOARD_KEY = 'mathtrails_top10';
let board = [];               // in-memory fallback always works
// Persistence adapter: claude.ai artifact storage → browser localStorage (local play) → memory only
const store = {
  async get(key){
    if(typeof window.storage !== 'undefined' && window.storage){
      try{ const r = await window.storage.get(key); if(r && r.value != null) return r.value; }catch(e){}
    }
    try{ return localStorage.getItem(key); }catch(e){}
    return null;
  },
  async set(key, val){
    if(typeof window.storage !== 'undefined' && window.storage){
      try{ await window.storage.set(key, val); return; }catch(e){}
    }
    try{ localStorage.setItem(key, val); }catch(e){}
  }
};
async function loadBoard(){
  try{
    const v = await store.get(BOARD_KEY);
    if(v) board = JSON.parse(v);
  }catch(e){ /* first run — keep in-memory list */ }
}
async function saveBoard(){
  try{ await store.set(BOARD_KEY, JSON.stringify(board)); }catch(e){}
}
loadBoard();

function fmtTime(ms){
  const m = Math.floor(ms/60000), s = Math.floor(ms%60000/1000), t = Math.floor(ms%1000/100);
  return `${m}:${String(s).padStart(2,'0')}.${t}`;
}

let pendingEntry = null;
function finishRace(){
  if(state.mode !== 'play') return;
  state.mode = 'finish';
  sfx.finish();
  state.shake = 8;
  pendingEntry = { name: '', ms: Math.round(state.raceMs), stars: state.starCount, tricks: state.tricks, id: Date.now() };

  document.getElementById('rTime').textContent = fmtTime(pendingEntry.ms);
  document.getElementById('rRolls').textContent = '🌀' + state.tricks;
  document.getElementById('rStars').textContent = '⭐' + state.starCount + (state.tricks ? ` 🌀${state.tricks}` : '');
  document.getElementById('finishTitle').textContent = '🏁 FINISH!';
  const wouldRank = board.filter(e => e.ms <= pendingEntry.ms).length;
  document.getElementById('rankMsg').textContent = wouldRank === 0
    ? '🥇 That time would be a NEW RECORD!'
    : (wouldRank < 10 ? `That time would place #${wouldRank + 1}!` : 'Great ride — save it and chase the Top 10!');

  const nameInput = document.getElementById('finishName');
  nameInput.value = state.playerName === 'Rider' ? '' : state.playerName;
  document.getElementById('savePanel').classList.remove('hidden');
  document.getElementById('boardPanel').classList.add('hidden');
  document.getElementById('finishOverlay').classList.remove('hidden');
  setTimeout(()=> nameInput.focus(), 300);
}

document.getElementById('saveBtn').addEventListener('click', ()=>{
  if(!pendingEntry) return;
  const nm = document.getElementById('finishName').value.trim();
  pendingEntry.name = nm ? nm.slice(0, 12) : 'Mystery Rider';
  state.playerName = pendingEntry.name;
  board.push(pendingEntry);
  board.sort((a,b)=> a.ms - b.ms);
  board = board.slice(0, 10);
  saveBoard();
  const rank = board.findIndex(e => e.id === pendingEntry.id);

  const msg = document.getElementById('rankMsg');
  const title = document.getElementById('finishTitle');
  if(rank === 0){ title.textContent = '🥇 NEW RECORD!'; msg.textContent = `${pendingEntry.name} is the fastest rider on the trail!`; sfx.correct(); }
  else if(rank > 0){ title.textContent = '🏁 FINISH!'; msg.textContent = `${pendingEntry.name} placed #${rank+1} on the Top 10 Riders list!`; sfx.coin(); }
  else { title.textContent = '🏁 FINISH!'; msg.textContent = 'Saved! Go a little faster to crack the Top 10.'; }

  renderBoard(pendingEntry.id);
  document.getElementById('savePanel').classList.add('hidden');
  document.getElementById('boardPanel').classList.remove('hidden');
  pendingEntry = null;
});

document.getElementById('finishName').addEventListener('keydown', e=>{
  if(e.key === 'Enter'){ e.preventDefault(); document.getElementById('saveBtn').click(); }
});

function renderBoard(highlightId){
  const tb = document.querySelector('#boardTable tbody');
  tb.innerHTML = '';
  const medals = ['🥇','🥈','🥉'];
  board.forEach((e,i)=>{
    const tr = document.createElement('tr');
    if(e.id === highlightId) tr.className = 'me';
    tr.innerHTML = `<td class="rank">${medals[i] || (i+1)}</td><td style="text-align:left">${escapeHtml(e.name)}</td><td style="text-align:center">⭐${e.stars != null ? e.stars : 0}</td><td class="t">${fmtTime(e.ms)}</td>`;
    tb.appendChild(tr);
  });
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

document.getElementById('againBtn').addEventListener('click', ()=>{
  document.getElementById('finishOverlay').classList.add('hidden');
  newRace();
});
function resetRunState(){
  stars.clear();
  state.turbo = 0; state.raceMs = 0; state.dist = 0;
  state.starCount = 0; state.lastSafeX = 140;
  state.gas = false; state.brake = false; state.jumpCooldown = 0;
  state.superJumps = 2; state.flip = null; state.tricks = 0; state.head = null;
  RAMPS.forEach(r => r.cool = 0);
  COWS.forEach(c => c.cleared = false);
  CHECKPOINTS.forEach(cp => cp.reached = false);
  state.particles = [];
  resetWorld();
}
function newRace(){
  resetRunState();
  startCountdown();
}
function startCountdown(){
  state.mode = 'countdown';
  state.countdown = 180;                   // 3..2..1 (60 frames each)
  sfx.count(1);
}

/* ---------------- Rendering ---------------- */
let camX = 0, camY = 0;
function draw(){
  ctx.clearRect(0, 0, W, H);
  const cx = chassis.position.x, cy = chassis.position.y;
  camX += (cx - W * 0.32 - camX) * 0.1;
  camY += (cy - H * 0.55 - camY) * 0.06;
  let sx = 0, sy = 0;
  if(state.shake > 0){ sx = (Math.random()-.5)*state.shake; sy = (Math.random()-.5)*state.shake; state.shake *= 0.85; }

  // sun + clouds + far hills (parallax)
  ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(W-90, 80, 44, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,210,63,.35)'; ctx.beginPath(); ctx.arc(W-90, 80, 60, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  for(let i=0;i<6;i++){
    const wx = ((i*420 - camX*0.25) % (W+500) + W+500) % (W+500) - 250;
    cloud(wx, 60 + (i%3)*55, 1 + (i%2)*0.4);
  }
  ctx.fillStyle = '#a8d68a';
  ctx.beginPath(); ctx.moveTo(0,H);
  for(let x=0;x<=W;x+=24){
    const wx = x + camX*0.4;
    ctx.lineTo(x, H*0.55 + Math.sin(wx*0.004)*40 + Math.sin(wx*0.0016)*60 - camY*0.2);
  }
  ctx.lineTo(W,H); ctx.fill();

  ctx.save();
  ctx.translate(-camX + sx, -camY + sy);

  // elevation profile gridlines (world y → elevation in meters, Moab-ish base)
  {
    const ELEV_BASE = 1400;                 // elevation (m) at world y = BASE_Y
    const M_PER_PX = 0.25;                  // vertical exaggeration typical of profile charts
    const yTop = camY - 20, yBot = camY + H + 20;
    ctx.setLineDash([6, 8]);
    ctx.strokeStyle = 'rgba(40,50,92,.18)'; ctx.lineWidth = 1.5;
    ctx.fillStyle = 'rgba(40,50,92,.45)';
    ctx.font = "700 12px 'Fredoka', sans-serif"; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    const step = 20;                        // gridline every 20 m of elevation
    const eMin = Math.floor((ELEV_BASE + (BASE_Y - yBot) * M_PER_PX) / step) * step;
    const eMax = Math.ceil((ELEV_BASE + (BASE_Y - yTop) * M_PER_PX) / step) * step;
    for(let e = eMin; e <= eMax; e += step){
      const y = BASE_Y - (e - ELEV_BASE) / M_PER_PX;
      ctx.beginPath(); ctx.moveTo(camX - 20, y); ctx.lineTo(camX + W + 20, y); ctx.stroke();
      ctx.fillText(e + ' m', camX + 8, y - 3);
    }
    ctx.setLineDash([]);
  }

  // terrain
  const x0 = camX - 40, x1 = camX + W + 40;
  ctx.beginPath(); ctx.moveTo(x0, camY + H + 60);
  for(let x=x0; x<=x1; x+=10) ctx.lineTo(x, groundY(x));
  ctx.lineTo(x1, camY + H + 60); ctx.closePath();
  ctx.fillStyle = '#a5713d'; ctx.fill();
  ctx.beginPath();
  for(let x=x0; x<=x1; x+=10){ const y = groundY(x); x===x0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y); }
  ctx.strokeStyle = '#5fb944'; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,.08)';
  for(let x=Math.floor(x0/60)*60; x<=x1; x+=60){
    ctx.beginPath(); ctx.arc(x+17, groundY(x)+34+(x%120?12:0), 4, 0, 7); ctx.fill();
  }

  // elevation-profile gridlines — real metres once DEM data is loaded
  const P = elevProfile;
  const baseE = P ? P.minE : 1400, ppmE = P ? P.pxPerM : 2;          // internal maths stay metric
  const elevFtOf = y => (baseE + (BASE_Y - y) / ppmE) * M2FT;        // labels in feet
  const eRangeFt = (P ? Math.max(4, P.maxE - P.minE) : 100) * M2FT;
  const gridStep = [20, 25, 40, 50, 100, 200, 500].find(s => eRangeFt / s <= 7) || 1000;
  const eLo = Math.floor(elevFtOf(camY + H) / gridStep) * gridStep, eHi = Math.ceil(elevFtOf(camY) / gridStep) * gridStep;
  ctx.save();
  ctx.setLineDash([6, 8]);
  ctx.strokeStyle = 'rgba(40,50,92,.14)'; ctx.lineWidth = 1.5;
  ctx.fillStyle = 'rgba(40,50,92,.4)';
  ctx.font = "600 12px 'Fredoka', sans-serif"; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  for(let e = eLo; e <= eHi; e += gridStep){
    const y = BASE_Y - (e / M2FT - baseE) * ppmE;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    ctx.fillText(e.toLocaleString() + ' ft', camX + 8, y - 3);
  }
  ctx.setLineDash([]);
  ctx.restore();

  // stars
  const nearIdx = Math.floor((camX - 420) / STAR_SPACING);
  for(let k=nearIdx-1; k<nearIdx + Math.ceil(W/STAR_SPACING) + 2; k++){
    if(k<0 || stars.get(k)) continue;
    const s = starPos(k); if(!s) continue;
    drawStar(s.x, s.y + Math.sin(state.time*0.08 + k)*4);
  }

  // wooden super-jump ramps + landing platforms
  for(const r of RAMPS) drawRamp(r);

  // cows + warning signs
  for(const cow of COWS){
    if(cow.x > camX - 350 && cow.x < camX + W + 250){
      drawCowSign(cow.x - 280);
      drawCow(cow.x, groundY(cow.x));
    }
  }

  // checkpoint flags
  for(const cp of CHECKPOINTS){
    if(cp.x > camX - 100 && cp.x < camX + W + 100) drawFlag(cp.x, cp.reached);
  }

  drawFinishLine();

  // particles
  for(let i=state.particles.length-1; i>=0; i--){
    const p = state.particles[i];
    p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.life--;
    if(p.life <= 0){ state.particles.splice(i,1); continue; }
    if(p.kind === 'flame'){
      ctx.fillStyle = p.life > 9 ? 'rgba(255,122,26,.9)' : 'rgba(255,210,63,.7)';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.life*0.4 + 2, 0, 7); ctx.fill();
    } else if(p.kind === 'dust'){
      ctx.fillStyle = 'rgba(165,113,61,.55)';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.life*0.25 + 2, 0, 7); ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(255,210,63,.9)';
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, 7); ctx.fill();
    }
  }

  drawBike();
  if(state.head) drawHead(state.head);
  ctx.restore();

  drawProfileStrip();

  // countdown numbers
  if(state.mode === 'countdown'){
    const n = Math.ceil(state.countdown / 60);
    ctx.fillStyle = 'rgba(40,50,92,.85)';
    ctx.font = "800 120px 'Baloo 2', sans-serif";
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(n > 0 ? n : 'GO!', W/2, H*0.4);
  } else if(state.mode === 'play' && state.time - goFlashT < 45){
    ctx.fillStyle = 'rgba(63,191,107,.9)';
    ctx.font = "800 100px 'Baloo 2', sans-serif";
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('GO!', W/2, H*0.4);
  }
}
/* full-course elevation profile strip (top of the game panel) — the whole
   route's terrain curve with the bike tracked along it, exactly like a real
   elevation-profile tool. Both this curve and the ride below come from the
   same groundY(), so they always agree with the map. */
let stripCache = null;
function drawProfileStrip(){
  const SH = 66;                                   // strip height
  const stepPx = Math.max(2, Math.floor(W / 420) * 2 || 2);
  if(!stripCache || stripCache.ref !== elevProfile || stripCache.w !== W){
    let mn = Infinity, mx = -Infinity;
    const ys = [];
    for(let sx = 0; sx <= W; sx += stepPx){
      const y = groundY(sx / W * FINISH_X);
      ys.push(y); if(y < mn) mn = y; if(y > mx) mx = y;
    }
    stripCache = { ref: elevProfile, w: W, ys, mn, mx: Math.max(mx, mn + 1), stepPx };
  }
  const C = stripCache;
  const top = 8, bot = SH - 10;
  const yTo = y => top + (y - C.mn) / (C.mx - C.mn) * (bot - top);

  // panel
  ctx.fillStyle = 'rgba(255,255,255,.82)';
  ctx.fillRect(0, 0, W, SH);
  // filled terrain curve
  ctx.beginPath();
  ctx.moveTo(0, SH);
  C.ys.forEach((y, i) => ctx.lineTo(i * C.stepPx, yTo(y)));
  ctx.lineTo(W, SH); ctx.closePath();
  ctx.fillStyle = 'rgba(165,113,61,.55)'; ctx.fill();
  ctx.beginPath();
  C.ys.forEach((y, i) => { const px = i * C.stepPx, py = yTo(y); i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); });
  ctx.strokeStyle = '#5fb944'; ctx.lineWidth = 2.5; ctx.stroke();

  // checkpoint + finish ticks
  ctx.fillStyle = '#ff7a1a';
  for(const cp of CHECKPOINTS){
    const px = cp.x / FINISH_X * W;
    ctx.beginPath(); ctx.moveTo(px, yTo(groundY(cp.x)) - 10); ctx.lineTo(px + 6, yTo(groundY(cp.x)) - 6); ctx.lineTo(px, yTo(groundY(cp.x)) - 2); ctx.fill();
  }
  ctx.fillStyle = '#28325c';
  ctx.fillRect(W - 3, yTo(groundY(FINISH_X)) - 12, 3, 12);

  // elevation labels (feet) for the strip's top/bottom
  const M2FT_ = M2FT;
  const eOf = y => elevProfile ? (elevProfile.minE + (BASE_Y - y) / elevProfile.pxPerM) * M2FT_ : (BASE_Y - y) / 2 * M2FT_;
  ctx.fillStyle = 'rgba(40,50,92,.55)';
  ctx.font = "600 10px 'Fredoka', sans-serif"; ctx.textAlign = 'left';
  ctx.textBaseline = 'top';    ctx.fillText(Math.round(eOf(C.mn)).toLocaleString() + ' ft', 4, top - 6);
  ctx.textBaseline = 'bottom'; ctx.fillText(Math.round(eOf(C.mx)).toLocaleString() + ' ft', 4, bot + 10);

  // the bike on the profile
  const bx = Math.max(0, Math.min(1, chassis.position.x / FINISH_X)) * W;
  const by = yTo(groundY(chassis.position.x));
  ctx.strokeStyle = 'rgba(255,122,26,.5)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(bx, 0); ctx.lineTo(bx, SH); ctx.stroke();
  ctx.fillStyle = '#ff7a1a'; ctx.strokeStyle = '#28325c'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(bx, by, 5.5, 0, 7); ctx.fill(); ctx.stroke();

  // bottom edge
  ctx.fillStyle = 'rgba(40,50,92,.25)';
  ctx.fillRect(0, SH - 2, W, 2);
}
function cloud(x,y,s){
  ctx.beginPath();
  ctx.arc(x,y,22*s,0,7); ctx.arc(x+24*s,y-8*s,18*s,0,7); ctx.arc(x+46*s,y,20*s,0,7);
  ctx.fill();
}
function drawStar(x,y){
  ctx.save(); ctx.translate(x,y); ctx.fillStyle='#ffd23f'; ctx.strokeStyle='#c99400'; ctx.lineWidth=2.5;
  ctx.beginPath();
  for(let i=0;i<10;i++){
    const r = i%2 ? 7 : 15, a = Math.PI*i/5 - Math.PI/2;
    ctx.lineTo(Math.cos(a)*r, Math.sin(a)*r);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
}
function drawFlag(x, reached){
  const y = groundY(x);
  ctx.save(); ctx.translate(x, y);
  ctx.rotate(Math.atan(groundSlope(x)) * 0.4);
  ctx.fillStyle = '#8a5a2d'; ctx.fillRect(-4, -86, 8, 86);
  const wave = Math.sin(state.time * 0.12 + x) * 3;
  ctx.fillStyle = reached ? '#3fbf6b' : '#ff7a1a';
  ctx.strokeStyle = '#28325c'; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(4, -84); ctx.lineTo(46, -74 + wave); ctx.lineTo(4, -60);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  if(reached){
    ctx.fillStyle = '#fff';
    ctx.font = "800 16px 'Baloo 2',sans-serif"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('✓', 18, -72 + wave * 0.5);
  }
  ctx.restore();
}
function drawFinishLine(){
  const x = FINISH_X, y = groundY(x);
  if(x < camX - 200 || x > camX + W + 200) return;
  ctx.save(); ctx.translate(x,y);
  // poles + banner
  ctx.fillStyle = '#28325c';
  ctx.fillRect(-6,-160,12,160);
  // checkered banner
  const bw = 150, bh = 40;
  for(let r=0;r<4;r++) for(let c=0;c<Math.ceil(bw/10);c++){
    ctx.fillStyle = (r+c)%2 ? '#28325c' : '#ffffff';
    ctx.fillRect(-bw/2 + c*10, -160 + r*10, 10, 10);
  }
  ctx.strokeStyle = '#28325c'; ctx.lineWidth = 4;
  ctx.strokeRect(-bw/2, -160, bw, bh);
  ctx.fillStyle = '#e8542f';
  ctx.font = "800 26px 'Baloo 2',sans-serif"; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('FINISH', 0, -95);
  // checkered strip on the ground
  for(let c=0;c<8;c++){
    ctx.fillStyle = c%2 ? '#28325c' : '#ffffff';
    ctx.fillRect(-40 + c*10, -4, 10, 10);
  }
  ctx.restore();
}
function drawCow(x, gy){
  const bob = Math.sin(state.time * 0.05 + x) * 1.5;        // gentle idle bob
  const tailSwish = Math.sin(state.time * 0.12 + x) * 0.5;
  ctx.save();
  ctx.translate(x, gy + bob);
  // legs
  ctx.strokeStyle = '#e9e4da'; ctx.lineWidth = 7; ctx.lineCap = 'round';
  for(const lx of [-20, -10, 12, 22]){
    ctx.beginPath(); ctx.moveTo(lx, -22); ctx.lineTo(lx, -bob - 2); ctx.stroke();
  }
  ctx.fillStyle = '#3b3b3b';
  for(const lx of [-20, -10, 12, 22]) ctx.fillRect(lx - 4, -bob - 6, 8, 6);   // hooves
  // tail
  ctx.strokeStyle = '#e9e4da'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(26, -38); ctx.quadraticCurveTo(38, -30 + tailSwish * 8, 36 + tailSwish * 6, -14);
  ctx.stroke();
  ctx.fillStyle = '#3b3b3b'; ctx.beginPath(); ctx.arc(36 + tailSwish * 6, -12, 4, 0, 7); ctx.fill();
  // body
  ctx.fillStyle = '#f5f1e8'; ctx.strokeStyle = '#3b3b3b'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(0, -36, 30, 18, 0, 0, 7); ctx.fill(); ctx.stroke();
  // patches
  ctx.fillStyle = '#3b3b3b';
  ctx.beginPath(); ctx.ellipse(-10, -40, 9, 6, 0.4, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.ellipse(12, -32, 7, 5, -0.5, 0, 7); ctx.fill();
  // head (facing the rider, i.e. left)
  ctx.fillStyle = '#f5f1e8';
  ctx.beginPath(); ctx.ellipse(-32, -46, 11, 9, -0.15, 0, 7); ctx.fill(); ctx.stroke();
  // snout
  ctx.fillStyle = '#f0b9c4';
  ctx.beginPath(); ctx.ellipse(-38, -43, 6, 4.5, -0.15, 0, 7); ctx.fill();
  ctx.fillStyle = '#3b3b3b';
  ctx.beginPath(); ctx.arc(-39, -43.5, 1, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(-36, -42.5, 1, 0, 7); ctx.fill();
  // eye
  ctx.beginPath(); ctx.arc(-32, -49, 1.8, 0, 7); ctx.fill();
  // ears + horns
  ctx.fillStyle = '#f5f1e8';
  ctx.beginPath(); ctx.ellipse(-27, -54, 5, 3, 0.6, 0, 7); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#c9a86a'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-34, -54); ctx.lineTo(-37, -59); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-30, -55); ctx.lineTo(-29, -61); ctx.stroke();
  ctx.restore();
}
function drawCowSign(x){
  const gy = groundY(x);
  ctx.save();
  ctx.translate(x, gy);
  ctx.fillStyle = '#8a5a2d'; ctx.fillRect(-4, -70, 8, 70);
  ctx.rotate(0);
  ctx.translate(0, -92);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#28325c'; ctx.lineWidth = 4;
  roundRect(-24, -24, 48, 48, 8); ctx.fill(); ctx.stroke();
  ctx.rotate(-Math.PI / 4);
  ctx.fillStyle = '#28325c';
  ctx.font = "26px sans-serif"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('🐄', 0, 2);
  ctx.restore();
}
function drawRamp(r){
  if(r.xD < camX - 200 || r.xA > camX + W + 200) return;
  const wood = '#c08f52', woodDark = '#7a5426', plank = 'rgba(0,0,0,.12)';
  // takeoff wedge
  ctx.beginPath();
  ctx.moveTo(r.xA, groundY(r.xA) + 6);
  ctx.lineTo(r.xB, r.yB);
  ctx.lineTo(r.xB, groundY(r.xB) + 6);
  ctx.closePath();
  ctx.fillStyle = wood; ctx.fill();
  ctx.strokeStyle = woodDark; ctx.lineWidth = 5; ctx.stroke();
  // plank lines along the incline
  ctx.strokeStyle = plank; ctx.lineWidth = 3;
  for(let i=1; i<6; i++){
    const t = i/6, px = r.xA + (r.xB - r.xA)*t, py = r.yA + (r.yB - r.yA)*t;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, groundY(px) + 4); ctx.stroke();
  }
  // landing platform deck
  ctx.beginPath();
  ctx.moveTo(r.xC, r.yC);
  ctx.lineTo(r.xD, r.yD);
  ctx.lineTo(r.xD, groundY(r.xD) + 6);
  ctx.lineTo(r.xC, groundY(r.xC) + 6);
  ctx.closePath();
  ctx.fillStyle = wood; ctx.fill();
  ctx.strokeStyle = woodDark; ctx.lineWidth = 5; ctx.stroke();
  ctx.strokeStyle = plank; ctx.lineWidth = 3;
  for(let i=1; i<7; i++){
    const t = i/7, px = r.xC + (r.xD - r.xC)*t, py = r.yC + (r.yD - r.yC)*t;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, groundY(px) + 4); ctx.stroke();
  }
  // support posts under the landing deck
  ctx.strokeStyle = woodDark; ctx.lineWidth = 7;
  for(let px = r.xC + 40; px < r.xD - 20; px += 90){
    const py = r.yC + (r.yD - r.yC) * (px - r.xC) / (r.xD - r.xC);
    ctx.beginPath(); ctx.moveTo(px, py + 6); ctx.lineTo(px, groundY(px) + 6); ctx.stroke();
  }
  // big arrow on the takeoff face
  ctx.fillStyle = '#fff3d6';
  ctx.save();
  ctx.translate((r.xA + r.xB)/2 + 20, (r.yA + r.yB)/2 + 26);
  ctx.rotate(Math.atan2(r.yB - r.yA, r.xB - r.xA));
  ctx.beginPath();
  ctx.moveTo(-22, -8); ctx.lineTo(6, -8); ctx.lineTo(6, -16); ctx.lineTo(24, 0);
  ctx.lineTo(6, 16); ctx.lineTo(6, 8); ctx.lineTo(-22, 8);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}
function drawHead(h){
  ctx.save();
  ctx.translate(h.x, h.y); ctx.rotate(h.ang);
  ctx.fillStyle = '#ff7a1a'; ctx.beginPath(); ctx.arc(0, 0, 11, 0, 7); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(4, 0, 5, 0, 7); ctx.fill();
  // dizzy eyes on the visor
  ctx.strokeStyle = '#28325c'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(2,-2); ctx.lineTo(6,2); ctx.moveTo(6,-2); ctx.lineTo(2,2); ctx.stroke();
  ctx.restore();
  // little dizzy stars circling the head
  const t = h.t * 0.25;
  for(let i=0;i<3;i++){
    const a = t + i * 2.1;
    ctx.fillStyle = 'rgba(255,210,63,.9)';
    ctx.save();
    ctx.translate(h.x + Math.cos(a)*20, h.y - 12 + Math.sin(a)*7);
    ctx.rotate(a);
    ctx.fillRect(-2.5,-2.5,5,5);
    ctx.restore();
  }
}
function roundRect(x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}
function drawBike(){
  // wheels from physics bodies
  for(const w of [rearWheel, frontWheel]){
    ctx.save(); ctx.translate(w.position.x, w.position.y); ctx.rotate(w.angle);
    ctx.fillStyle = '#28325c'; ctx.beginPath(); ctx.arc(0,0,WHEEL_R,0,7); ctx.fill();
    ctx.fillStyle = '#4a5580'; ctx.beginPath(); ctx.arc(0,0,WHEEL_R-6,0,7); ctx.fill();
    ctx.strokeStyle = '#c9d2f0'; ctx.lineWidth = 2.5;
    for(let i=0;i<3;i++){
      const sa = i*Math.PI/1.5;
      ctx.beginPath(); ctx.moveTo(-Math.cos(sa)*(WHEEL_R-6), -Math.sin(sa)*(WHEEL_R-6));
      ctx.lineTo(Math.cos(sa)*(WHEEL_R-6), Math.sin(sa)*(WHEEL_R-6)); ctx.stroke();
    }
    ctx.restore();
  }
  // chassis + rider drawn in chassis frame
  ctx.save();
  ctx.translate(chassis.position.x, chassis.position.y);
  ctx.rotate(chassis.angle);
  ctx.strokeStyle = state.turbo > 0 ? '#ff7a1a' : '#e8542f';
  ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-CHASSIS_W/2 + 6, 6); ctx.lineTo(-8, -12); ctx.lineTo(20, -10); ctx.lineTo(CHASSIS_W/2 - 6, 6);
  ctx.moveTo(-8, -12); ctx.lineTo(CHASSIS_W/2 - 10, 4);
  ctx.stroke();
  ctx.strokeStyle = '#28325c'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(-16,-18); ctx.lineTo(2,-18); ctx.stroke();          // seat
  ctx.beginPath(); ctx.moveTo(24,-12); ctx.lineTo(30,-28); ctx.stroke();          // handlebar
  ctx.lineWidth = 6; ctx.strokeStyle = '#2e7d32';
  ctx.beginPath(); ctx.moveTo(-8,-18); ctx.lineTo(-2,-38); ctx.stroke();          // body
  ctx.beginPath(); ctx.moveTo(-2,-38); ctx.lineTo(26,-28); ctx.stroke();          // arm
  ctx.beginPath(); ctx.moveTo(-8,-18); ctx.lineTo(6,-6); ctx.stroke();            // leg
  if(!state.head){
    ctx.fillStyle = '#ff7a1a'; ctx.beginPath(); ctx.arc(0,-47,11,0,7); ctx.fill();  // helmet
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(4,-47,5,0,7); ctx.fill();
  }
  ctx.restore();
}

/* ---------------- HUD ---------------- */
const timeTxt = document.getElementById('timeTxt'), distTxt = document.getElementById('distTxt');
const elevTxt = document.getElementById('elevTxt'), turboBar = document.getElementById('turboBar');
const sjTxt = document.getElementById('sjTxt');
function hud(){
  timeTxt.textContent = fmtTime(state.raceMs);
  distTxt.textContent = `${Math.round(state.dist * M2FT)} / ${COURSE_FT} ft  ⭐${state.starCount}`;
  // live elevation at the bike: connects the profile to the map's contour lines
  const cx = chassis.position.x;
  const slope = groundSlope(cx + 30);
  const arrow = slope < -0.03 ? ' ▲' : slope > 0.03 ? ' ▼' : '';
  if(elevProfile){
    const e = elevProfile.minE + (BASE_Y - groundY(cx)) / elevProfile.pxPerM;
    elevTxt.textContent = Math.round(e * M2FT) + ' ft' + arrow;
  } else {
    elevTxt.textContent = '+' + Math.max(0, Math.round((BASE_Y - groundY(cx)) / 2 * M2FT)) + ' ft' + arrow;
  }
  sjTxt.textContent = state.superJumps > 0 ? '🚀'.repeat(state.superJumps) : '—';
  turboBar.style.width = (state.turbo / TURBO_FRAMES * 100) + '%';
}

/* ---------------- Main loop ---------------- */
let goFlashT = -999, lastCount = 4, mapSyncT = 0;
function syncMapDot(){
  if(!bikeMarker || !routeLatLngAt) return;
  if(++mapSyncT % 3 !== 0) return;                       // update ~20x/sec
  bikeMarker.setLatLng(routeLatLngAt(chassis.position.x / PX_PER_M));
}
function loop(){
  state.time++;
  if(state.mode === 'countdown'){
    state.countdown--;
    const n = Math.ceil(state.countdown / 60);
    if(n !== lastCount && n >= 0){ lastCount = n; sfx.count(n); }
    if(state.countdown <= 0){ state.mode = 'play'; goFlashT = state.time; toast('⏱️ Race the clock!'); }
  }
  if(state.mode === 'play'){
    control();
    Engine.update(engine, 1000/60);
    gameChecks();
    state.raceMs += 1000/60;
  } else if(state.mode === 'crashAnim'){
    Engine.update(engine, 1000/60);   // the bike keeps tumbling...
    stepHead();                        // ...while the head bounces and rolls
    state.raceMs += 1000/60;
  } else if(state.mode === 'crash'){
    state.raceMs += 1000/60;                 // the clock never stops!
  }
  draw(); hud(); syncMapDot();
  requestAnimationFrame(loop);
}
document.getElementById('startBtn').addEventListener('click', ()=>{
  document.getElementById('startOverlay').classList.add('hidden');
  audio();
  lastCount = 4;
  startCountdown();
});
loop();                                    // start the elevation profile FIRST — the game never waits on the map
try{
  initMap();
}catch(err){
  console.error('Map failed to initialize:', err);
  const mapDiv = document.getElementById('map');
  mapDiv.innerHTML += '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:700;color:#28325c;text-align:center;padding:20px;z-index:1200;">🗺️ Map couldn\'t start (' + (err && err.message ? err.message : 'error') + ')<br>The race still works below!</div>';
}

// fetch the REAL elevation profile along the route; hold the start button briefly while it loads
(function(){
  const sb = document.getElementById('startBtn');
  const origTxt = sb.textContent;
  sb.disabled = true;
  sb.textContent = '⏳ READING THE MAP\u2019S ELEVATION…';
  loadElevationProfile().catch(err => {
    console.warn('Live elevation unavailable, using practice hills:', err);
    document.getElementById('profileBadge').textContent = '📈 ELEVATION PROFILE — practice hills (live elevation data unavailable)';
  }).finally(() => {
    sb.disabled = false;
    sb.textContent = origTxt;
  });
})();
