// query.js — Mini-Query-Sprache fuer Filter-Suchfelder in der Tabelle.
//
// Syntax:
//   bare token             → match irgendwo (alle Felder konkateniert)
//   field:value            → match nur im Feld (host, label, ip, type,
//                            iftype, proxy, group)
//   "with spaces"          → quoted token (auch field:"foo bar")
//   -token                 → NOT
//   tokenA tokenB          → AND (implizit, default)
//   tokenA OR tokenB       → OR (Keyword, case-insensitive)
//   ( ... )                → Gruppierung
//
// Beispiele:
//   host:fox -tag:wartung
//   (host:foo OR host:bar) type:switch
//   proxy:"fox proxy"
//
// Public API:
//   parseQuery(text) → AST (oder null bei leerem Input)
//   matchQuery(ast, fields) → bool. fields ist {host: 'lowercase', ip: ...}
//   FIELD_PREFIXES — Set bekannter Field-Namen

export const FIELD_PREFIXES = ['host', 'label', 'ip', 'type', 'iftype', 'proxy', 'group'];
const _FIELD_SET = {};
FIELD_PREFIXES.forEach(function(f) { _FIELD_SET[f] = true; });

// Splittet Input in Roh-Tokens unter Beachtung von Quotes und Parens.
// Whitespace trennt, "..." gruppiert mit Leerzeichen, ( und ) sind eigene Tokens.
function _rawTokens(input) {
    const out = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < input.length; i++) {
        const c = input[i];
        if (inQuote) {
            if (c === '"') inQuote = false;
            else cur += c;
            continue;
        }
        if (c === '"') { inQuote = true; continue; }
        if (/\s/.test(c)) {
            if (cur) { out.push(cur); cur = ''; }
            continue;
        }
        if (c === '(' || c === ')') {
            if (cur) { out.push(cur); cur = ''; }
            out.push(c);
            continue;
        }
        cur += c;
    }
    if (cur) out.push(cur);
    return out;
}

// Wandelt Roh-Tokens in typisierte Tokens fuer den Parser.
function _tokenize(input) {
    return _rawTokens(input).map(function(raw) {
        if (raw === '(' || raw === ')') return { type: raw };
        const up = raw.toUpperCase();
        if (up === 'OR')  return { type: 'OR' };
        if (up === 'AND') return { type: 'AND' };
        // NOT-Prefix: nur wenn "-" am Anfang UND noch was danach kommt
        // (sonst fox-prx als "NOT prx" interpretiert worden).
        let neg = false;
        let body = raw;
        if (body[0] === '-' && body.length > 1) {
            neg = true;
            body = body.slice(1);
        }
        // Field-Prefix: nur wenn vor dem ":" ein bekanntes Feld steht.
        let field = null;
        let value = body;
        const ci = body.indexOf(':');
        if (ci > 0 && ci < body.length - 1) {
            const f = body.slice(0, ci).toLowerCase();
            if (_FIELD_SET[f]) {
                field = f;
                value = body.slice(ci + 1);
            }
        }
        return { type: 'ATOM', neg: neg, field: field, value: value.toLowerCase() };
    });
}

// Recursive-Descent-Parser. Operator-Praezedenz: OR < AND < NOT < Atom.
// Implicit-AND: zwei aufeinanderfolgende Atome ohne Operator = AND.
export function parseQuery(text) {
    if (!text || !text.trim()) return null;
    const tokens = _tokenize(text);
    if (tokens.length === 0) return null;
    let i = 0;
    function peek() { return tokens[i]; }
    function consume(t) {
        const tok = tokens[i];
        if (!tok) return null;
        if (t && tok.type !== t) return null;
        i++;
        return tok;
    }
    function parseOr() {
        let left = parseAnd();
        while (peek() && peek().type === 'OR') {
            consume('OR');
            const right = parseAnd();
            if (!right) break;
            left = { type: 'or', a: left, b: right };
        }
        return left;
    }
    function parseAnd() {
        let left = parsePrimary();
        if (!left) return null;
        while (peek()) {
            const t = peek().type;
            if (t === 'AND') {
                consume('AND');
                const right = parsePrimary();
                if (!right) break;
                left = { type: 'and', a: left, b: right };
            } else if (t === 'ATOM' || t === '(') {
                // Implicit-AND
                const right = parsePrimary();
                if (!right) break;
                left = { type: 'and', a: left, b: right };
            } else {
                break;
            }
        }
        return left;
    }
    function parsePrimary() {
        const t = peek();
        if (!t) return null;
        if (t.type === '(') {
            consume('(');
            const e = parseOr();
            consume(')');   // optional, parser robust gegen unclosed paren
            return e;
        }
        if (t.type === 'ATOM') {
            consume('ATOM');
            const atom = { type: 'match', field: t.field, value: t.value };
            return t.neg ? { type: 'not', a: atom } : atom;
        }
        return null;
    }
    return parseOr();
}

// Evaluiert den AST gegen ein fields-Objekt. fields[fieldname] muss bereits
// lowercase sein. fields._any wird fuer bare-Tokens (kein Field-Prefix)
// genutzt — Caller sollte das als Konkatenation aller Felder bauen.
export function matchQuery(ast, fields) {
    if (!ast) return true;
    switch (ast.type) {
        case 'match': {
            const hay = ast.field ? (fields[ast.field] || '') : (fields._any || '');
            return hay.indexOf(ast.value) >= 0;
        }
        case 'not':
            return !matchQuery(ast.a, fields);
        case 'and':
            return matchQuery(ast.a, fields) && matchQuery(ast.b, fields);
        case 'or':
            return matchQuery(ast.a, fields) || matchQuery(ast.b, fields);
    }
    return true;
}

// Helper: baut das fields-Objekt aus einem Host-Node fuer beide Filter
// (Tabelle Hosts-Modus + Items-Modus). Hostname/Label/IP/Proxy/Group/Type/Iftype.
//
// _any wird fuer bare-Tokens (ohne Field-Prefix) benutzt und enthaelt
// BEWUSST nur host/label/ip — NICHT proxy/group/type/iftype. Sonst matched
// "prx" alle Hosts wenn der Proxy "fox-prx" heisst. Wer in diesen
// Sekundaer-Feldern suchen will, nutzt den jeweiligen Field-Prefix.
export function nodeToQueryFields(n) {
    const fHost   = ((n.host || '') + ' ' + (n.label || '')).toLowerCase();
    const fIp     = (n.ip || '').toLowerCase();
    const fType   = (n.type || '').toLowerCase();
    const fIftype = (n.iftype || '').toLowerCase();
    const fProxy  = ((n.proxy_name || '') + ' ' + (n.proxy_group_name || '')).toLowerCase();
    const fGroup  = (n.groups || []).join(' ').toLowerCase();
    return {
        host:   fHost,
        label:  fHost,
        ip:     fIp,
        type:   fType,
        iftype: fIftype,
        proxy:  fProxy,
        group:  fGroup,
        _any:   fHost + ' ' + fIp,
    };
}
