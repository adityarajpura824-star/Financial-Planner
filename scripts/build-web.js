'use strict';
/*
 * Copies the static app into www/, the folder Capacitor packages into the Android app.
 * The web app itself needs no build step; this exists only for the APK.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'www');
const items = ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'data', 'icons'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const item of items) {
  fs.cpSync(path.join(root, item), path.join(out, item), { recursive: true });
}
console.log('Copied ' + items.length + ' items to www/');
