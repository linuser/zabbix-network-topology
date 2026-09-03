// color-scales-ui.js — editor for the link color scales (super admin).
//
// Two scales: absolute traffic (weathermap off) and utilization in % of link
// capacity (weathermap on). One color and one exclusive upper bound per tier;
// the last color applies above the last bound.
//
// Changes paint into the map immediately (preview) and refresh the color
// guide — you see what you are doing. Cancel restores the saved state; Save
// sends the draft to network.topology.scales (module.config, applies to all
// users). The backend validates again.
//
// Everything in the panel is built with the DOM API and textContent — no HTML
// strings, even though only our own translations and numbers appear here: the
// editor is where colors enter the map as CSS values, so the pattern should
// be right.

import { t } from './i18n.js';
import { toast } from './toast.js';
import { el, fmt } from './utils.js';
import { MAX_SCALE_COLORS, getColorScales, hasCustomScales, normalizeScales,
         applyColorScales, applyTrafficHeatmap } from './traffic.js';
import { refreshBottomLegend } from './legend.js';

const UNITS = [['b/s', 1], ['Kb/s', 1e3], ['Mb/s', 1e6], ['Gb/s', 1e9]];

function unitIndexFor(bps) {
    for (let i = UNITS.length - 1; i >= 0; i--) if (bps >= UNITS[i][1]) return i;
    return 0;
}

function fmtBound(bps) { return fmt(bps).replace('.0 ', ' '); }

function repaint() {
    applyTrafficHeatmap(window._ntCy);
    refreshBottomLegend();
}

function post(fields) {
    const cfg  = window.NT_CONFIG || {};
    const body = new URLSearchParams();
    Object.keys(fields).forEach(function(k) { body.set(k, fields[k]); });
    body.set('nt_csrf', cfg.scales_csrf || '');
    return fetch(cfg.scales_url || 'zabbix.php?action=network.topology.scales', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest',
                   'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
        if (!d || d.error) throw new Error((d && d.error) || 'unknown');
        return d;
    });
}

export function openColorScalesPanel(wrap, dark) {
    if (!wrap) return;
    const old = document.getElementById('nt-scales-overlay');
    if (old) { old.remove(); return; }             // second click closes

    const savedCustom = hasCustomScales();
    const saved = getColorScales();                // for Cancel
    const draft = getColorScales();                // being edited

    const bg  = dark ? '#161b22' : '#ffffff';
    const bdr = dark ? '#30363d' : '#dfe4e7';
    const txt = dark ? '#e6edf3' : '#1f2c33';
    const sub = dark ? '#8b949e' : '#64748b';
    const inputCss = 'padding:2px 4px;border:1px solid ' + bdr + ';border-radius:4px;'
        + 'background:' + bg + ';color:' + txt + ';font-size:12px';

    function mkBtn(label, fn, primary) {
        const b = el('button', 'padding:3px 9px;border-radius:4px;cursor:pointer;font-size:11.5px;'
            + 'border:1px solid ' + (primary ? '#0275b8' : bdr) + ';'
            + 'background:' + (primary ? '#0275b8' : 'transparent') + ';'
            + 'color:' + (primary ? '#fff' : txt), label);
        b.type = 'button';
        b.addEventListener('click', fn);
        return b;
    }

    // Modal over the canvas: the backdrop sits above every canvas overlay
    // (detail panel z=50, minimap z=40, refresh badge z=9) but below the
    // toolbar menus (9000) and toasts (10000). Without it the detail panel
    // and the minimap painted over the Save/Cancel footer in the corner.
    // A click on the backdrop cancels, as does Escape.
    const overlay = el('div', 'position:absolute;inset:0;z-index:500;display:flex;'
        + 'align-items:flex-start;justify-content:flex-end;padding:10px;box-sizing:border-box;'
        + 'background:' + (dark ? 'rgba(0,0,0,0.45)' : 'rgba(15,23,42,0.28)'));
    overlay.id = 'nt-scales-overlay';

    // The panel is a column: header, scrolling body, fixed footer — so Save
    // and Cancel stay visible however many tiers the scales have.
    const panel = el('div', 'position:relative;display:flex;flex-direction:column;width:360px;'
        + 'max-width:100%;max-height:100%;box-sizing:border-box;'
        + 'background:' + bg + ';color:' + txt + ';border:1px solid ' + bdr + ';border-radius:8px;'
        + 'box-shadow:0 6px 24px rgba(0,0,0,0.25);font-family:sans-serif;font-size:12px');
    panel.id = 'nt-scales-panel';
    const head = el('div', 'padding:10px 12px 0;flex:0 0 auto');
    head.appendChild(el('div', 'font-weight:700;font-size:13px;margin-bottom:2px', t('scales.title')));
    head.appendChild(el('div', 'color:' + sub + ';font-size:10.5px;margin-bottom:8px;line-height:1.35', t('scales.hint')));
    panel.appendChild(head);

    const sections = el('div', 'padding:0 12px;overflow:auto;flex:1 1 auto;min-height:0');
    panel.appendChild(sections);

    function preview() {
        const norm = normalizeScales(draft);
        if (norm) { applyColorScales(norm); repaint(); }
    }

    function renderSections() {
        sections.textContent = '';
        [['traffic', t('scales.traffic')], ['util', t('scales.util')]].forEach(function(def) {
            const key = def[0], scale = draft[key];
            const sec = el('div', 'margin-bottom:10px;padding-top:6px;border-top:1px solid ' + bdr);
            sec.appendChild(el('div', 'font-weight:600;margin-bottom:4px', def[1]));

            scale.colors.forEach(function(col, i) {
                const row = el('div', 'display:flex;align-items:center;gap:6px;margin-bottom:3px');
                const cin = el('input', 'width:28px;height:22px;padding:0;border:1px solid ' + bdr
                    + ';background:none;cursor:pointer');
                cin.type = 'color';
                cin.value = col;
                cin.addEventListener('input', function() { scale.colors[i] = cin.value; preview(); });
                row.appendChild(cin);

                if (i < scale.bounds.length) {
                    row.appendChild(el('span', 'color:' + sub, '<'));
                    const nin = el('input', inputCss + ';width:84px');
                    nin.type = 'number'; nin.step = 'any'; nin.min = '0';
                    let factor = 1;
                    const commit = function() {
                        const v = parseFloat(nin.value);
                        if (isFinite(v)) { scale.bounds[i] = v * factor; preview(); }
                    };
                    if (key === 'traffic') {
                        const ui = unitIndexFor(scale.bounds[i]);
                        factor = UNITS[ui][1];
                        nin.value = String(+(scale.bounds[i] / factor).toPrecision(6));
                        const sel = el('select', inputCss);
                        UNITS.forEach(function(u, k) {
                            const o = el('option', null, u[0]);
                            o.value = String(k);
                            if (k === ui) o.selected = true;
                            sel.appendChild(o);
                        });
                        sel.addEventListener('change', function() { factor = UNITS[+sel.value][1]; commit(); });
                        row.appendChild(nin);
                        row.appendChild(sel);
                    } else {
                        nin.value = String(scale.bounds[i]);
                        row.appendChild(nin);
                        row.appendChild(el('span', 'color:' + sub, '%'));
                    }
                    nin.addEventListener('change', commit);
                } else {
                    const last = scale.bounds[scale.bounds.length - 1];
                    row.appendChild(el('span', 'color:' + sub,
                        t('scales.above', { v: key === 'traffic' ? fmtBound(last) : last + '%' })));
                }
                sec.appendChild(row);
            });

            const ctl = el('div', 'display:flex;gap:6px;margin-top:4px');
            ctl.appendChild(mkBtn(t('scales.add'), function() {
                if (scale.colors.length >= MAX_SCALE_COLORS) return;
                const last = scale.bounds[scale.bounds.length - 1];
                scale.bounds.push(key === 'traffic' ? last * 10 : Math.min(999, last + 10));
                scale.colors.push(scale.colors[scale.colors.length - 1]);
                renderSections(); preview();
            }));
            ctl.appendChild(mkBtn(t('scales.remove'), function() {
                if (scale.colors.length <= 2) return;
                scale.bounds.pop(); scale.colors.pop();
                renderSections(); preview();
            }));
            sec.appendChild(ctl);
            sections.appendChild(sec);
        });
    }
    renderSections();

    // Footer: Reset (server) · Cancel (revert locally) · Save
    const foot = el('div', 'display:flex;gap:6px;justify-content:flex-end;flex:0 0 auto;'
        + 'padding:8px 12px 10px;border-top:1px solid ' + bdr);
    let bReset, bCancel, bSave;
    function busy(on) { [bReset, bCancel, bSave].forEach(function(b) { b.disabled = on; }); }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(false); } }
    function close(keep) {
        if (!keep) { applyColorScales(savedCustom ? saved : null); repaint(); }
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
    }
    function fail(err) {
        busy(false);
        toast(t('scales.save_failed', { err: (err && err.message) || '?' }), 'error', 6000);
    }
    bReset = mkBtn(t('scales.reset'), function() {
        busy(true);
        post({ reset: '1' }).then(function() {
            applyColorScales(null); repaint();
            toast(t('scales.reset_done'), 'info', 3000);
            close(true);
        }).catch(fail);
    });
    bCancel = mkBtn(t('scales.cancel'), function() { close(false); });
    bSave = mkBtn(t('scales.save'), function() {
        const norm = normalizeScales(draft);
        if (!norm) { toast(t('scales.invalid'), 'error', 4000); return; }
        busy(true);
        post({ scales: JSON.stringify(norm) }).then(function(d) {
            applyColorScales(d.scales || norm); repaint();
            toast(t('scales.saved'), 'success', 3000);
            close(true);
        }).catch(fail);
    }, true);
    bReset.style.marginRight = 'auto';
    foot.appendChild(bReset); foot.appendChild(bCancel); foot.appendChild(bSave);
    panel.appendChild(foot);

    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(false); });
    // Keep map handlers from seeing clicks/wheel inside the modal.
    ['mousedown', 'mouseup', 'wheel', 'touchstart'].forEach(function(evt) {
        panel.addEventListener(evt, function(e) { e.stopPropagation(); }, { passive: true });
    });
    document.addEventListener('keydown', onKey, true);
    overlay.appendChild(panel);
    wrap.appendChild(overlay);
}
