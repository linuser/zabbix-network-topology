// aggregation.js — Group-View Aggregation.
//
// Verschmilzt alle Hosts einer Host-Gruppe (n._primaryGroup) zu einem einzelnen
// Pseudo-Node und rechnet Edges zwischen verschiedenen Gruppen zu Aggregat-Edges
// um. Pure Function, keine Seiteneffekte — gut isolierbar und testbar.
//
// Eingabe-Nodes brauchen das _primaryGroup-Feld (wird in render() via
// primaryGroup() aus severity.js gesetzt).

import { t } from './i18n.js';

export function aggregateByGroup(nodes, edges) {
    // Hosts nach Gruppe bündeln
    const groups = {};
    nodes.forEach(function(n) {
        const g = n._primaryGroup || t('agg.no_group');
        if (!groups[g]) groups[g] = [];
        groups[g].push(n);
    });

    const aggNodes = [];
    const nodeToGroup = {};   // hostId -> groupName (für Edge-Aggregation)

    Object.keys(groups).forEach(function(gname) {
        const children = groups[gname];
        children.forEach(function(c) { nodeToGroup[String(c.id)] = gname; });

        let maxSev = 0, sumProblems = 0;
        let cpuSum = 0, cpuCnt = 0, memSum = 0, memCnt = 0, pingMin = null;
        let trIn = 0, trOut = 0;
        let allAcked = true;       // alle Probleme in der Gruppe acked?
        let anyProblems = false;
        let allMaintenance = true; // alle Hosts in Wartung?
        const topProblems = [];

        children.forEach(function(c) {
            const s = c.severity || 0;
            if (s > maxSev) maxSev = s;
            sumProblems += (c.problems || 0);
            if (c.cpu    != null && !isNaN(c.cpu))    { cpuSum += c.cpu; cpuCnt++; }
            if (c.memory != null && !isNaN(c.memory)) { memSum += c.memory; memCnt++; }
            if (c.ping   != null && c.ping > 0) {
                if (pingMin === null || c.ping < pingMin) pingMin = c.ping;
            }
            if (c.traffic) {
                trIn  += c.traffic.in  || 0;
                trOut += c.traffic.out || 0;
            }
            // Acked-Aggregation: Gruppe gilt nur als acked, wenn alle Hosts
            // mit Problemen ihre Probleme acked haben.
            if ((c.problems || 0) > 0) {
                anyProblems = true;
                if (!c.acknowledged) allAcked = false;
            }
            if (!c.maintenance) allMaintenance = false;
            if (s >= 3) topProblems.push({ label: c.label || c.host || c.id, sev: s });
        });
        topProblems.sort(function(a, b) { return b.sev - a.sev; });

        aggNodes.push({
            id:      'grp_' + gname,
            label:   gname + ' (' + children.length + ')',
            host:    gname,
            ip:      null,
            type:    'group',
            iftype:  null,
            severity: maxSev,
            problems: sumProblems,
            acknowledged: anyProblems && allAcked,
            maintenance:  allMaintenance,
            cpu:    cpuCnt ? Math.round(cpuSum / cpuCnt) : null,
            memory: memCnt ? Math.round(memSum / memCnt) : null,
            ping:   pingMin,
            traffic: { in: trIn, out: trOut },
            groups: [gname],
            _primaryGroup: gname,
            _isAggregate: true,
            _childCount: children.length,
            _topProblems: topProblems.slice(0, 3)
        });
    });

    // Edges aggregieren: Edges innerhalb derselben Gruppe entfallen,
    // Cross-Group-Edges werden zu einer einzelnen Edge mit Summen-Counter.
    const aggEdgeMap = {};
    edges.forEach(function(e) {
        const src = String(e.source || e.from || '');
        const tgt = String(e.target || e.to || '');
        const srcGroup = nodeToGroup[src];
        const tgtGroup = nodeToGroup[tgt];
        if (!srcGroup || !tgtGroup || srcGroup === tgtGroup) return;

        const key = [srcGroup, tgtGroup].sort().join('|');
        if (!aggEdgeMap[key]) {
            aggEdgeMap[key] = {
                source: 'grp_' + srcGroup,
                target: 'grp_' + tgtGroup,
                count: 0
            };
        }
        aggEdgeMap[key].count++;
    });
    const aggEdges = Object.keys(aggEdgeMap).map(function(k) { return aggEdgeMap[k]; });

    return { nodes: aggNodes, edges: aggEdges };
}
