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

var PHASE_LABELS = ['Ankommen', '\u00d6ffnen', 'Tiefe', 'Energie', 'Abschluss'];

var MECH_LABELS = {
  'matze': 'Hotel Matze',
  'just-one': 'Just One',
  'activity': 'Activity',
  'wer-bin-ich': 'Wer bin ich',
  'challenge': 'Challenge',
  'ranking': 'Ranking',
  'stadt': 'Stadtmission'
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
var nachspielStack = [];
var nachspielIndex = 0;

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
    var d = localStorage.getItem(STORAGE_KEY);
    if (!d) return null;
    var t = JSON.parse(d);
    // Migration: alte Tour-Objekte ohne ortaufgaben verwerfen
    if (!t.ortaufgaben) return null;
    return t;
  } catch (e) { return null; }
}

function clearTour() {
  localStorage.removeItem(STORAGE_KEY);
}

function getRanking(score) {
  return RANKINGS.find(r => score >= r.min && score <= r.max) || RANKINGS[0];
}

function renderPoolDisplay(task, prefix) {
  document.getElementById(prefix + 'Tabu').style.display = 'none';
  document.getElementById(prefix + 'Spektrum').style.display = 'none';
  document.getElementById(prefix + 'Wyr').style.display = 'none';

  if (task._resolved) {
    var r = task._resolved;
    if (r.typ === 'tabu') {
      document.getElementById(prefix + 'Tabu').style.display = 'block';
      document.getElementById(prefix + 'TabuWort').textContent = r.data.wort;
      var ul = document.getElementById(prefix + 'TabuListe');
      ul.innerHTML = '';
      r.data.verboten.forEach(function(w) {
        var li = document.createElement('li');
        li.textContent = w;
        ul.appendChild(li);
      });
    }
    if (r.typ === 'spektrum') {
      document.getElementById(prefix + 'Spektrum').style.display = 'block';
      document.getElementById(prefix + 'SpektrumLeft').textContent = r.data[0];
      document.getElementById(prefix + 'SpektrumRight').textContent = r.data[1];
    }
    if (r.typ === 'wyr') {
      document.getElementById(prefix + 'Wyr').style.display = 'block';
      document.getElementById(prefix + 'WyrA').textContent = r.data[0];
      document.getElementById(prefix + 'WyrB').textContent = r.data[1];
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TOUR CREATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function assignTasks(tourObj, excludeIds) {
  var mode = tourObj.mode;
  var usedIds = new Set(excludeIds || []);
  var lastMechanik = null;

  // Alle passenden Aufgaben (mode-gefiltert, shuffled)
  var pool = shuffle(AUFGABEN.filter(function(a) {
    return a.modi && a.modi.includes(mode) && !usedIds.has(a.id);
  }));

  // 1. ORT-AUFGABEN (5 Stueck, eine pro Station)
  var ortaufgaben = [];
  for (var i = 0; i < STATION_COUNT; i++) {
    var phase = i + 1;
    var station = tourObj.stations[i];
    var task = null;

    // a) Ortsgebundene Aufgabe? (ort_bindung === station.id)
    for (var j = 0; j < pool.length; j++) {
      if (pool[j].ort_bindung && pool[j].ort_bindung === station.id && !usedIds.has(pool[j].id)) {
        task = pool[j];
        break;
      }
    }

    // b) Zufaellig aus Phase + Kontext + Mechanik-Variety
    if (!task) {
      for (var j = 0; j < pool.length; j++) {
        var t = pool[j];
        if (usedIds.has(t.id)) continue;
        if (t.kontext !== 'ort') continue;
        if (t.phase !== phase && t.phase !== null) continue;
        if (t.mechanik === lastMechanik) continue;
        task = t;
        break;
      }
    }

    // c) Fallback: gleiche Mechanik erlauben
    if (!task) {
      for (var j = 0; j < pool.length; j++) {
        var t = pool[j];
        if (usedIds.has(t.id)) continue;
        if (t.kontext !== 'ort') continue;
        if (t.phase !== phase && t.phase !== null) continue;
        task = t;
        break;
      }
    }

    // d) Fallback: benachbarte Phase
    if (!task) {
      for (var j = 0; j < pool.length; j++) {
        var t = pool[j];
        if (usedIds.has(t.id)) continue;
        if (t.kontext !== 'ort') continue;
        var diff = Math.abs((t.phase || phase) - phase);
        if (diff <= 1) { task = t; break; }
      }
    }

    // e) Letzter Fallback
    if (!task) {
      task = { id: 'fallback_ort_' + phase, kontext: 'ort', phase: phase, mechanik: 'matze',
        text: 'Erz\u00e4hlt euch: Was war bisher euer Highlight heute Abend?', hint: null, punkte: 10, modi: [mode] };
    }

    usedIds.add(task.id);
    lastMechanik = task.mechanik;
    ortaufgaben.push(task);
  }

  // 2. WEG-AUFGABEN (4 Stueck, fuer Stationen 2-5)
  var wegaufgaben = [];
  for (var i = 1; i < STATION_COUNT; i++) {
    var phase = i + 1;
    var task = null;

    // a) Zufaellig aus Phase + Kontext + Mechanik-Variety
    for (var j = 0; j < pool.length; j++) {
      var t = pool[j];
      if (usedIds.has(t.id)) continue;
      if (t.kontext !== 'weg') continue;
      if (t.phase !== phase) continue;
      if (t.mechanik === lastMechanik) continue;
      task = t;
      break;
    }

    // b) Fallback: gleiche Mechanik erlauben
    if (!task) {
      for (var j = 0; j < pool.length; j++) {
        var t = pool[j];
        if (usedIds.has(t.id)) continue;
        if (t.kontext !== 'weg') continue;
        if (t.phase !== phase) continue;
        task = t;
        break;
      }
    }

    // c) Fallback: benachbarte Phase
    if (!task) {
      for (var j = 0; j < pool.length; j++) {
        var t = pool[j];
        if (usedIds.has(t.id)) continue;
        if (t.kontext !== 'weg') continue;
        var diff = Math.abs((t.phase || phase) - phase);
        if (diff <= 1) { task = t; break; }
      }
    }

    // d) Letzter Fallback
    if (!task) {
      task = { id: 'fallback_weg_' + phase, kontext: 'weg', phase: phase, mechanik: 'matze',
        text: 'Reihum: Was w\u00e4re euer Traum-Reiseziel und warum?', hint: null, punkte: 10, modi: [mode] };
    }

    usedIds.add(task.id);
    lastMechanik = task.mechanik;
    wegaufgaben.push(task);
  }

  // Pool-Resolution
  ortaufgaben = ortaufgaben.map(resolvePoolTask);
  wegaufgaben = wegaufgaben.map(resolvePoolTask);

  tourObj.ortaufgaben = ortaufgaben;
  tourObj.wegaufgaben = wegaufgaben;
  tourObj.usedTaskIds = Array.from(usedIds);
}

function createTour(mode) {
  // 1. Stationen: 5 aus 10 via nearest-neighbor
  var available = shuffle(SPAETIS.slice());
  var selected = [available[0]];
  var remaining = available.slice(1);

  while (selected.length < STATION_COUNT && remaining.length > 0) {
    var last = selected[selected.length - 1];
    var nearestIdx = 0;
    var nearestDist = Infinity;
    for (var i = 0; i < remaining.length; i++) {
      var d = haversine(last.lat, last.lng, remaining[i].lat, remaining[i].lng);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    }
    selected.push(remaining.splice(nearestIdx, 1)[0]);
  }

  // 2. Tour-Objekt erstellen
  var tourObj = {
    mode: mode,
    stations: selected,
    unusedStations: remaining,
    ortaufgaben: [],
    wegaufgaben: [],
    currentStation: 0,
    phase: 'ort',  // Station 1 startet direkt mit Ort (kein Weg)
    score: 0,
    stationScores: new Array(STATION_COUNT).fill(0),
    hintsUsed: new Array(STATION_COUNT).fill(false),
    ortErledigt: new Array(STATION_COUNT).fill(false),
    completed: false,
    startedAt: Date.now(),
    round: 1,
    round1Score: null,
    usedTaskIds: []
  };

  // 3. Aufgaben zuweisen
  assignTasks(tourObj, []);

  return tourObj;
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
  document.querySelectorAll('.tab-bar__item').forEach(function(t) { t.classList.remove('active'); });
  var tabId = 'tab' + tab.charAt(0).toUpperCase() + tab.slice(1);
  var tabEl = document.getElementById(tabId);
  if (tabEl) tabEl.classList.add('active');

  if (tab === 'tour') {
    if (tour.phase === 'weg') showWegaufgabe();
    else if (tour.phase === 'ort') showOrtaufgabe();
    else if (tour.phase === 'bonus') showBonus();
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

  if (tour.completed) {
    navStack = [];
    showTabBar();
    setMainPadding(true, true);
    showErgebnis();
    return;
  }

  // Resume-Sheet mit Kontext-Info
  var station = tour.stations[tour.currentStation];
  var phaseLabel = PHASE_LABELS[tour.currentStation];
  var roundInfo = tour.round === 2 ? ' (Runde 2)' : '';

  openSheet(
    'Willkommen zurück!',
    'Ihr wart bei Station ' + (tour.currentStation + 1) + ' von 5' + roundInfo + ' (' + phaseLabel + ').\n\n' +
    'Nächste Station: ' + station.name + '\n' +
    (station.adresse || ''),
    [
      {
        label: 'Weiter',
        primary: true,
        action: function() {
          navStack = [];
          showTabBar();
          setMainPadding(true, true);
          if (tour.phase === 'weg') showWegaufgabe();
          else if (tour.phase === 'ort') showOrtaufgabe();
          else if (tour.phase === 'bonus') showBonus();
        }
      },
      {
        label: 'Neu starten',
        primary: false,
        action: function() {
          clearTour();
          tour = null;
          stopGPS();
          showStartScreen();
        }
      }
    ]
  );
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
  const modeLabels = { freunde: 'Freunde', date: 'Date' };
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

    var phaseHtml = '<div class="route-timeline__phase">' + PHASE_LABELS[i] + '</div>';

    item.innerHTML =
      '<div class="route-timeline__line"></div>' +
      '<div class="route-timeline__number ' + (isCompleted ? 'completed' : '') + ' ' + (isActive ? 'active' : '') + '">' + (i + 1) + '</div>' +
      '<div class="route-timeline__info">' +
        '<div class="route-timeline__name">' + s.name + '</div>' +
        '<div class="route-timeline__address">' + (s.adresse || '') + '</div>' +
        phaseHtml +
        statusHtml +
      '</div>';
    timeline.appendChild(item);
  });

  // CTA
  const cta = document.getElementById('routeCta');
  if (tour.completed) {
    cta.textContent = 'Ergebnis anzeigen';
    cta.onclick = function() { showErgebnis(); };
  } else if (tour.currentStation === 0 && tour.phase === 'ort') {
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
  var i = tour.currentStation;
  var targetStation = tour.stations[i];
  setNavBar('Station ' + (i + 1) + '/' + STATION_COUNT, { score: true });
  showTabBar();
  setMainPadding(true, true);
  showScreen('screenWeg');

  // Progress dots
  var dotsEl = document.getElementById('wegDots');
  dotsEl.innerHTML = '';
  for (var d = 0; d < STATION_COUNT; d++) {
    var dot = document.createElement('div');
    dot.className = 'progress-dots__dot';
    if (d === i) dot.classList.add('active');
    else if (d < i) dot.classList.add('completed');
    dotsEl.appendChild(dot);
  }

  // Task card (wegaufgaben index = currentStation - 1)
  var task = tour.wegaufgaben[i - 1];
  var mechanik = task.mechanik || 'matze';
  var color = MECHANIK_COLORS[mechanik] || '#fbbf24';
  var badge = document.getElementById('wegBadge');
  badge.textContent = MECH_LABELS[mechanik] || mechanik;
  badge.style.background = color + '22';
  badge.style.color = color;

  document.getElementById('wegText').textContent = task.text || '';

  // Pool displays
  renderPoolDisplay(task, 'weg');

  // Card animation
  var card = document.getElementById('wegCard');
  card.classList.remove('animate-card-in');
  void card.offsetWidth;
  card.classList.add('animate-card-in');

  // Timer
  cancelTimer();
  if (task.timer && task.timer >= 5) {
    startTimer(task.timer, null);
  }

  // GPS tracking
  startGPS();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCREEN: ORT-AUFGABE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function showOrtaufgabe() {
  var i = tour.currentStation;
  var station = tour.stations[i];
  setNavBar(station.name, { score: true });
  showTabBar();
  setMainPadding(true, true);
  showScreen('screenOrt');

  // Progress dots
  var dotsEl = document.getElementById('ortDots');
  dotsEl.innerHTML = '';
  for (var d = 0; d < STATION_COUNT; d++) {
    var dot = document.createElement('div');
    dot.className = 'progress-dots__dot';
    if (d === i) dot.classList.add('active');
    else if (d < i) dot.classList.add('completed');
    dotsEl.appendChild(dot);
  }

  // Station label
  document.getElementById('ortStationLabel').textContent = '@ ' + station.name;

  // Task card
  var task = tour.ortaufgaben[i];
  var mechanik = task.mechanik || 'matze';
  var color = MECHANIK_COLORS[mechanik] || '#fbbf24';
  var badge = document.getElementById('ortBadge');
  badge.textContent = MECH_LABELS[mechanik] || mechanik;
  badge.style.background = color + '22';
  badge.style.color = color;

  document.getElementById('ortText').textContent = task.text || '';

  // Pool displays
  renderPoolDisplay(task, 'ort');

  // Card animation
  var card = document.getElementById('ortCard');
  card.classList.remove('animate-card-in');
  void card.offsetWidth;
  card.classList.add('animate-card-in');

  // Timer
  cancelTimer();
  if (task.timer && task.timer >= 5) {
    startTimer(task.timer, null);
  }

  stopGPS();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCREEN: BONUS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function showBonus() {
  var i = tour.currentStation;
  var station = tour.stations[i];
  setNavBar(station.name, { score: true });
  showTabBar();
  setMainPadding(true, true);
  showScreen('screenBonus');

  var aktion = station.aktion || {};
  document.getElementById('bonusName').textContent = aktion.name || 'Hausspiel';
  document.getElementById('bonusDesc').textContent = aktion.beschreibung || 'Fragt den Verk\u00e4ufer nach dem Hausspiel!';
  var bonus = aktion.bonuspunkte || PTS_STATION;
  document.getElementById('bonusPoints').textContent = '+' + bonus + ' Punkte';

  // Card animation
  var card = document.getElementById('bonusCard');
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

  // Count-up animation
  var scoreEl = document.getElementById('ergebnisScore');
  var target = tour.score;
  var duration = 2000;
  var start = performance.now();
  function animateScore(now) {
    var elapsed = now - start;
    var progress = Math.min(elapsed / duration, 1);
    var eased = 1 - Math.pow(1 - progress, 3);
    scoreEl.textContent = Math.round(target * eased);
    if (progress < 1) requestAnimationFrame(animateScore);
  }
  requestAnimationFrame(animateScore);

  // Ranking
  var totalScore = tour.round === 2 ? (tour.round1Score || 0) + tour.score : tour.score;
  document.getElementById('ergebnisRankingLabel').textContent = getRanking(totalScore).label;

  // Breakdown
  var breakdown = document.getElementById('ergebnisBreakdown');
  var listHtml = '';

  // Runde 2: Gesamt-Score anzeigen
  if (tour.round === 2 && tour.round1Score != null) {
    listHtml += '<div class="ergebnis-breakdown__item">' +
      '<span class="ergebnis-breakdown__station" style="font-weight:600">Runde 1</span>' +
      '<span class="ergebnis-breakdown__points">' + tour.round1Score + '</span>' +
    '</div>';
  }

  tour.stations.forEach(function(s, i) {
    var hintPenalty = tour.hintsUsed[i] ? ' <span style="color:var(--red)">(-' + PTS_HINT + ')</span>' : '';
    listHtml += '<div class="ergebnis-breakdown__item">' +
      '<span class="ergebnis-breakdown__station">' + s.name + '</span>' +
      '<span class="ergebnis-breakdown__points">+' + tour.stationScores[i] + hintPenalty + '</span>' +
    '</div>';
  });

  if (tour.round === 2 && tour.round1Score != null) {
    listHtml += '<div class="ergebnis-breakdown__item" style="border-top:1px solid var(--separator);padding-top:var(--spacing-sm);margin-top:var(--spacing-sm)">' +
      '<span class="ergebnis-breakdown__station" style="font-weight:700">Gesamt</span>' +
      '<span class="ergebnis-breakdown__points" style="font-weight:700">' + totalScore + '</span>' +
    '</div>';
  }

  breakdown.innerHTML =
    '<p class="ergebnis-breakdown__title">Punkteverteilung</p>' +
    '<div class="ergebnis-breakdown__list">' + listHtml + '</div>';

  // Runde 2 Button verstecken wenn keine Stationen uebrig
  var btnRound2 = document.getElementById('btnRound2');
  if (btnRound2) {
    btnRound2.style.display = (tour.unusedStations && tour.unusedStations.length >= STATION_COUNT) ? '' : 'none';
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCREEN: NACHSPIEL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function startNachspiel() {
  var usedIds = new Set(tour.usedTaskIds || []);
  nachspielStack = shuffle(
    AUFGABEN.filter(function(a) { return a.modi && a.modi.includes(tour.mode) && !usedIds.has(a.id); })
  );
  // Resolve pools for nachspiel tasks
  nachspielStack = nachspielStack.map(resolvePoolTask);
  nachspielIndex = 0;

  hideTabBar();
  setNavBar('Nachspiel', { back: true });
  navStack = [function() { showErgebnis(); }];
  setMainPadding(true, false);

  if (nachspielStack.length === 0) {
    showToast('<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>', 'Keine Karten mehr verf\u00fcgbar!');
    showErgebnis();
    return;
  }

  showNachspielCard();
}

function showNachspielCard() {
  showScreen('screenNachspiel');
  var task = nachspielStack[nachspielIndex];

  document.getElementById('nachspielCount').textContent =
    'Karte ' + (nachspielIndex + 1) + ' von ' + nachspielStack.length;

  var mechanik = task.mechanik || 'matze';
  var color = MECHANIK_COLORS[mechanik] || '#fbbf24';
  var badge = document.getElementById('nachspielBadge');
  badge.textContent = MECH_LABELS[mechanik] || mechanik;
  badge.style.background = color + '22';
  badge.style.color = color;

  document.getElementById('nachspielText').textContent = task.text || '';

  // Pool displays
  renderPoolDisplay(task, 'nachspiel');

  // Card animation
  var card = document.getElementById('nachspielCard');
  card.classList.remove('animate-card-in');
  void card.offsetWidth;
  card.classList.add('animate-card-in');
}

function nachspielNext() {
  nachspielIndex++;
  if (nachspielIndex >= nachspielStack.length) {
    showToast('<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>', 'Alle Karten gespielt!');
    nachspielIndex = nachspielStack.length - 1;
    return;
  }
  showNachspielCard();
}

function nachspielEnd() {
  showErgebnis();
}

function startRound2() {
  if (!tour.unusedStations || tour.unusedStations.length < STATION_COUNT) {
    showToast('<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>', 'Keine weiteren Stationen verf\u00fcgbar.');
    return;
  }

  tour.round1Score = tour.score;
  var round1UsedIds = (tour.usedTaskIds || []).slice();

  tour.stations = tour.unusedStations;
  tour.unusedStations = [];
  tour.round = 2;
  tour.currentStation = 0;
  tour.phase = 'ort';
  tour.score = 0;
  tour.stationScores = new Array(STATION_COUNT).fill(0);
  tour.hintsUsed = new Array(STATION_COUNT).fill(false);
  tour.ortErledigt = new Array(STATION_COUNT).fill(false);
  tour.completed = false;

  assignTasks(tour, round1UsedIds);
  saveTour();

  navStack = [];
  showRoute();
  showTabBar();
  setMainPadding(true, true);
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
  var i = tour.currentStation;
  var task = tour.wegaufgaben[i - 1];
  var basePts = task.punkte || PTS_STATION;
  var pts = tour.hintsUsed[i] ? Math.max(basePts - PTS_HINT, 5) : basePts;
  tour.stationScores[i] += pts;
  tour.score += pts;
  tour.phase = 'ort';
  saveTour();
  floatPoints(pts);
  if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
  showOrtaufgabe();
}

function wegSkip() {
  cancelTimer();
  tour.phase = 'ort';
  saveTour();
  showOrtaufgabe();
}

function showHintSheet() {
  var task = tour.wegaufgaben[tour.currentStation - 1];
  var hint = task.hint || 'Kein Hinweis verf\u00fcgbar.';
  tour.hintsUsed[tour.currentStation] = true;
  saveTour();
  openSheet('Hinweis', hint);
}

function ortErledigt() {
  cancelTimer();
  var i = tour.currentStation;
  var task = tour.ortaufgaben[i];
  var basePts = task.punkte || PTS_STATION;
  var pts = tour.hintsUsed[i] ? Math.max(basePts - PTS_HINT, 5) : basePts;
  tour.stationScores[i] += pts;
  tour.score += pts;
  tour.ortErledigt[i] = true;
  tour.phase = 'bonus';
  saveTour();
  floatPoints(pts);
  if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
  showBonus();
}

function ortSkip() {
  cancelTimer();
  tour.phase = 'bonus';
  saveTour();
  showBonus();
}

function showOrtHint() {
  var task = tour.ortaufgaben[tour.currentStation];
  var hint = task.hint || 'Kein Hinweis verf\u00fcgbar.';
  tour.hintsUsed[tour.currentStation] = true;
  saveTour();
  openSheet('Hinweis', hint);
}

function bonusMitgemacht() {
  var i = tour.currentStation;
  var station = tour.stations[i];
  var bonus = (station.aktion && station.aktion.bonuspunkte) || PTS_STATION;
  tour.stationScores[i] += bonus;
  tour.score += bonus;
  floatPoints(bonus);
  if (navigator.vibrate) navigator.vibrate(200);
  advanceStation();
}

function bonusSkip() {
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
            tour.phase = 'ort';
            saveTour();
            showOrtaufgabe();
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
function openSheet(title, body, actions) {
  document.getElementById('sheetTitle').textContent = title;
  document.getElementById('sheetBody').textContent = body;

  var actionsEl = document.getElementById('sheetActions');
  if (actions && actions.length) {
    actionsEl.innerHTML = '';
    actions.forEach(function(a) {
      var btn = document.createElement('button');
      btn.className = a.primary ? 'btn-primary' : 'btn-secondary';
      btn.textContent = a.label;
      btn.onclick = function() { closeSheet(); a.action(); };
      actionsEl.appendChild(btn);
    });
    actionsEl.style.display = 'flex';
  } else {
    actionsEl.style.display = 'none';
  }

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
  var totalScore = tour.round === 2 ? (tour.round1Score || 0) + tour.score : tour.score;
  var text = 'Sp\u00e4titour Leipzig: ' + totalScore + ' Punkte! ' + getRanking(totalScore).label + ' \uD83C\uDF1F';
  if (tour.round === 2) text += ' (2 Runden!)';
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
