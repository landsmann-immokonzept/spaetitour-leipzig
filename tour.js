// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONSTANTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const STATION_COUNT = 5;
const PTS_STATION = 20;
const PTS_HINT = 5;
const GPS_THRESHOLD = 40;
const STORAGE_KEY = 'spaetitour_state';
const RANKINGS = [
  { min: 0, max: 100, label: 'Anf\u00e4nger' },
  { min: 101, max: 175, label: 'Sp\u00e4ti-Kenner' },
  { min: 176, max: Infinity, label: 'Leipzig-Legende' }
];

const MECHANIK_COLORS = {
  'matze': '#c4b5fd',
  'just-one': '#67e8f9',
  'activity': '#fca5a5',
  'wer-bin-ich': '#fdba74',
  'challenge': '#fbbf24',
  'ranking': '#86efac',
  'stadt': '#a5b4fc'
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let tour = null;
let currentScreen = null;
let gpsWatchId = null;
let gpsArrived = false;
let gpsWegStart = 0;
let timerInterval = null;
let timerCallback = null;
let activeTab = 'tour';
let navStack = [];
var poolState = { tabu: 0, spektrum: 0, wyr: 0 };

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UTILITIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function resolvePoolTask(task) {
  if (!task.pool) return task;
  var resolved = JSON.parse(JSON.stringify(task));
  var typ = task.pool.typ;
  var pool = POOLS[typ];
  if (!pool || pool.length === 0) return resolved;
  var idx = (poolState[typ] + Math.floor(Math.random() * (pool.length - 1))) % pool.length;
  poolState[typ] = idx + 1;
  resolved._resolved = { typ: typ, data: pool[idx] };
  return resolved;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function saveTour() {
  if (tour) localStorage.setItem(STORAGE_KEY, JSON.stringify(tour));
}

function loadTour() {
  try {
    const d = localStorage.getItem(STORAGE_KEY);
    return d ? JSON.parse(d) : null;
  } catch (e) { return null; }
}

function clearTour() {
  localStorage.removeItem(STORAGE_KEY);
}

function getRanking(score) {
  return RANKINGS.find(r => score >= r.min && score <= r.max) || RANKINGS[0];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TOUR CREATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function createTour(mode) {
  // Pick STATION_COUNT spaetis using nearest-neighbor from random start
  const available = shuffle(SPAETIS);
  const selected = [available[0]];
  const remaining = available.slice(1);

  while (selected.length < STATION_COUNT && remaining.length > 0) {
    const last = selected[selected.length - 1];
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversine(last.lat, last.lng, remaining[i].lat, remaining[i].lng);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    }
    selected.push(remaining.splice(nearestIdx, 1)[0]);
  }

  // Filter tasks by mode
  const modeTasks = shuffle(AUFGABEN.filter(a => a.modi && a.modi.includes(mode)));

  // Slot-based assignment: assign tasks by station position (1-5)
  const wegaufgaben = [];
  const usedIds = new Set();
  let lastMechanik = null;

  for (let slot = 1; slot <= STATION_COUNT; slot++) {
    // Prefer tasks that match this slot AND have a different mechanik
    let task = null;
    for (let j = 0; j < modeTasks.length; j++) {
      const t = modeTasks[j];
      if (usedIds.has(t.id)) continue;
      if (t.slots && t.slots.includes(slot) && t.mechanik !== lastMechanik) {
        task = t;
        break;
      }
    }
    // Fallback: match slot but allow same mechanik
    if (!task) {
      for (let j = 0; j < modeTasks.length; j++) {
        const t = modeTasks[j];
        if (usedIds.has(t.id)) continue;
        if (t.slots && t.slots.includes(slot)) { task = t; break; }
      }
    }
    // Fallback: adjacent slot (+/-1)
    if (!task) {
      for (let j = 0; j < modeTasks.length; j++) {
        const t = modeTasks[j];
        if (usedIds.has(t.id)) continue;
        if (t.slots && (t.slots.includes(slot - 1) || t.slots.includes(slot + 1))) { task = t; break; }
      }
    }
    // Last resort: any unused task
    if (!task) {
      for (let j = 0; j < modeTasks.length; j++) {
        if (!usedIds.has(modeTasks[j].id)) { task = modeTasks[j]; break; }
      }
    }
    if (task) {
      usedIds.add(task.id);
      lastMechanik = task.mechanik;
      wegaufgaben.push(task);
    } else {
      wegaufgaben.push({ id: 'fallback_' + slot, text: 'Lauft weiter zur n\u00e4chsten Station!', mechanik: 'activity', hint: null, punkte: 10 });
    }
  }

  // Resolve pool tasks (draw random entries from pools)
  var resolvedWeg = wegaufgaben.map(resolvePoolTask);

  return {
    mode,
    stations: selected,
    wegaufgaben: resolvedWeg,
    currentStation: 0,
    phase: 'weg',
    score: 0,
    stationScores: new Array(STATION_COUNT).fill(0),
    hintsUsed: new Array(STATION_COUNT).fill(false),
    completed: false,
    startedAt: Date.now()
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UI CONTROLLERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screen = document.getElementById(id);
  if (screen) screen.classList.add('active');
  currentScreen = id;
}

function setNavBar(title, opts) {
  const o = opts || {};
  const nav = document.getElementById('navBar');
  const backBtn = document.getElementById('navBack');
  const titleEl = document.getElementById('navTitle');
  const scoreEl = document.getElementById('navScore');

  nav.classList.remove('hidden');
  titleEl.textContent = title;
  backBtn.style.display = o.back ? '' : 'none';
  scoreEl.style.display = o.score ? '' : 'none';
  if (o.score && tour) scoreEl.textContent = tour.score + ' Pkt';
}

function hideNavBar() {
  document.getElementById('navBar').classList.add('hidden');
}

function showTabBar() {
  document.getElementById('tabBar').classList.remove('hidden');
}

function hideTabBar() {
  document.getElementById('tabBar').classList.add('hidden');
}

function setMainPadding(nav, tab) {
  const main = document.getElementById('mainContent');
  main.classList.toggle('with-nav', nav);
  main.classList.toggle('with-tab', tab);
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-bar__item').forEach(t => t.classList.remove('active'));

  const tabId = 'tab' + tab.charAt(0).toUpperCase() + tab.slice(1);
  const tabEl = document.getElementById(tabId);
  if (tabEl) tabEl.classList.add('active');

  if (tab === 'tour') {
    if (tour.phase === 'weg') showWegaufgabe();
    else showSpaeti();
  } else if (tab === 'karte') {
    showRoute();
  } else if (tab === 'score') {
    showScoreTab();
  }
}

function updateScoreBadge() {
  const scoreEl = document.getElementById('navScore');
  if (scoreEl.style.display !== 'none' && tour) {
    scoreEl.textContent = tour.score + ' Pkt';
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NAVIGATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function navGoBack() {
  if (navStack.length > 0) {
    const prev = navStack.pop();
    prev();
  } else {
    showStartScreen();
  }
}

function showStartScreen() {
  hideNavBar();
  hideTabBar();
  setMainPadding(false, false);
  showScreen('screenStart');
  stopGPS();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FLOW ACTIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function startTour() {
  navStack = [showStartScreen];
  setNavBar('Spielmodus', { back: true });
  hideTabBar();
  setMainPadding(true, false);
  showScreen('screenMode');
}

function selectMode(mode) {
  tour = createTour(mode);
  saveTour();
  navStack = [];
  showRoute();
  showTabBar();
  setMainPadding(true, true);
}

function resumeTour() {
  tour = loadTour();
  if (!tour) return;
  navStack = [];
  showTabBar();
  setMainPadding(true, true);

  if (tour.completed) {
    showErgebnis();
  } else if (tour.phase === 'weg') {
    showWegaufgabe();
  } else {
    showSpaeti();
  }
}

function neueTour() {
  if (!confirm('Neue Tour starten? Der aktuelle Fortschritt geht verloren.')) return;
  clearTour();
  tour = null;
  stopGPS();
  showStartScreen();
}

function abortTour() {
  if (!confirm('Tour wirklich abbrechen?')) return;
  clearTour();
  tour = null;
  stopGPS();
  showStartScreen();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCREEN: ROUTE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function showRoute() {
  setNavBar('Route', { score: true });
  showTabBar();
  setMainPadding(true, true);
  showScreen('screenRoute');

  // Summary pill
  const modeLabels = { freunde: 'Freunde', date: 'Date', trinkspiel: 'Trinkspiel', 'team-duell': 'Team-Duell' };
  document.getElementById('routeSummaryPill').textContent =
    STATION_COUNT + ' Stationen \u00B7 ~45 Min \u00B7 ' + (modeLabels[tour.mode] || tour.mode);

  // Timeline
  const timeline = document.getElementById('routeTimeline');
  timeline.innerHTML = '';
  tour.stations.forEach(function(s, i) {
    const isCompleted = i < tour.currentStation;
    const isActive = i === tour.currentStation && !tour.completed;
    const item = document.createElement('div');
    item.className = 'route-timeline__item';

    var statusHtml = '';
    if (isActive) statusHtml = '<div class="route-timeline__status">Aktuelle Station</div>';
    else if (isCompleted) statusHtml = '<div class="route-timeline__status" style="color:var(--green)">Abgeschlossen</div>';

    item.innerHTML =
      '<div class="route-timeline__line"></div>' +
      '<div class="route-timeline__number ' + (isCompleted ? 'completed' : '') + ' ' + (isActive ? 'active' : '') + '">' + (i + 1) + '</div>' +
      '<div class="route-timeline__info">' +
        '<div class="route-timeline__name">' + s.name + '</div>' +
        '<div class="route-timeline__address">' + (s.adresse || '') + '</div>' +
        statusHtml +
      '</div>';
    timeline.appendChild(item);
  });

  // CTA
  const cta = document.getElementById('routeCta');
  if (tour.completed) {
    cta.textContent = 'Ergebnis anzeigen';
    cta.onclick = function() { showErgebnis(); };
  } else if (tour.currentStation === 0 && tour.phase === 'weg') {
    cta.textContent = 'Tour starten';
    cta.onclick = function() { switchTab('tour'); };
  } else {
    cta.textContent = 'Weiter zur Aufgabe';
    cta.onclick = function() { switchTab('tour'); };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCREEN: WEGAUFGABE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function showWegaufgabe() {
  const i = tour.currentStation;
  setNavBar('Station ' + (i + 1) + '/' + STATION_COUNT, { score: true });
  showTabBar();
  setMainPadding(true, true);
  showScreen('screenWeg');

  // Progress dots
  const dotsEl = document.getElementById('wegDots');
  dotsEl.innerHTML = '';
  for (let d = 0; d < STATION_COUNT; d++) {
    const dot = document.createElement('div');
    dot.className = 'progress-dots__dot';
    if (d === i) dot.classList.add('active');
    else if (d < i) dot.classList.add('completed');
    dotsEl.appendChild(dot);
  }

  // Task card
  const task = tour.wegaufgaben[i];
  const badge = document.getElementById('wegBadge');
  const mechanik = task.mechanik || 'activity';
  const MECH_LABELS = { 'matze': 'Hotel Matze', 'just-one': 'Just One', 'activity': 'Activity', 'wer-bin-ich': 'Wer bin ich', 'challenge': 'Challenge', 'ranking': 'Ranking', 'stadt': 'Stadtmission' };
  const color = MECHANIK_COLORS[mechanik] || '#fbbf24';
  badge.textContent = MECH_LABELS[mechanik] || mechanik;
  badge.style.background = color + '22';
  badge.style.color = color;

  document.getElementById('wegText').textContent = task.text || '';

  // Team-Modus display
  const teamEl = document.getElementById('wegTeam');
  if (task.meta && task.meta.team_modus) {
    teamEl.textContent = 'Teilt euch: ' + task.meta.team_modus;
    teamEl.style.display = 'block';
  } else {
    teamEl.style.display = 'none';
  }

  // Trinkregel display
  const trinkEl = document.getElementById('wegTrink');
  if (task.meta && task.meta.trink_regel) {
    trinkEl.textContent = task.meta.trink_regel;
    trinkEl.style.display = 'block';
  } else {
    trinkEl.style.display = 'none';
  }

  // Pool displays
  document.getElementById('wegTabu').style.display = 'none';
  document.getElementById('wegSpektrum').style.display = 'none';
  document.getElementById('wegWyr').style.display = 'none';

  if (task._resolved) {
    var r = task._resolved;
    if (r.typ === 'tabu') {
      document.getElementById('wegTabu').style.display = 'block';
      document.getElementById('wegTabuWort').textContent = r.data.wort;
      var ul = document.getElementById('wegTabuListe');
      ul.innerHTML = '';
      r.data.verboten.forEach(function(w) {
        var li = document.createElement('li');
        li.textContent = w;
        ul.appendChild(li);
      });
    }
    if (r.typ === 'spektrum') {
      document.getElementById('wegSpektrum').style.display = 'block';
      document.getElementById('wegSpektrumLeft').textContent = r.data[0];
      document.getElementById('wegSpektrumRight').textContent = r.data[1];
    }
    if (r.typ === 'wyr') {
      document.getElementById('wegWyr').style.display = 'block';
      document.getElementById('wegWyrA').textContent = r.data[0];
      document.getElementById('wegWyrB').textContent = r.data[1];
    }
  }

  // Non-pool tabu_woerter display
  if (!task._resolved && task.meta && task.meta.tabu_woerter && task.meta.tabu_woerter.length > 0) {
    document.getElementById('wegTabu').style.display = 'block';
    var tabuWort = (task.text.match(/'([^']+)'/) || [])[1] || 'Begriff';
    document.getElementById('wegTabuWort').textContent = tabuWort;
    var ul = document.getElementById('wegTabuListe');
    ul.innerHTML = '';
    task.meta.tabu_woerter.forEach(function(w) {
      var li = document.createElement('li');
      li.textContent = w;
      ul.appendChild(li);
    });
  }

  // Re-trigger card animation
  const card = document.getElementById('wegCard');
  card.classList.remove('animate-card-in');
  void card.offsetWidth;
  card.classList.add('animate-card-in');

  // Timer auto-start
  cancelTimer();
  if (task.meta && task.meta.timer_sek && task.meta.timer_sek >= 5) {
    startTimer(task.meta.timer_sek, null);
  }

  // Start GPS tracking
  startGPS();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCREEN: SPAETI
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function showSpaeti() {
  const i = tour.currentStation;
  const station = tour.stations[i];
  setNavBar(station.name, { score: true });
  showTabBar();
  setMainPadding(true, true);
  showScreen('screenSpaeti');

  document.getElementById('spaetiName').textContent = station.name;
  document.getElementById('spaetiAddress').textContent = station.adresse || '';
  const aktion = station.aktion || {};
  document.getElementById('spaetiAktion').textContent = aktion.beschreibung || aktion.name || 'Kauft euch ein Getr\u00e4nk!';
  const bonus = aktion.bonuspunkte || PTS_STATION;
  document.getElementById('spaetiBonus').textContent = '+' + bonus + ' Punkte';

  // Re-trigger card animation
  const card = document.getElementById('spaetiCard');
  card.classList.remove('animate-card-in');
  void card.offsetWidth;
  card.classList.add('animate-card-in');

  showToast('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>', 'Willkommen bei ' + station.name + '!');
  stopGPS();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCREEN: ERGEBNIS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function showErgebnis() {
  hideNavBar();
  hideTabBar();
  setMainPadding(false, false);
  showScreen('screenErgebnis');
  stopGPS();

  // Count-up animation (2s, ease-out)
  const scoreEl = document.getElementById('ergebnisScore');
  const target = tour.score;
  const duration = 2000;
  const start = performance.now();
  function animateScore(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    scoreEl.textContent = Math.round(target * eased);
    if (progress < 1) requestAnimationFrame(animateScore);
  }
  requestAnimationFrame(animateScore);

  document.getElementById('ergebnisRankingLabel').textContent = getRanking(tour.score).label;

  // Breakdown
  const breakdown = document.getElementById('ergebnisBreakdown');
  var listHtml = '';
  tour.stations.forEach(function(s, i) {
    const hintPenalty = tour.hintsUsed[i] ? ' <span style="color:var(--red)">(-' + PTS_HINT + ')</span>' : '';
    listHtml += '<div class="ergebnis-breakdown__item">' +
      '<span class="ergebnis-breakdown__station">' + s.name + '</span>' +
      '<span class="ergebnis-breakdown__points">+' + tour.stationScores[i] + hintPenalty + '</span>' +
    '</div>';
  });
  breakdown.innerHTML =
    '<p class="ergebnis-breakdown__title">Punkteverteilung</p>' +
    '<div class="ergebnis-breakdown__list">' + listHtml + '</div>';
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCREEN: SCORE TAB
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function showScoreTab() {
  setNavBar('Score', { score: false });
  showTabBar();
  setMainPadding(true, true);
  showScreen('screenScoreTab');

  document.getElementById('scoreTabValue').textContent = tour.score;

  const breakdown = document.getElementById('scoreTabBreakdown');
  var listHtml = '';
  tour.stations.forEach(function(s, i) {
    var name = (i < tour.currentStation || tour.stationScores[i] > 0) ? s.name : '???';
    var pts = tour.stationScores[i] > 0 ? ('+' + tour.stationScores[i]) : '\u2013';
    listHtml += '<div class="ergebnis-breakdown__item">' +
      '<span class="ergebnis-breakdown__station">' + name + '</span>' +
      '<span class="ergebnis-breakdown__points">' + pts + '</span>' +
    '</div>';
  });
  breakdown.innerHTML =
    '<p class="ergebnis-breakdown__title">Bisherige Punkte</p>' +
    '<div class="ergebnis-breakdown__list">' + listHtml + '</div>';
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ACTIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function wegErledigt() {
  cancelTimer();
  const i = tour.currentStation;
  const task = tour.wegaufgaben[i];
  const basePts = task.punkte || PTS_STATION;
  const pts = tour.hintsUsed[i] ? Math.max(basePts - PTS_HINT, 5) : basePts;
  tour.stationScores[i] += pts;
  tour.score += pts;
  tour.phase = 'spaeti';
  saveTour();
  floatPoints(pts);
  if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
  showSpaeti();
}

function wegSkip() {
  cancelTimer();
  tour.phase = 'spaeti';
  saveTour();
  showSpaeti();
}

function showHintSheet() {
  const task = tour.wegaufgaben[tour.currentStation];
  const hint = task.hint || 'Kein Hinweis verf\u00fcgbar.';
  tour.hintsUsed[tour.currentStation] = true;
  saveTour();
  openSheet('Hinweis', hint);
}

function spaetiAktion() {
  const i = tour.currentStation;
  const station = tour.stations[i];
  const bonus = (station.aktion && station.aktion.bonuspunkte) || PTS_STATION;
  tour.stationScores[i] += bonus;
  tour.score += bonus;
  floatPoints(bonus);
  if (navigator.vibrate) navigator.vibrate(200);
  advanceStation();
}

function spaetiWeiter() {
  advanceStation();
}

function advanceStation() {
  tour.currentStation++;
  if (tour.currentStation >= STATION_COUNT) {
    tour.completed = true;
    saveTour();
    showErgebnis();
  } else {
    tour.phase = 'weg';
    saveTour();
    showWegaufgabe();
  }
}

function routeCtaAction() {
  if (tour.completed) {
    showErgebnis();
  } else {
    switchTab('tour');
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GPS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function startGPS() {
  stopGPS();
  gpsArrived = false;
  gpsWegStart = Date.now();
  if (!navigator.geolocation) {
    document.getElementById('wegDistance').textContent = 'GPS nicht verf\u00fcgbar';
    return;
  }

  gpsWatchId = navigator.geolocation.watchPosition(
    function(pos) {
      if (!tour || tour.phase !== 'weg') return;
      const target = tour.stations[tour.currentStation];
      const dist = haversine(pos.coords.latitude, pos.coords.longitude, target.lat, target.lng);
      const distEl = document.getElementById('wegDistance');

      if (dist < 1000) {
        distEl.textContent = 'noch ~' + Math.round(dist) + 'm';
      } else {
        distEl.textContent = 'noch ~' + (dist / 1000).toFixed(1) + ' km';
      }

      // Guard: ignore if already arrived, or if weg screen open less than 10s
      if (dist <= GPS_THRESHOLD && !gpsArrived && (Date.now() - gpsWegStart > 10000)) {
        gpsArrived = true;
        if (navigator.vibrate) navigator.vibrate(200);
        showToast('<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z"/></svg>', 'Ihr seid da!');
        setTimeout(function() {
          if (tour && tour.phase === 'weg') {
            cancelTimer();
            tour.phase = 'spaeti';
            saveTour();
            showSpaeti();
          }
        }, 1500);
      }
    },
    function(err) {
      var target = tour.stations[tour.currentStation];
      var el = document.getElementById('wegDistance');
      el.innerHTML = '<a href="https://maps.apple.com/?daddr=' + target.lat + ',' + target.lng + '&dirflg=w" target="_blank" style="color:var(--accent)">In Maps navigieren &#x2192;</a>';
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
  );
}

function stopGPS() {
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BOTTOM SHEET
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function openSheet(title, body) {
  document.getElementById('sheetTitle').textContent = title;
  document.getElementById('sheetBody').textContent = body;
  document.getElementById('sheetBackdrop').classList.add('visible');
  document.getElementById('sheet').classList.add('visible');
}

function closeSheet() {
  document.getElementById('sheetBackdrop').classList.remove('visible');
  document.getElementById('sheet').classList.remove('visible');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TIMER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function startTimer(seconds, cb) {
  timerCallback = cb;
  var remaining = seconds;
  const circumference = 2 * Math.PI * 52;
  const progress = document.getElementById('timerProgress');
  const timeDisplay = document.getElementById('timerTime');
  const overlay = document.getElementById('timerOverlay');

  progress.style.strokeDasharray = circumference;
  progress.style.strokeDashoffset = '0';
  progress.style.stroke = 'var(--accent)';
  timeDisplay.style.color = 'var(--label-primary)';
  timeDisplay.textContent = remaining;
  overlay.classList.add('visible');

  timerInterval = setInterval(function() {
    remaining--;
    timeDisplay.textContent = remaining;
    const offset = circumference * (1 - remaining / seconds);
    progress.style.strokeDashoffset = offset;

    if (remaining <= 5) {
      progress.style.stroke = 'var(--red)';
      timeDisplay.style.color = 'var(--red)';
    }

    if (remaining <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      if (navigator.vibrate) navigator.vibrate(500);
      setTimeout(function() {
        overlay.classList.remove('visible');
        if (timerCallback) timerCallback();
      }, 1000);
    }
  }, 1000);
}

function cancelTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  document.getElementById('timerOverlay').classList.remove('visible');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TOAST
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
let toastTimeout = null;

function showToast(icon, text) {
  const toast = document.getElementById('toast');
  document.getElementById('toastIcon').innerHTML = icon;
  document.getElementById('toastText').textContent = text;
  toast.classList.add('visible');
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(function() {
    toast.classList.remove('visible');
    toastTimeout = null;
  }, 3000);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POINTS FLOAT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function floatPoints(pts) {
  const el = document.createElement('div');
  el.className = 'points-float';
  el.textContent = '+' + pts;
  el.style.top = '80px';
  el.style.right = '20px';
  document.body.appendChild(el);
  setTimeout(function() { el.remove(); }, 1200);
  updateScoreBadge();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SHARE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function shareTour() {
  const text = 'Sp\u00e4titour Leipzig: ' + tour.score + ' Punkte! ' + getRanking(tour.score).label + ' \uD83C\uDF1F';
  if (navigator.share) {
    navigator.share({ title: 'Sp\u00e4titour Leipzig', text: text });
  } else {
    navigator.clipboard.writeText(text).then(function() {
      showToast('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>', 'In Zwischenablage kopiert!');
    });
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INIT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
(function init() {
  const saved = loadTour();
  if (saved) {
    document.getElementById('btnResume').style.display = '';
  }
  showScreen('screenStart');
})();
