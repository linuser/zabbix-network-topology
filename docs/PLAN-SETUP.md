# Plan view — Network Topology for Zabbix

Put a **background image** — an aerial photo, a site plan, a floor plan — behind
the map and drag your devices onto their **real physical spot**. The classic
Wi-Fi planning view (UniFi/Ekahau), but with the live Zabbix status on every
marker. Works indoors too, where a satellite map is useless.

*[← Documentation index](README.md)*

**🇬🇧 English**

> Opt-in and non-destructive. Without a background image the Plan tab just shows
> an empty state with a prompt; nothing else changes.

---

## What it is

A new **Plan** tab next to Geo. Unlike Geo (which places hosts by their real
`location_lat`/`location_lon` on map tiles), Plan draws a **static image** and
lets you place markers on it in **image pixels** — positions the module owns and
saves. Edges (LLDP/CDP) are drawn between placed markers; unplaced devices wait
in a side list until you drop them onto the image.

---

## The background image lives in Zabbix

The image itself is stored in **Zabbix's own image store** — the same one the
built-in network maps use for their backgrounds:

- **Pick an existing one.** *Administration → General → Images* holds images of
  type **Background**. Any of them shows up in the Plan tab's picker (top right).
- **Upload a new one** straight from the Plan tab (**Super admins only** — that is
  Zabbix's limit on `image.create`, not ours). Zabbix enforces the format
  (PNG/JPEG/GIF, WebP on newer versions) and a **1 MB** cap; the module downscales
  a large file in the browser first so it fits.
- **Or reference a URL** instead — the module then stores only the URL and the
  browser loads the image directly. Use this for a large image you do not want in
  Zabbix's store.

The module itself stores only a tiny **reference** (an `imageid` or a URL) per
view — never the image bytes, and never in the page bootstrap. The image is
fetched lazily, only when you open the Plan tab.

> **No Google Earth / Maps tiles.** Those are license-locked and cannot be used
> as a product background. Bring your own licensed image (a Google Earth **Pro**
> export is fine if you are entitled to it).

---

## Placing devices

- Open **Plan**, choose or upload a background.
- Click a device in the **Unplaced** list (top left) to drop it onto the image,
  then **drag** it to the exact spot.
- Positions are saved automatically, the same two-level way as the graph layout:
  a **Super admin** writes the **shared** plan everyone sees; everyone else saves
  their **own** placement on top of it. A placement follows the shared plan until
  you move it.

Positions are tied to the current **host-group selection** (like the graph
layout), so a different selection can have its own plan.

---

## On a dashboard — the NT Plan widget

The **NT Plan** widget shows the same thing as a **read-only dashboard tile**: the
background image with every placed device, coloured by severity/status. Add it to
a dashboard and set its **Host groups** to the same selection you used to set up
the plan in the module — the widget then shows that selection's shared background
and placement. Toggle *Show device labels* to name the markers; hover any marker
for host, status and open-problem count. Placement stays in the module's Plan tab;
the widget only displays it. (It needs the main module installed and enabled.)

## Summary

| You do | You get |
|---|---|
| nothing | an empty Plan tab with a prompt |
| pick/upload a Background image (or set a URL) | the image behind the map |
| drag devices onto it | each device at its real spot, with live status |

Everything here is opt-in: the other views are untouched, and the plan is stored
next to (not instead of) the graph layout.
