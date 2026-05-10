# Leipziger Spaetitour

Digitale Spaetitour fuer Gruppen in Leipzig. Kaufen, Link oeffnen, losziehen.

## Dateien

| Datei | Beschreibung |
|-------|-------------|
| `tour.html` | Spielseite (Template mit Platzhaltern) |
| `index.html` | Landingpage |
| `data/spaetis.json` | Spaeti-Pool (Adressen, Aktionen, Gehzeiten) |
| `data/aufgaben.json` | Aufgaben-Pool (50 Stueck, 4 Kategorien) |
| `build.sh` | Baut tour.html: setzt Daten + Wasserzeichen ein |
| `webhook/personalize.js` | Cloudflare Worker: Stripe -> personalisieren -> Email |
| `tour-logic.mjs` | Tour-Logik als ES-Modul (fuer Tests) |

## Lokal testen

```bash
# Vorschau-Tour bauen (mit Wasserzeichen "VORSCHAU")
./build.sh

# Personalisierte Tour bauen
./build.sh "Max Mustermann" meine-tour.html

# Tests
node --test tests/test-tour-logic.mjs
```

## Deployment

### 1. Cloudflare Pages (Landingpage)

```bash
# index.html auf Cloudflare Pages deployen
# Domain: spaetitour-leipzig.de
```

### 2. Cloudflare R2 (Tour-Template)

```bash
# Gebaute tour.html (mit echten Daten, ohne Kaeufername) hochladen
./build.sh "%%KAEUFER%%" template-tour.html
wrangler r2 object put spaetitour-tours/template/tour.html --file template-tour.html
```

### 3. Cloudflare Worker (Webhook)

```bash
cd webhook
# Secrets setzen
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put RESEND_API_KEY
# Deployen
wrangler deploy
```

### 4. Stripe

- Payment Link erstellen (10 EUR, einmalig)
- Webhook auf `https://api.spaetitour-leipzig.de/webhook/stripe` zeigen
- Event: `checkout.session.completed`

### 5. Resend

- Domain verifizieren: spaetitour-leipzig.de
- API Key generieren

## Neue Spaetis hinzufuegen

1. `data/spaetis.json` editieren: neuen Eintrag + Gehzeiten zu allen anderen
2. Gehzeiten bei allen bestehenden Spaetis fuer den neuen ergaenzen
3. `./build.sh` ausfuehren
4. Template in R2 hochladen

## Neue Aufgaben hinzufuegen

1. `data/aufgaben.json` editieren
2. `./build.sh` ausfuehren
3. Template in R2 hochladen
