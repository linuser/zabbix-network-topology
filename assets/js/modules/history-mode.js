// history-mode.js — History-Slider zum Zurückspielen vergangener
// Trigger-Status. Aktiviert per Toolbar-Button.
//
// Bedienung:
//   - Toggle-Button "🕐 Historie" in der Toolbar
//   - Bei Aktivierung: Slider-Bar zwischen Toolbar und Canvas
//   - Range-Dropdown: 1h / 24h / 7d
//   - Slider: setzt Cursor-Position im Range
//   - Play/Pause: schrittweises Auto-Forward (Step = Range/100)
//   - ✕ verlässt History-Mode → wieder Live
//
// Effekt auf die Map (alle Tabs):
//   - Hosts ohne aktives Problem zur Cursor-Zeit: opacity 0.3
//   - Hosts mit aktivem Problem: ihre damalige Severity-Farbe
//   - Live-Refresh ist im History-Mode pausiert
//
// Datenfluss:
//   - Beim Range-Wechsel oder Aktivierung: ein Backend-Call
//     (network.topology.history?from=...&to=...&groupids[]=...)
//   - Antwort wird gecached (im Modul)
//   - Slider-Move filtert clientseitig: pro Host wird die zur Zeit T
//     aktive Severity berechnet (höchste sev der zu T offenen Trigger)
//   - Re-Render via _ntRender() — der Render holt sich die berechneten
//     Severities aus _ntHistoryActive

import { t } from './i18n.js';

let _active = false;
let _bar = null;
let _slider = null;
let _timeLabel = null;
let _rangeSel = null;
let _playBtn = null;
let _playTimer = null;
let _playSpeed = 1;     // 1x = 1 Step pro Sekunde
let _eventsCache = null;       // { from, to, events, fetchedAt }
let _currentTs = 0;            // aktueller Cursor-Timestamp
let _liveRefreshPauseFn = null;  // Callback um Live-Refresh zu pausieren
let _liveRefreshResumeFn = null;
let _renderFn = function() {};

// Re-Render-Callback — wird vom Hauptmodul gesetzt damit history-mode
// einen Re-Render triggern kann.
export function setHistoryRenderCallback(fn) { _renderFn = fn; }

// Live-Refresh Pause/Resume — gesetzt vom Hauptmodul (Auto-Refresh-Timer)
export function setLiveRefreshHooks(pauseFn, resumeFn) {
    _liveRefreshPauseFn = pauseFn;
    _liveRefreshResumeFn = resumeFn;
}

const RANGE_PRESETS = [
    { lbl: '1h', sec: 3600 },
    { lbl: '24h', sec: 86400 },
    { lbl: '7d', sec: 7 * 86400 },
];

function fmtTs(ts) {
    const d = new Date(ts * 1000);
    const pad = function(n) { return n < 10 ? '0' + n : '' + n; };
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.'
        + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function buildBaseUrl() {
    const p = window.location.pathname;
    const i = p.indexOf('/zabbix.php');
    return i > 0 ? p.substring(0, i + 1) : '/';
}

// Berechnet pro Host die aktive Severity zum Timestamp ts.
// Ein Host hat ein aktives Problem wenn ein PROBLEM-Event (val=1) vor ts
// liegt UND kein RECOVERY-Event (val=0) mit gleichem Trigger-Namen
// dazwischen kam. Höchste Severity aller aktiven Probleme = Host-Severity.
//
// Returns: { hostid: severity, ... } — nur Hosts mit aktivem Problem.
function computeSeveritiesAt(ts) {
    if (!_eventsCache || !_eventsCache.events) return {};
    const result = {};
    Object.keys(_eventsCache.events).forEach(function(hid) {
        const evs = _eventsCache.events[hid] || [];
        const open = {};   // name → severity, falls offen zum Zeitpunkt ts
        for (let i = 0; i < evs.length; i++) {
            const e = evs[i];
            if (e.ts > ts) break;
            if (e.val === 1) {
                open[e.name] = e.sev;
            } else {
                delete open[e.name];
            }
        }
        // Höchste offene Severity
        let max = 0;
        Object.keys(open).forEach(function(n) {
            if (open[n] > max) max = open[n];
        });
        if (max > 0) result[hid] = max;
    });
    return result;
}

// Public — wird vom Render-Code aufgerufen (render-tech, render-mgmt etc.)
// um die History-Severities anzuwenden.
export function isHistoryActive() { return _active; }
export function getHistorySeverities() {
    if (!_active) return null;
    return computeSeveritiesAt(_currentTs);
}

async function fetchHistory(rangeSec) {
    const cfg = window.NT_CONFIG;
    const groupids = (cfg && cfg.selected_groupids) || [];
    if (!groupids.length) return null;

    const now = Math.floor(Date.now() / 1000);
    const from = now - rangeSec;
    const to = now;

    const params = new URLSearchParams();
    params.append('action', 'network.topology.history');
    params.append('from', String(from));
    params.append('to', String(to));
    groupids.forEach(function(g) { params.append('groupids[]', String(g)); });

    const url = buildBaseUrl() + 'zabbix.php?' + params.toString();
    try {
        const resp = await fetch(url, {
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        const data = await resp.json();
        if (data.error) {
            console.warn('History fetch error:', data.error);
            return null;
        }
        return {
            from: data.from,
            to: data.to,
            events: data.events || {},
            truncated: !!data.truncated,
            fetchedAt: Date.now(),
        };
    } catch (e) {
        console.error('History fetch failed:', e);
        return null;
    }
}

function updateTimeLabel() {
    if (_timeLabel) _timeLabel.textContent = fmtTs(_currentTs);
}

function setSliderRange() {
    if (!_eventsCache || !_slider) return;
    _slider.min = String(_eventsCache.from);
    _slider.max = String(_eventsCache.to);
    _slider.value = String(_currentTs);
}

// Sequence-Counter für race-condition-Schutz: User kann schnell Range
// wechseln (1h → 24h → 7d → 24h). Ohne Sequenz würde der zuletzt
// returned-fetch _eventsCache überschreiben — auch wenn er veraltet ist.
let _fetchSeq = 0;

async function applyRange(rangeSec) {
    if (_bar) _bar.style.opacity = '0.5';
    const seq = ++_fetchSeq;
    const data = await fetchHistory(rangeSec);
    if (seq !== _fetchSeq) return;   // neuere Anfrage in flight → diese verwerfen
    if (_bar) _bar.style.opacity = '1';
    if (!data) {
        if (_timeLabel) _timeLabel.textContent = t('hist.load_error');
        return;
    }
    _eventsCache = data;
    _currentTs = data.to;     // Start am Ende des Range
    setSliderRange();
    updateTimeLabel();
    _renderFn();
}

function buildBar() {
    const bar = document.createElement('div');
    bar.id = 'nt-history-bar';
    bar.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 12px;'
        + 'background:#fef3c7;border-bottom:1px solid #fcd34d;flex-wrap:wrap;'
        + 'transition:opacity 0.2s';

    // Icon + Label
    const lbl = document.createElement('span');
    lbl.innerHTML = '\u{1F551} <strong>' + t('hist.title') + '</strong>';
    lbl.style.cssText = 'font-size:13px;color:#78350f';
    bar.appendChild(lbl);

    // Range-Dropdown
    const rangeSel = document.createElement('select');
    rangeSel.id = 'nt-history-range';
    rangeSel.style.cssText = 'padding:3px 6px;border:1px solid var(--nt-faint,#cbd5e1);border-radius:4px;'
        + 'font-size:12px;background:var(--nt-surface,#fff)';
    RANGE_PRESETS.forEach(function(r, i) {
        const opt = document.createElement('option');
        opt.value = String(r.sec);
        opt.textContent = r.lbl;
        if (i === 1) opt.selected = true;   // Default 24h
        rangeSel.appendChild(opt);
    });
    bar.appendChild(rangeSel);
    _rangeSel = rangeSel;

    // Slider
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = 'nt-history-slider';
    slider.style.cssText = 'flex:1;min-width:200px;cursor:pointer';
    bar.appendChild(slider);
    _slider = slider;

    // Zeit-Anzeige
    const tl = document.createElement('span');
    tl.id = 'nt-history-time';
    tl.style.cssText = 'font-family:monospace;font-size:12px;color:var(--nt-text,#0f172a);'
        + 'font-weight:700;min-width:130px;text-align:center;'
        + 'background:var(--nt-surface,#fff);padding:3px 8px;border-radius:4px;border:1px solid #fcd34d';
    tl.textContent = '\u2014';
    bar.appendChild(tl);
    _timeLabel = tl;

    // Play/Pause-Button
    const play = document.createElement('button');
    play.id = 'nt-history-play';
    play.textContent = '\u25B6';   // ▶
    play.style.cssText = 'padding:3px 10px;border:1px solid var(--nt-faint,#cbd5e1);border-radius:4px;'
        + 'background:var(--nt-surface,#fff);cursor:pointer;font-size:13px;color:var(--nt-text-2,#475569)';
    play.title = t('hist.play_pause');
    bar.appendChild(play);
    _playBtn = play;

    // Verlassen
    const close = document.createElement('button');
    close.textContent = t('hist.close');
    close.style.cssText = 'padding:3px 10px;border:1px solid var(--nt-faint,#cbd5e1);border-radius:4px;'
        + 'background:var(--nt-surface,#fff);cursor:pointer;font-size:12px;color:var(--nt-text-2,#475569);margin-left:auto';
    bar.appendChild(close);

    // Wiring
    rangeSel.addEventListener('change', function() {
        applyRange(parseInt(this.value, 10));
    });

    let _sliderTimer = null;
    slider.addEventListener('input', function() {
        _currentTs = parseInt(this.value, 10);
        updateTimeLabel();
        // Debounce Re-Render damit Slider flüssig bleibt
        if (_sliderTimer) clearTimeout(_sliderTimer);
        _sliderTimer = setTimeout(function() { _renderFn(); }, 50);
    });

    play.addEventListener('click', function() {
        if (_playTimer) {
            clearInterval(_playTimer);
            _playTimer = null;
            play.textContent = '\u25B6';
        } else {
            play.textContent = '\u23F8';   // ⏸
            _playTimer = setInterval(function() {
                if (!_eventsCache) return;
                const range = _eventsCache.to - _eventsCache.from;
                const step = Math.max(1, Math.floor(range / 100));
                _currentTs += step * _playSpeed;
                if (_currentTs >= _eventsCache.to) {
                    _currentTs = _eventsCache.to;
                    clearInterval(_playTimer);
                    _playTimer = null;
                    play.textContent = '\u25B6';
                }
                slider.value = String(_currentTs);
                updateTimeLabel();
                _renderFn();
            }, 1000);
        }
    });

    close.addEventListener('click', deactivate);

    return bar;
}

function activate() {
    if (_active) return;
    _active = true;

    // Live-Refresh pausieren
    if (_liveRefreshPauseFn) try { _liveRefreshPauseFn(); } catch (e) {}

    // Bar ins DOM einfügen — direkt nach der Toolbar
    const topbar = document.querySelector('.nt-topbar');
    if (!topbar || !topbar.parentNode) return;
    if (!_bar) _bar = buildBar();
    topbar.parentNode.insertBefore(_bar, topbar.nextSibling);

    // Default-Range laden
    applyRange(parseInt(_rangeSel.value, 10));

    // Toggle-Button visuell aktiv markieren
    const btn = document.getElementById('nt-btn-history');
    if (btn) {
        btn.style.background = '#fbbf24';
        btn.style.color = '#78350f';
    }
}

function deactivate() {
    if (!_active) return;
    _active = false;

    if (_playTimer) { clearInterval(_playTimer); _playTimer = null; }
    if (_bar && _bar.parentNode) _bar.parentNode.removeChild(_bar);
    _bar = null; _slider = null; _timeLabel = null; _rangeSel = null; _playBtn = null;
    _eventsCache = null;
    _currentTs = 0;

    // Toggle-Button zurück
    const btn = document.getElementById('nt-btn-history');
    if (btn) {
        btn.style.background = '';
        btn.style.color = '';
    }

    // Live-Refresh wieder an
    if (_liveRefreshResumeFn) try { _liveRefreshResumeFn(); } catch (e) {}

    // Re-Render damit die Live-Severities wieder erscheinen
    _renderFn();
}

function toggleHistoryMode() {
    if (_active) deactivate();
    else activate();
}

// Toggle-Button in der Toolbar anlegen — wird vom Toolbar-Setup aufgerufen.
export function addHistoryButton(bar, isFirstRun) {
    if (!bar || !isFirstRun) return;
    if (document.getElementById('nt-btn-history')) return;
    const b = document.createElement('button');
    b.id = 'nt-btn-history';
    b.className = 'btn-alt btn-small';
    b.style.marginLeft = '4px';
    b.textContent = t('hist.button');
    b.title = t('hist.button.tip');
    b.addEventListener('click', toggleHistoryMode);
    bar.appendChild(b);
}
