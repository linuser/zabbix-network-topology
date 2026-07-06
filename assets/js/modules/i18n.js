// i18n.js — minimale Uebersetzungsschicht fuer das Modul.
//
// Sprache kommt aus NT_CONFIG.lang (Zabbix-User-Sprache, z.B. "de_DE",
// "en_US" oder "default"). Alles was mit "de" beginnt → Deutsch, sonst
// Englisch. Fallback-Kette pro Key: aktive Sprache → Englisch → Key selbst
// (so faellt ein vergessener Eintrag im UI sofort auf, statt leer zu sein).
//
// Verwendung:
//   import { t } from './i18n.js';
//   t('health.title')                          → "Topology Health"
//   t('health.summary', { groups: 8, avg: 72 }) → Platzhalter {groups} etc.
//
// Migration: Strings modulweise umstellen (Keys in i18n/de.js + i18n/en.js
// eintragen, Aufrufer auf t() umbiegen). Deutsch bleibt bis dahin der
// hardcodete Stand der noch nicht migrierten Module.

import de from './i18n/de.js';
import en from './i18n/en.js';

const DICTS = { de: de, en: en };

function detectLang() {
    const cfg = window.NT_CONFIG || {};
    const raw = String(cfg.lang || '').toLowerCase();
    if (raw.indexOf('de') === 0) return 'de';
    if (raw === 'default' || raw === '') {
        // Zabbix "System default" — Browser-Sprache als bester Guess
        const nav = String((navigator.language || 'en')).toLowerCase();
        return nav.indexOf('de') === 0 ? 'de' : 'en';
    }
    return 'en';
}

let _lang = detectLang();

export function t(key, vars) {
    let s = DICTS[_lang][key];
    if (s === undefined) s = DICTS.en[key];
    if (s === undefined) return key;
    if (vars) {
        Object.keys(vars).forEach(function(k) {
            s = s.split('{' + k + '}').join(String(vars[k]));
        });
    }
    return s;
}
