export const RANKINGS = [
  { min: 0, max: 100, label: 'Anfaenger-Nachtschwaermer' },
  { min: 101, max: 175, label: 'Spaeti-Kenner' },
  { min: 176, max: 999, label: 'Leipzig-Legende' },
];

export function selectSpaetis(spaetis, count) {
  if (count > spaetis.length) {
    throw new Error(`Nicht genug Spaetis: ${spaetis.length} vorhanden, ${count} angefordert`);
  }
  const pool = [...spaetis];
  const selected = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    selected.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return selected;
}

export function optimizeRoute(spaetis) {
  if (spaetis.length <= 1) return [...spaetis];
  const remaining = [...spaetis];
  const startIdx = Math.floor(Math.random() * remaining.length);
  const route = [remaining[startIdx]];
  remaining.splice(startIdx, 1);
  while (remaining.length > 0) {
    const current = route[route.length - 1];
    let nearest = 0;
    let nearestTime = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const time = current.gehzeit_min[remaining[i].id];
      if (time < nearestTime) {
        nearestTime = time;
        nearest = i;
      }
    }
    route.push(remaining[nearest]);
    remaining.splice(nearest, 1);
  }
  return route;
}

export function assignAufgaben(aufgaben, count) {
  const pool = [...aufgaben];
  const selected = [];
  const needed = Math.min(count, pool.length);
  for (let i = 0; i < needed; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    selected.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return selected;
}

export function createTour(allSpaetis, allAufgaben, stationCount = 5) {
  const selected = selectSpaetis(allSpaetis, stationCount);
  const route = optimizeRoute(selected);
  const aufgaben = assignAufgaben(allAufgaben, stationCount);
  const stationen = route.map((spaeti, i) => ({
    spaeti,
    wegaufgabe: aufgaben[i],
    wegErledigt: false,
    stationErreicht: false,
    aktionMitgemacht: false,
  }));
  return {
    stationen,
    punkte: 0,
    aktuelleStation: 0,
  };
}
