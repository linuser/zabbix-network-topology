# Third-Party Licenses

**Network Topology for Zabbix** (module id `network_topology_v6`) is licensed under
**AGPL-3.0-or-later** (see [LICENSE](LICENSE)).

It bundles and redistributes the third-party components listed below. Each is
distributed under its own license, reproduced in full. All are permissive
(MIT / BSD-2-Clause) and compatible with AGPL-3.0.

The module's own bundled frontend code (`assets/js/dist/nt-bundle.js`) contains
**only first-party code** — Cytoscape.js and Leaflet are loaded as external globals
from the vendor files below and are **not** part of the bundle.

| Component | Version | Files | License |
|---|---|---|---|
| Cytoscape.js | bundled copy (© 2016–2023) | `assets/js/cytoscape.min.js` | MIT |
| Leaflet | 1.9.4 | `assets/js/leaflet/leaflet.js`, `leaflet.css`, `marker-icon*.png`, `marker-shadow.png`, `layers*.png` | BSD-2-Clause |

> **Map tiles** (Geo view) are served at runtime by external providers (e.g. OpenStreetMap)
> and are **not** bundled. Their attribution is displayed by Leaflet's attribution control
> in the map, per each provider's terms.

---

## Cytoscape.js

Graph/topology rendering engine — <https://js.cytoscape.org>

```
Copyright (c) 2016-2023, The Cytoscape Consortium.

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN
AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

---

## Leaflet

Interactive maps for the Geo view — <https://leafletjs.com>

```
BSD 2-Clause License

Copyright (c) 2010-2023, Vladimir Agafonkin
Copyright (c) 2010-2011, CloudMade
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
