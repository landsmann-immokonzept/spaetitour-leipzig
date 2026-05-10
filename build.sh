#!/bin/bash
# Baut tour.html: setzt JSON-Daten und Wasserzeichen ein
# Usage: ./build.sh [kaeufer_name] [output_path]
#   kaeufer_name: Name fuer Wasserzeichen (default: "VORSCHAU")
#   output_path:  Ausgabedatei (default: tour-built.html)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KAEUFER="${1:-VORSCHAU}"
OUTPUT="${2:-$SCRIPT_DIR/tour-built.html}"

node -e "
const fs = require('fs');
const template = fs.readFileSync('$SCRIPT_DIR/tour.html', 'utf8');
const spaetis = fs.readFileSync('$SCRIPT_DIR/data/spaetis.json', 'utf8');
const aufgaben = fs.readFileSync('$SCRIPT_DIR/data/aufgaben.json', 'utf8');
let html = template
  .replace('__SPAETIS_DATA__', spaetis.trim())
  .replace('__AUFGABEN_DATA__', aufgaben.trim())
  .replaceAll('__KAEUFER_NAME__', '$KAEUFER');
fs.writeFileSync('$OUTPUT', html);
console.log('Built: $OUTPUT (Kaeufer: $KAEUFER)');
"
