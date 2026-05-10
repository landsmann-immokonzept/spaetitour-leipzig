import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectSpaetis, optimizeRoute, assignAufgaben, createTour, RANKINGS } from '../tour-logic.mjs';

const SPAETIS = [
  { id: 'a', viertel: 'V1', gehzeit_min: { b: 5, c: 10, d: 15, e: 8, f: 12 } },
  { id: 'b', viertel: 'V1', gehzeit_min: { a: 5, c: 8, d: 12, e: 10, f: 14 } },
  { id: 'c', viertel: 'V2', gehzeit_min: { a: 10, b: 8, d: 6, e: 15, f: 9 } },
  { id: 'd', viertel: 'V2', gehzeit_min: { a: 15, b: 12, c: 6, e: 18, f: 7 } },
  { id: 'e', viertel: 'V3', gehzeit_min: { a: 8, b: 10, c: 15, d: 18, f: 20 } },
  { id: 'f', viertel: 'V3', gehzeit_min: { a: 12, b: 14, c: 9, d: 7, e: 20 } },
];

const AUFGABEN = [
  { text: 'Aufgabe 1', punkte: 10, kategorie: 'kreativ' },
  { text: 'Aufgabe 2', punkte: 15, kategorie: 'challenge' },
  { text: 'Aufgabe 3', punkte: 20, kategorie: 'gruppe' },
  { text: 'Aufgabe 4', punkte: 10, kategorie: 'leipzig' },
  { text: 'Aufgabe 5', punkte: 25, kategorie: 'kreativ' },
  { text: 'Aufgabe 6', punkte: 15, kategorie: 'challenge' },
  { text: 'Aufgabe 7', punkte: 20, kategorie: 'gruppe' },
  { text: 'Aufgabe 8', punkte: 10, kategorie: 'leipzig' },
];

describe('selectSpaetis', () => {
  it('selects the requested number of spaetis', () => {
    const selected = selectSpaetis(SPAETIS, 4);
    assert.equal(selected.length, 4);
  });

  it('returns different selections on repeated calls (statistical)', () => {
    const results = new Set();
    for (let i = 0; i < 20; i++) {
      const selected = selectSpaetis(SPAETIS, 4);
      results.add(selected.map(s => s.id).sort().join(','));
    }
    assert.ok(results.size >= 2, `Expected at least 2 different selections, got ${results.size}`);
  });

  it('never returns duplicates', () => {
    for (let i = 0; i < 20; i++) {
      const selected = selectSpaetis(SPAETIS, 4);
      const ids = selected.map(s => s.id);
      assert.equal(new Set(ids).size, ids.length, 'Duplicate spaeti selected');
    }
  });

  it('throws if requesting more spaetis than available', () => {
    assert.throws(() => selectSpaetis(SPAETIS, 10), /nicht genug/i);
  });
});

describe('optimizeRoute', () => {
  it('returns spaetis in an order that avoids zig-zag', () => {
    const selected = [SPAETIS[0], SPAETIS[2], SPAETIS[3], SPAETIS[5]];
    const route = optimizeRoute(selected);
    assert.equal(route.length, 4);
    let totalTime = 0;
    for (let i = 0; i < route.length - 1; i++) {
      totalTime += route[i].gehzeit_min[route[i + 1].id];
    }
    assert.ok(totalTime <= 30, `Route too long: ${totalTime} min`);
  });

  it('returns all input spaetis', () => {
    const selected = [SPAETIS[0], SPAETIS[1], SPAETIS[2]];
    const route = optimizeRoute(selected);
    const routeIds = route.map(s => s.id).sort();
    const inputIds = selected.map(s => s.id).sort();
    assert.deepEqual(routeIds, inputIds);
  });
});

describe('assignAufgaben', () => {
  it('assigns one aufgabe per station', () => {
    const route = [SPAETIS[0], SPAETIS[1], SPAETIS[2], SPAETIS[3]];
    const assigned = assignAufgaben(AUFGABEN, route.length);
    assert.equal(assigned.length, route.length);
  });

  it('never assigns the same aufgabe twice', () => {
    const route = [SPAETIS[0], SPAETIS[1], SPAETIS[2], SPAETIS[3], SPAETIS[4]];
    const assigned = assignAufgaben(AUFGABEN, route.length);
    const texts = assigned.map(a => a.text);
    assert.equal(new Set(texts).size, texts.length, 'Duplicate aufgabe assigned');
  });
});

describe('createTour', () => {
  it('returns a complete tour object', () => {
    const tour = createTour(SPAETIS, AUFGABEN, 4);
    assert.equal(tour.stationen.length, 4);
    assert.equal(tour.punkte, 0);
    assert.equal(tour.aktuelleStation, 0);
    tour.stationen.forEach((station, i) => {
      assert.ok(station.spaeti, `Station ${i} missing spaeti`);
      assert.ok(station.wegaufgabe, `Station ${i} missing wegaufgabe`);
    });
  });
});

describe('RANKINGS', () => {
  it('returns correct ranking for score ranges', () => {
    assert.equal(RANKINGS.find(r => 50 >= r.min && 50 <= r.max).label, 'Anfaenger-Nachtschwaermer');
    assert.equal(RANKINGS.find(r => 150 >= r.min && 150 <= r.max).label, 'Spaeti-Kenner');
    assert.equal(RANKINGS.find(r => 200 >= r.min && 200 <= r.max).label, 'Leipzig-Legende');
  });
});
