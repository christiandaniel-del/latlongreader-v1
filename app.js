// ============================================================
// AVIATION DATA INTEGRATOR PRO – v3.0
// Improved Navtech parser with two‑column support
// ============================================================

// --- GLOBALS ---
let map;
let activeTab = 'navtech';
const layers = { navtech: L.layerGroup(), vona: L.layerGroup(), notam: L.layerGroup(), tc: L.layerGroup() };
let storedData = { navtech: { coords: [], polyline: null, markers: [] }, vona: null, notam: [], tc: null };
let routeCoords = [];
let vonaPolygons = [];
let notamPolygons = [];
let tcPolygons = [];
let isRulerActive = false;
let rulerPoints = [];
let rulerLayer;
let rulerTempLine = null;
let rulerTempMarker = null;
let rulerTooltip = null;
const MAX_POINTS = 2000;
const NOTAM_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

// --- UTILITY FUNCTIONS ---

// Normalize input: trim, remove weird chars, unify spaces
function normalizeInput(text) {
    return text.replace(/\r\n/g, '\n')
               .replace(/=\s*$/gm, '')
               .replace(/[\u2018\u2019]/g, "'")
               .replace(/[\u201C\u201D]/g, '"')
               .trim();
}

// Convert DMS to decimal (supports many formats including decimal seconds)
function dmsToDecimal(dmsStr) {
    if (!dmsStr) return null;
    let clean = dmsStr.toUpperCase().replace(/\s/g, '').replace(/,/g, '.');
    let dirMatch = clean.match(/[NSEW]/);
    if (!dirMatch) return null;
    let dir = dirMatch[0];
    let numPart = clean.replace(/[NSEW]/g, '');
    
    // Check if it's already a decimal degree (e.g., 21.6N or 107.9)
    if (numPart.includes('.') && numPart.indexOf('.') === numPart.lastIndexOf('.')) {
        // If there are only a few digits before the dot, it's likely decimal degrees
        // (DD.DDDD or DDD.DDDD)
        let integerPart = numPart.split('.')[0];
        if (integerPart.length <= 3) {
            let dec = parseFloat(numPart);
            if (dir === 'S' || dir === 'W') dec *= -1;
            return dec;
        }
    }

    let isLat = (dir === 'N' || dir === 'S');
    let d = 0, m = 0, s = 0;
    
    // Process based on length (DDMMSS.S or DDDMMSS.S)
    let dotIdx = numPart.indexOf('.');
    let integerPart = dotIdx !== -1 ? numPart.substring(0, dotIdx) : numPart;
    let decimalPart = dotIdx !== -1 ? numPart.substring(dotIdx) : "";

    if (isLat) {
        if (integerPart.length >= 6) {
            d = parseInt(integerPart.slice(0, 2));
            m = parseInt(integerPart.slice(2, 4));
            s = parseFloat(integerPart.slice(4) + decimalPart);
        } else if (integerPart.length >= 4) {
            d = parseInt(integerPart.slice(0, 2));
            m = parseFloat(integerPart.slice(2) + decimalPart);
        } else {
            d = parseFloat(numPart);
        }
    } else {
        if (integerPart.length >= 7) {
            d = parseInt(integerPart.slice(0, 3));
            m = parseInt(integerPart.slice(3, 5));
            s = parseFloat(integerPart.slice(5) + decimalPart);
        } else if (integerPart.length >= 5) {
            d = parseInt(integerPart.slice(0, 3));
            m = parseFloat(integerPart.slice(3) + decimalPart);
        } else {
            d = parseFloat(numPart);
        }
    }
    
    if (isNaN(d)) return null;
    let dec = d + (m || 0)/60 + (s || 0)/3600;
    if (dir === 'S' || dir === 'W') dec *= -1;
    return dec;
}

// Try to parse coordinate from various formats
function parseCoordinate(latStr, lngStr) {
    let lat = parseFloat(latStr);
    let lng = parseFloat(lngStr);
    if (!isNaN(lat) && !isNaN(lng) && lat>=-90 && lat<=90 && lng>=-180 && lng<=180) {
        return { lat, lng };
    }
    lat = dmsToDecimal(latStr);
    lng = dmsToDecimal(lngStr);
    if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
        return { lat, lng };
    }
    return null;
}

// Destination point (great-circle)
function destinationPoint(lat, lng, brngDeg, distNM) {
    const R = 3440.065;
    const brng = brngDeg * Math.PI / 180;
    const lat1 = lat * Math.PI / 180;
    const lng1 = lng * Math.PI / 180;
    const d = distNM / R;
    const lat2 = Math.asin(Math.sin(lat1)*Math.cos(d) + Math.cos(lat1)*Math.sin(d)*Math.cos(brng));
    const lng2 = lng1 + Math.atan2(Math.sin(brng)*Math.sin(d)*Math.cos(lat1), Math.cos(d)-Math.sin(lat1)*Math.sin(lat2));
    return { lat: lat2*180/Math.PI, lng: lng2*180/Math.PI };
}

// Simplify polygon (basic)
function simplifyPolygon(coords, tolerance = 0.001) {
    if (coords.length < 3) return coords;
    if (coords.length > MAX_POINTS) {
        const step = Math.ceil(coords.length / MAX_POINTS);
        const simplified = [];
        for (let i=0; i<coords.length; i+=step) {
            simplified.push(coords[i]);
        }
        if (simplified[simplified.length-1] !== coords[coords.length-1]) simplified.push(coords[coords.length-1]);
        return simplified;
    }
    return coords;
}

// Point in polygon (ray casting)
function pointInPolygon(lat, lng, polygon) {
    if (polygon.center) {
        // Handle circle intersection
        const p1 = L.latLng(lat, lng);
        const p2 = L.latLng(polygon.center[0], polygon.center[1]);
        return p1.distanceTo(p2) <= (polygon.radius * 1852);
    }
    let inside = false;
    const n = polygon.length;
    for (let i=0, j=n-1; i<n; j=i++) {
        const xi = polygon[i][0], yi = polygon[i][1];
        const xj = polygon[j][0], yj = polygon[j][1];
        const intersect = ((yi > lng) !== (yj > lng)) &&
            (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function triggerUpdateAnimation(el) {
    el.classList.remove('updated');
    void el.offsetWidth; // trigger reflow
    el.classList.add('updated');
}

// --- STATUS & UI HELPERS ---

/**
 * Updates the status message in the application footer.
 * @param {string} msg - The message to display.
 * @param {string} type - The type of status (success, error, warning, info).
 */
function setStatus(msg, type = '') {
    console.log(`[STATUS] ${type.toUpperCase() || 'INFO'}: ${msg}`);
    const el = document.getElementById('statusMsg');
    if (el) {
        el.textContent = msg;
        el.className = type;
    }
}

function updateDashboard() {
    const routeCount = storedData.navtech.coords.length;
    const notamCount = storedData.notam.length;
    const vonaCount = storedData.vona ? 1 : 0;
    const tcCount = storedData.tc ? 1 : 0;
    const elements = {
        dashRoute: document.getElementById('dashRoute'),
        dashNotamCount: document.getElementById('dashNotamCount'),
        dashVonaCount: document.getElementById('dashVonaCount'),
        dashTcCount: document.getElementById('dashTcCount')
    };

    const newVals = {
        dashRoute: routeCount > 0 ? `${storedData.navtech.coords[0].name || '?'} → ${storedData.navtech.coords[routeCount-1].name || '?'}` : '-',
        dashNotamCount: notamCount,
        dashVonaCount: vonaCount,
        dashTcCount: tcCount
    };

    Object.keys(elements).forEach(key => {
        if (elements[key].textContent !== String(newVals[key])) {
            elements[key].textContent = newVals[key];
            triggerUpdateAnimation(elements[key]);
        }
    });

    let status = 'CLEAR';
    let cls = '';
    if (routeCount > 0) {
        const routeLatLngs = storedData.navtech.coords.map(c => [c.lat, c.lng]);
        let vonaIntersect = false;
        if (storedData.vona && vonaPolygons.length) {
            vonaPolygons.forEach(poly => {
                routeLatLngs.forEach(pt => {
                    if (pointInPolygon(pt[0], pt[1], poly)) vonaIntersect = true;
                });
            });
        }
        let notamIntersect = false;
        notamPolygons.forEach(poly => {
            routeLatLngs.forEach(pt => {
                if (pointInPolygon(pt[0], pt[1], poly)) notamIntersect = true;
            });
        });
        let tcIntersect = false;
        tcPolygons.forEach(poly => {
            routeLatLngs.forEach(pt => {
                if (pointInPolygon(pt[0], pt[1], poly)) tcIntersect = true;
            });
        });
        if (vonaIntersect || notamIntersect || tcIntersect) {
            status = 'DANGER';
            cls = 'danger';
        } else if (vonaCount > 0 || notamCount > 0 || tcCount > 0) {
            status = 'WARNING';
            cls = 'warning';
        }
    }
    const dashStatus = document.getElementById('dashStatus');
    dashStatus.textContent = status;
    dashStatus.className = 'dash-status ' + (cls || 'clear');
}

// --- MAP INIT ---

function initMap() {
    if (map) return;
    map = L.map('map', { center: [-2.5, 118], zoom: 5, zoomControl: true, attributionControl: false });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(map);
    Object.values(layers).forEach(l => l.addTo(map));
    L.control.zoom({ position: 'topright' }).addTo(map);

    map.on('mousemove', (e) => {
        const { lat, lng } = e.latlng;
        const latStr = Math.abs(lat).toFixed(4) + (lat>=0?'N':'S');
        const lngStr = Math.abs(lng).toFixed(4) + (lng>=0?'E':'W');
        document.getElementById('coordsDisplay').textContent = `${latStr} ${lngStr}`;

        if (isRulerActive && rulerPoints.length > 0) {
            updateRuler(e.latlng);
        }
    });
    map.on('click', (e) => {
        // Normal click behavior (if any)
    });

    // Ruler logic moved to its own handlers for better isolation
    rulerLayer = L.layerGroup().addTo(map);

    setInterval(() => {
        const now = new Date();
        const timeStr = now.toISOString().substr(11,8);
        const el1 = document.getElementById('clockDisplay');
        const el2 = document.getElementById('clockDisplayDash');
        if (el1) el1.textContent = timeStr;
        if (el2) el2.textContent = timeStr;
    }, 1000);

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            activeTab = this.dataset.tab;
            const placeholder = {
                navtech: 'Paste Navtech route data (waypoints with coordinates)',
                vona: 'Paste VONA advisory text',
                notam: 'Paste NOTAM text (one or multiple)',
                tc: 'Paste Tropical Cyclone warning text (JTWC format)'
            };
            document.getElementById('mainInput').placeholder = placeholder[activeTab] || '';
        });
    });
}

// --- PARSING FUNCTIONS ---

function handleParse() {
    const input = document.getElementById('mainInput');
    const text = normalizeInput(input.value);
    if (!text) return setStatus('No data to parse', 'error');
    try {
        if (activeTab === 'navtech') parseNavtech(text);
        else if (activeTab === 'vona') parseVona(text);
        else if (activeTab === 'notam') parseNotam(text);
        else if (activeTab === 'tc') parseTC(text);
        updateDashboard();
    } catch(e) {
        console.error(e);
        setStatus('Parsing error: ' + e.message, 'error');
    }
}

// ============================================================
//  NAVTECH PARSER – now supports two‑column format
//  Format: waypoints may appear in two columns.
//  Order: left column top→bottom, then right column top→bottom.
// ============================================================
function parseNavtech(text) {
    console.log('[PARSER] Starting Navtech parse...');
    layers.navtech.clearLayers();
    storedData.navtech = { coords: [], polyline: null, markers: [] };
    routeCoords = [];

    const lines = text.split('\n').filter(line => line.trim().length > 0);
    if (lines.length === 0) throw new Error('No data');

    // Regex to match a single waypoint: name + coordinate
    const wpRegex = /([A-Z0-9]+)\s+([NS])\s*(\d{2})\s*(\d{2}\.?\d*)\s+([EW])\s*(\d{3})\s*(\d{2}\.?\d*)/g;

    // Parse each line into an array of waypoint objects
    const parsedLines = lines.map(line => {
        const wps = [];
        let match;
        // Reset regex for each line
        const regex = new RegExp(wpRegex.source, 'g');
        while ((match = regex.exec(line)) !== null) {
            const name = match[1];
            const lat = (parseInt(match[3]) + parseFloat(match[4])/60) * (match[2] === 'S' ? -1 : 1);
            const lng = (parseInt(match[6]) + parseFloat(match[7])/60) * (match[5] === 'W' ? -1 : 1);
            if (!isNaN(lat) && !isNaN(lng)) {
                wps.push({ name, lat, lng });
            }
        }
        return wps;
    });

    // Filter out empty lines
    const nonEmpty = parsedLines.filter(arr => arr.length > 0);
    if (nonEmpty.length === 0) throw new Error('No valid waypoints found');

    // Determine if two‑column format: if any line has 2 waypoints, we assume two columns.
    const hasTwoCols = nonEmpty.some(arr => arr.length === 2);

    let orderedWaypoints = [];
    if (hasTwoCols) {
        // Build left column (index 0) and right column (index 1)
        const left = [];
        const right = [];
        nonEmpty.forEach(arr => {
            if (arr.length >= 1) left.push(arr[0]);
            if (arr.length >= 2) right.push(arr[1]);
            // If a line has >2, we ignore extras (should not happen)
        });
        orderedWaypoints = left.concat(right);
    } else {
        // Single column: flatten all waypoints in order of lines
        nonEmpty.forEach(arr => {
            orderedWaypoints = orderedWaypoints.concat(arr);
        });
    }

    // If still empty, fallback to scanning all text
    if (orderedWaypoints.length === 0) {
        const allMatches = text.match(wpRegex);
        if (allMatches) {
            // fallback – but this won't preserve column order
            orderedWaypoints = allMatches.map(m => {
                // re‑parse each match (could be optimized but fine)
                const parts = m.match(/([A-Z0-9]+)\s+([NS])\s*(\d{2})\s*(\d{2}\.?\d*)\s+([EW])\s*(\d{3})\s*(\d{2}\.?\d*)/);
                if (!parts) return null;
                const name = parts[1];
                const lat = (parseInt(parts[3]) + parseFloat(parts[4])/60) * (parts[2] === 'S' ? -1 : 1);
                const lng = (parseInt(parts[6]) + parseFloat(parts[7])/60) * (match[5] === 'W' ? -1 : 1);
                return { name, lat, lng };
            }).filter(Boolean);
        }
    }

    if (orderedWaypoints.length === 0) throw new Error('No waypoints could be parsed');

    storedData.navtech.coords = orderedWaypoints;
    routeCoords = orderedWaypoints.map(c => [c.lat, c.lng]);

    // Draw route
    const latlngs = orderedWaypoints.map(c => [c.lat, c.lng]);
    const polyline = L.polyline(latlngs, { color: 'var(--accent-navtech)', weight: 4, opacity: 0.8 }).addTo(layers.navtech);
    storedData.navtech.polyline = polyline;
    const markers = orderedWaypoints.map((c, i) => {
        const m = L.circleMarker([c.lat, c.lng], { radius: 4, color: 'var(--accent-navtech)', fillColor: 'white', fillOpacity: 1, weight: 2 })
            .addTo(layers.navtech)
            .bindTooltip(`${i+1}: ${c.name}`, { direction: 'right' });
        return m;
    });
    storedData.navtech.markers = markers;

    // Show card
    document.getElementById('navtechCard').style.display = 'block';
    document.getElementById('navCount').textContent = orderedWaypoints.length;
    document.getElementById('navPoints').innerHTML = orderedWaypoints.map(c =>
        `<div class="data-row"><span>${c.name}</span><span class="data-value">${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}</span></div>`
    ).join('');

    setStatus(`Navtech: ${orderedWaypoints.length} waypoints plotted (${hasTwoCols ? 'two‑column' : 'single‑column'})`, 'success');
    console.log(`[PARSER] Navtech parse complete: ${orderedWaypoints.length} waypoints found.`);
    fitBoundsAll();
}

// --- RULER TOOL LOGIC MOVED TO END OF FILE ---


// --- CLEAR ALL ---
// --- VONA PARSER ---
function parseVona(text) {
    console.log('[PARSER] Starting VONA parse...');
    layers.vona.clearLayers();
    vonaPolygons = [];
    const getVal = (regex) => (regex.exec(text) || ["","N/A"])[1].trim();

    const psnPatterns = [
        /PSN:\s*([NS])\s*(\d{2})\s*(\d{2})\s+([EW])\s*(\d{3})\s*(\d{2})/i,
        /PSN:\s*([NS])\s*(\d{2})\s*(\d{2})\s*([EW])\s*(\d{3})\s*(\d{2})/i
    ];
    let psnMatch = null;
    for (let p of psnPatterns) {
        psnMatch = text.match(p);
        if (psnMatch) break;
    }
    if (!psnMatch) throw new Error('PSN not found');

    const lat = (parseInt(psnMatch[2]) + parseInt(psnMatch[3])/60) * (psnMatch[1].toUpperCase()==='S'?-1:1);
    const lng = (parseInt(psnMatch[5]) + parseInt(psnMatch[6])/60) * (psnMatch[4].toUpperCase()==='W'?-1:1);
    const volcano = getVal(/VOLCANO:\s*([^\d\n]+)/i);
    const advisory = getVal(/ADVISORY NR:\s*([^\n]+)/i);
    const dtg = getVal(/DTG:\s*([^\n]+)/i);
    const elev = getVal(/SOURCE ELEV:\s*([^\n]+)/i);
    const details = getVal(/ERUPTION DETAILS:\s*([^\n]+)/i);

    const data = { volcano, advisory, dtg, elev, details, coords: [lat, lng] };
    storedData.vona = data;

    L.marker([lat, lng], {
        icon: L.divIcon({ className: 'pulse-marker', iconSize: [14,14] })
    }).addTo(layers.vona).bindPopup(`<b>${volcano}</b><br>${details}`);

    // Ash cloud segments
    const segments = [];
    const segRegex = /(OBS VA CLD|FCST VA CLD \+(\d+)\s*HR)\s*:\s*([\s\S]*?)(?=\n(?:OBS VA CLD|FCST VA CLD|RMK:|NXT ADVISORY)|$)/gi;
    let sm;
    while ((sm = segRegex.exec(text)) !== null) {
        segments.push({
            type: sm[1],
            hours: sm[2] ? parseInt(sm[2]) : 0,
            body: sm[3].trim().replace(/\n/g, ' ')
        });
    }

    const movMatch = text.match(/MOV\s+([NSEW]{1,3})\s*(\d{1,3})\s*KT/i);
    const bearings = { N:0, NNE:22.5, NE:45, ENE:67.5, E:90, ESE:112.5, SE:135, SE:157.5, S:180, SSW:202.5, SW:225, WSW:247.5, W:270, WNW:292.5, NW:315, NNW:337.5 };
    const brng = movMatch ? bearings[movMatch[1].toUpperCase()] : null;
    const speed = movMatch ? parseInt(movMatch[2]) : 0;

    function extractCoords(str) {
        const res = [];
        const coordRegex = /(\d{4,6}(\.\d+)?[NS])\s*(\d{5,7}(\.\d+)?[EW])|([NS]\d{4,6}(\.\d+)?)\s*([EW]\d{5,7}(\.\d+)?)/gi;
        let m;
        while ((m = coordRegex.exec(str)) !== null) {
            const latPart = m[1] || m[5];
            const lngPart = m[3] || m[7];
            const lat = dmsToDecimal(latPart);
            const lng = dmsToDecimal(lngPart);
            if (lat !== null && lng !== null) res.push([lat, lng]);
        }
        return res;
    }

    const obsSeg = segments.find(s => s.type.includes('OBS'));
    let obsCoords = obsSeg ? extractCoords(obsSeg.body) : [];
    let centerlinePoints = [];

    if (obsCoords.length >= 3) {
        const poly = L.polygon(obsCoords, { color: '#212121', weight: 2, fillOpacity: 0.25, fillColor: '#616161' })
            .addTo(layers.vona)
            .bindPopup('OBS VA CLD');
        vonaPolygons.push(obsCoords);
        const cx = obsCoords.reduce((s,p) => s + p[0], 0) / obsCoords.length;
        const cy = obsCoords.reduce((s,p) => s + p[1], 0) / obsCoords.length;
        centerlinePoints.push([cx, cy]);
    } else {
        centerlinePoints.push([lat, lng]);
    }

    const fcstSegments = segments.filter(s => s.type.includes('FCST'));
    fcstSegments.forEach((seg, idx) => {
        const explicit = extractCoords(seg.body);
        let polyCoords;
        if (explicit.length >= 3) {
            polyCoords = explicit;
        } else if (brng !== null && obsCoords.length >= 3) {
            const dist = speed * seg.hours;
            polyCoords = obsCoords.map(p => {
                const dest = destinationPoint(p[0], p[1], brng, dist);
                return [dest.lat, dest.lng];
            });
        } else {
            return;
        }
        if (polyCoords.length >= 3) {
            const color = '#f44336';
            const opacity = 0.15 - (idx * 0.03);
            const dash = seg.hours > 0 ? '5,5' : null;
            const poly = L.polygon(polyCoords, {
                color, weight: 2, dashArray: dash,
                fillOpacity: Math.max(opacity, 0.05), fillColor: color
            }).addTo(layers.vona).bindPopup(`+${seg.hours} HR`);
            vonaPolygons.push(polyCoords);
            const cx = polyCoords.reduce((s,p) => s + p[0], 0) / polyCoords.length;
            const cy = polyCoords.reduce((s,p) => s + p[1], 0) / polyCoords.length;
            centerlinePoints.push([cx, cy]);
        }
    });

    if (centerlinePoints.length > 1) {
        L.polyline(centerlinePoints, { color: '#ffaa00', weight: 2, dashArray: '3,6' })
            .addTo(layers.vona)
            .bindTooltip('Ash trajectory centerline');
    } else if (centerlinePoints.length === 1) {
        L.circleMarker(centerlinePoints[0], { radius: 3, color: '#ffaa00' })
            .addTo(layers.vona)
            .bindTooltip('Ash center');
    }

    document.getElementById('vonaCard').style.display = 'block';
    document.getElementById('vonaDetails').innerHTML = `
        <div class="data-row"><span class="data-label">Volcano</span><span class="data-value">${volcano}</span></div>
        <div class="data-row"><span class="data-label">Advisory</span><span class="data-value">${advisory}</span></div>
        <div class="data-row"><span class="data-label">DTG</span><span class="data-value">${dtg}</span></div>
        <div class="data-row"><span class="data-label">Elevation</span><span class="data-value">${elev}</span></div>
        <div class="data-row"><span class="data-label">Movement</span><span class="data-value">${movMatch ? movMatch[0] : 'STNR'}</span></div>
    `;
    setStatus(`VONA: ${volcano} parsed`, 'success');
    console.log(`[PARSER] VONA parse complete for ${volcano}.`);
    fitBoundsAll();
}

// --- NOTAM PARSER ---
function parseNotam(text) {
    console.log('[PARSER] Starting NOTAM parse...');
    layers.notam.clearLayers();
    storedData.notam = [];
    notamPolygons = [];

    const blocks = text.split(/(?=[A-Z]\d{1,5}\/\d{2}\s+NOTAM[NRC])/m).filter(b => b.trim().length > 10);

    blocks.forEach((block, idx) => {
        try {
            const lines = block.split('\n').map(l => l.trim());
            let id = '';
            let eline = '';
            let isE = false;
            let eParts = [];

            const idMatch = block.match(/([A-Z]\d{1,5}\/\d{2})/);
            if (idMatch) id = idMatch[0];

            lines.forEach(line => {
                if (line.match(/^[A-Z]\d{1,5}\/\d{2}/)) return;
                if (line.startsWith('E)')) { isE = true; eParts.push(line.substring(2).trim()); }
                else if (line.startsWith('Q)') || line.startsWith('A)') || line.startsWith('B)') ||
                         line.startsWith('C)') || line.startsWith('F)') || line.startsWith('G)') ||
                         line.startsWith('RMK:') || line.includes('UPPER TERRAIN')) {
                    isE = false;
                } else if (isE && line && !line.match(/^[A-G]\)/)) {
                    eParts.push(line.replace(/^-/, '').trim());
                }
            });
            eline = eParts.join(' ');

            const fullText = eline + ' ' + block;
            const color = NOTAM_COLORS[idx % NOTAM_COLORS.length];

            // 1. Check for Radius (e.g., WI 20NM OF PSN ...)
            const radiusMatch = fullText.match(/WI\s+(\d+)\s*NM\s+OF\s+PSN\s+([\d\.NSEW]+)\s+([\d\.NSEW]+)/i);
            if (radiusMatch) {
                const radiusNM = parseInt(radiusMatch[1]);
                const lat = dmsToDecimal(radiusMatch[2]);
                const lng = dmsToDecimal(radiusMatch[3]);
                if (lat !== null && lng !== null) {
                    L.circle([lat, lng], {
                        radius: radiusNM * 1852,
                        color, weight: 2, fillOpacity: 0.2
                    }).addTo(layers.notam).bindPopup(`<b>${id}</b> (Radius ${radiusNM}NM)<br>${eline.substring(0,100)}...`);
                    
                    const circleObj = { center: [lat, lng], radius: radiusNM };
                    notamPolygons.push(circleObj);
                    storedData.notam.push({ id, type: 'circle', ...circleObj, color, eline });
                    return;
                }
            }

            // 2. Check for Polygons
            const coords = [];
            const coordRegex = /(\d{4,6}(\.\d+)?[NS])\s*(\d{5,7}(\.\d+)?[EW])|([NS]\d{4,6}(\.\d+)?)\s*([EW]\d{5,7}(\.\d+)?)/gi;
            let m;
            while ((m = coordRegex.exec(fullText)) !== null) {
                const latPart = m[1] || m[5];
                const lngPart = m[3] || m[7];
                const lat = dmsToDecimal(latPart);
                const lng = dmsToDecimal(lngPart);
                if (lat !== null && lng !== null) coords.push([lat, lng]);
            }

            if (coords.length < 3) return;

            const simplified = simplifyPolygon(coords);
            L.polygon(simplified, {
                color, weight: 2, fillOpacity: 0.2
            }).addTo(layers.notam).bindPopup(`<b>${id}</b><br>${eline.substring(0,80)}...`);
            notamPolygons.push(simplified);

            storedData.notam.push({ id, type: 'polygon', coords: simplified, color, eline });
        } catch(e) {
            console.warn('Skipping NOTAM block:', e);
        }
    });

    if (storedData.notam.length === 0) {
        setStatus('No valid NOTAM areas found', 'warning');
        return;
    }

    document.getElementById('notamCard').style.display = 'block';
    document.getElementById('notamResults').innerHTML = storedData.notam.map(n =>
        `<div class="notam-block" style="border-left-color:${n.color}" onclick="focusNotam('${n.id}')">
            <div class="data-row"><b>${n.id}</b><span>${n.type === 'circle' ? n.radius + 'NM' : n.coords.length + ' pts'}</span></div>
        </div>`
    ).join('');

    setStatus(`NOTAM: ${storedData.notam.length} areas plotted`, 'success');
    console.log(`[PARSER] NOTAM parse complete: ${storedData.notam.length} areas found.`);
    fitBoundsAll();
}

// --- TROPICAL CYCLONE PARSER ---
function parseTC(text) {
    console.log('[PARSER] Starting Tropical Cyclone parse...');
    layers.tc.clearLayers();
    tcPolygons = [];
    storedData.tc = null;

    // Enhanced extraction
    const categories = ["TROPICAL STORM", "TROPICAL CYCLONE", "TYPHOON", "SUPER TYPHOON", "TROPICAL DEPRESSION", "SUBTROPICAL STORM"];
    const nameRegex = new RegExp(`(?:${categories.join('|')})\\s+([A-Z0-9]+\\s+\\([^\\)]+\\))`, 'i');
    
    // Check SUBJ line first for the most complete name
    const subjLine = text.match(/SUBJ\/([^\/]+)/);
    let tcName = "UNKNOWN CYCLONE";
    if (subjLine) {
        tcName = subjLine[1].replace(/WARNING NR \d+/i, '').trim();
    } else {
        const nameMatch = text.match(nameRegex);
        if (nameMatch) tcName = nameMatch[0].trim();
    }
    
    const nrMatch = text.match(/WARNING NR (\d+)/i);
    const warningNr = nrMatch ? nrMatch[1] : "???";

    const movMatch = text.match(/MOVEMENT PAST SIX HOURS - ([\s\S]*?)(?=\n|$)/i);
    const movement = movMatch ? movMatch[1].trim() : "STNR / N/A";
    
    const presMatch = text.match(/PRESSURE AT [\dZ\s]+IS (\d+\s*MB)/i) || text.match(/(\d+\s*MB)/);
    const pressure = presMatch ? presMatch[1] : "N/A";

    // Extract Positions & Wind
    const segments = [];
    // Current warning position
    const warnPosMatch = text.match(/WARNING POSITION:\s*([\s\S]*?)(?=FORECASTS:|$)/i);
    if (warnPosMatch) {
        segments.push({ type: 'WARNING', body: warnPosMatch[1] });
    }
    // Forecasts
    const fcstRegex = /(\d+ HRS, VALID AT:\s*[\s\S]*?)(?=\n\s*\d+ HRS|$)/gi;
    let fm;
    while ((fm = fcstRegex.exec(text)) !== null) {
        segments.push({ type: 'FORECAST', body: fm[1] });
    }

    const tcData = { name: tcName, warning: warningNr, points: [] };

    segments.forEach(seg => {
        const dtgMatch = seg.body.match(/(\d{6}Z)/i);
        const dtg = dtgMatch ? dtgMatch[1] : "";
        
        const coordRegex = /(?:NEAR\s+|---\s+|REPEAT POSIT:\s*)(\d+\.\d+[NS])\s+(\d+\.\d+[EW])/i;
        const coordMatch = seg.body.match(coordRegex);
        if (!coordMatch) return;

        const lat = dmsToDecimal(coordMatch[1]);
        const lng = dmsToDecimal(coordMatch[2]);
        if (lat === null || lng === null) return;
        const windsMatch = seg.body.match(/MAX SUSTAINED WINDS - (\d+) KT/i);
        const winds = windsMatch ? parseInt(windsMatch[1]) : 0;

        const pt = { lat, lng, winds, dtg, radii: [] };

        // Parse Wind Radii
        const radiiTypes = [
            { label: '50KT', regex: /RADIUS OF 050 KT WINDS - ([\s\S]*?)(?=RADIUS OF 034|$)/i },
            { label: '34KT', regex: /RADIUS OF 034 KT WINDS - ([\s\S]*?)(?=VECTOR TO|$|FORECASTS:)/i }
        ];

        radiiTypes.forEach(rt => {
            const rm = seg.body.match(rt.regex);
            if (rm) {
                const quadStr = rm[1];
                const ne = (quadStr.match(/(\d+) NM NORTHEAST/i) || [0,0])[1];
                const se = (quadStr.match(/(\d+) NM SOUTHEAST/i) || [0,0])[1];
                const sw = (quadStr.match(/(\d+) NM SOUTHWEST/i) || [0,0])[1];
                const nw = (quadStr.match(/(\d+) NM NORTHWEST/i) || [0,0])[1];
                pt.radii.push({ label: rt.label, ne: parseInt(ne), se: parseInt(se), sw: parseInt(sw), nw: parseInt(nw) });
            }
        });

        tcData.points.push(pt);
    });

    if (tcData.points.length === 0) throw new Error("No TC positions found");
    storedData.tc = tcData;

    // 1. Draw Avoidance Corridor (shaded area connecting 34KT radii)
    const corridorPoints = [];
    const leftSide = [];
    const rightSide = [];
    
    tcData.points.forEach(pt => {
        const r34 = pt.radii.find(r => r.label === '34KT');
        if (r34) {
            // Simplify by using max radius for the corridor boundary or just NE/SW etc.
            // For a better look, we take a few points from the quadrant polygon
            const quadCoords = generateQuadrantPolygon(pt.lat, pt.lng, r34);
            // Rough estimation for corridor: leftmost and rightmost points relative to track
            // But to keep it simple and stable, we'll just draw the envelope of all 34KT polygons
            tcPolygons.push(quadCoords);
            L.polygon(quadCoords, { color: 'transparent', fillColor: 'rgba(59, 130, 246, 0.15)', fillOpacity: 0.1, weight: 0 }).addTo(layers.tc);
        }
    });

    // 2. Draw Track Line
    const trackLatLngs = tcData.points.map(p => [p.lat, p.lng]);
    L.polyline(trackLatLngs, { color: 'var(--accent-tc)', weight: 3, dashArray: '5, 10', opacity: 0.7 }).addTo(layers.tc);

    // 3. Draw Points, Radii, and Labels
    tcData.points.forEach((pt, idx) => {
        const isCurrent = idx === 0;
        
        // Marker
        const icon = L.divIcon({
            className: 'tc-marker',
            html: `<div style="width:16px; height:16px; background:${isCurrent?'var(--accent-tc)':'#fff'}; border-radius:50%; border:2px solid #000; box-shadow: 0 0 10px rgba(0,0,0,0.5);"></div>`,
            iconSize: [16,16]
        });
        
        const marker = L.marker([pt.lat, pt.lng], { icon }).addTo(layers.tc);
        marker.bindPopup(`<b>${tcName}</b><br>${pt.dtg}<br>Winds: ${pt.winds} KT`);
        
        // Permanent Label (Intensity & DTG)
        if (idx % 2 === 0 || isCurrent) { // Don't crowd too much
            marker.bindTooltip(`${pt.dtg.substring(0,5)}, ${pt.winds}KTS`, { 
                permanent: true, 
                direction: 'right', 
                className: 'tc-map-label',
                offset: [10, 0]
            });
        }

        // Draw Asymmetric Radii for ALL points
        pt.radii.forEach(r => {
            if (r.ne + r.se + r.sw + r.nw === 0) return;
            const coords = generateQuadrantPolygon(pt.lat, pt.lng, r);
            const is50 = r.label === '50KT';
            const color = is50 ? '#8b5cf6' : '#ef4444'; // Purple for 50KT, Red for 34KT
            
            L.polygon(coords, { 
                color: color, 
                weight: 1.5, 
                fillColor: color, 
                fillOpacity: is50 ? 0.2 : 0.1,
                dashArray: isCurrent ? null : '3, 5'
            }).addTo(layers.tc);
            
            tcPolygons.push(coords);
        });

    });

    document.getElementById('tcCard').style.display = 'block';
    document.getElementById('tcDetails').innerHTML = `
        <div class="data-row"><span class="data-label">NAME</span><span class="data-value" style="color:var(--accent-tc)">${tcName}</span></div>
        <div class="data-row"><span class="data-label">WARNING</span><span class="data-value">NR ${warningNr}</span></div>
        <div class="data-row"><span class="data-label">MOVEMENT</span><span class="data-value">${movement}</span></div>
        <div class="data-row"><span class="data-label">PRESSURE</span><span class="data-value">${pressure}</span></div>
        <div class="data-row"><span class="data-label">CUR WINDS</span><span class="data-value">${tcData.points[0].winds} KT</span></div>
    `;
    document.getElementById('tcForecasts').innerHTML = `
        <div style="font-size:9px; color:var(--text-muted); margin-bottom:4px; text-transform:uppercase; letter-spacing:1px; border-bottom:1px solid var(--border)">Forecast Track</div>
        ${tcData.points.slice(1).map((p, i) => 
            `<div class="data-row">
                <span>+${(i+1)*12}H</span>
                <span class="data-value">${p.lat.toFixed(1)}${p.lat>=0?'N':'S'} ${p.lng.toFixed(1)}${p.lng>=0?'E':'W'}</span>
                <span class="data-value" style="color:var(--status-warning)">${p.winds}KT</span>
            </div>`
        ).join('')}
    `;

    setStatus(`TC: ${tcName} parsed`, 'success');
    console.log(`[PARSER] TC parse complete for ${tcName}.`);
    fitBoundsAll();
}

// Generate a smooth-ish asymmetric polygon for quadrants
function generateQuadrantPolygon(lat, lng, r) {
    if (lat === null || lng === null) return [];
    const points = [];
    const steps = 15; // points per quadrant
    const quadrants = [
        { start: 0, end: 90, radius: r.ne },
        { start: 90, end: 180, radius: r.se },
        { start: 180, end: 270, radius: r.sw },
        { start: 270, end: 360, radius: r.nw }
    ];
    quadrants.forEach(q => {
        if (q.radius === 0) {
            // If 0, just use a tiny buffer to keep the shape valid or skip
            const dest = destinationPoint(lat, lng, (q.start + q.end)/2, 0.1);
            points.push([dest.lat, dest.lng]);
            return;
        }
        for (let i = 0; i <= steps; i++) {
            const angle = q.start + (q.end - q.start) * (i / steps);
            const dest = destinationPoint(lat, lng, angle, q.radius);
            points.push([dest.lat, dest.lng]);
        }
    });
    return points;
}

// --- ANALYZE ALL ---
function analyzeAll() {
    runIntersectionChecks();
    updateDashboard();
    setStatus('Analysis complete. Check dashboard for status.', 'success');
}

function runIntersectionChecks() {
    document.getElementById('navtechIntersect').innerHTML = '';
    document.getElementById('vonaIntersect').innerHTML = '';
    document.getElementById('notamIntersect').innerHTML = '';
    document.getElementById('tcIntersect').innerHTML = '';

    const route = storedData.navtech.coords;
    if (!route.length) {
        document.getElementById('navtechIntersect').innerHTML = 'No route loaded.';
        return;
    }

    const routeLatLngs = route.map(c => [c.lat, c.lng]);

    // VONA
    if (vonaPolygons.length) {
        let intersect = false;
        vonaPolygons.forEach(poly => {
            routeLatLngs.forEach(pt => {
                if (pointInPolygon(pt[0], pt[1], poly)) intersect = true;
            });
        });
        document.getElementById('vonaIntersect').innerHTML = intersect ? 
            '<span style="color:var(--status-danger)">🔴 Route intersects VONA ash cloud!</span>' : 
            '<span style="color:var(--status-clear)">✅ No VONA intersection.</span>';
    }

    // NOTAM
    if (notamPolygons.length) {
        let intersect = false;
        notamPolygons.forEach(poly => {
            routeLatLngs.forEach(pt => {
                if (pointInPolygon(pt[0], pt[1], poly)) intersect = true;
            });
        });
        document.getElementById('notamIntersect').innerHTML = intersect ? 
            '<span style="color:var(--status-danger)">🔴 Route intersects NOTAM area(s)!</span>' : 
            '<span style="color:var(--status-clear)">✅ No NOTAM intersection.</span>';
    }

    // TC
    if (tcPolygons.length) {
        let intersect = false;
        tcPolygons.forEach(poly => {
            routeLatLngs.forEach(pt => {
                if (pointInPolygon(pt[0], pt[1], poly)) intersect = true;
            });
        });
        document.getElementById('tcIntersect').innerHTML = intersect ? 
            '<span style="color:var(--status-danger)">🔴 Route intersects TC Wind Radii!</span>' : 
            '<span style="color:var(--status-clear)">✅ No TC intersection.</span>';
    }
}

function focusNotam(id) {
    const item = storedData.notam.find(n => n.id === id);
    if (!item) return;
    let center;
    if (item.type === 'circle') {
        center = item.center;
    } else {
        const coords = item.coords;
        center = [coords.reduce((s,p) => s + p[0], 0)/coords.length, coords.reduce((s,p) => s + p[1], 0)/coords.length];
    }
    map.setView(center, 9);
}

// --- TEMPLATE LOADER ---
function loadTemplate() {
    const templates = {
        navtech: `WADD S 08 44.8 E 115 10.2 KALUT S 05 57.9 E 110 23.0
08S115E S 08 44.9 E 115 10.9 KURUS S 05 57.7 E 108 28.7
MAMAD S 08 45.0 E 115 27.9 IGUNA S 05 57.7 E 107 59.1
IKIMA S 08 36.4 E 115 27.9 SAGAS S 05 57.7 E 107 39.0
SUBNI S 08 36.5 E 115 14.2 UBNUX S 05 57.7 E 107 19.0
TOGAP S 08 36.1 E 114 26.6 DKI S 05 57.7 E 107 02.1
TERUD S 08 24.3 E 114 21.6 ONILI S 05 57.6 E 106 47.3
ODOTI S 08 05.8 E 114 13.8 PAPAF S 06 02.6 E 106 35.0
OKANG S 07 45.2 E 114 05.1 ELKIT S 06 06.6 E 106 25.2
WAWAN S 06 16.0 E 111 48.9 NININ S 06 10.5 E 106 25.9
FARIZ S 05 52.3 E 111 13.2 WIII S 06 07.4 E 106 39.7`,
        vona: `FVAU02 ADRM 041230
VA ADVISORY
DTG: 20260704/1230Z
VAAC: DARWIN
VOLCANO: SEMERU 263300
PSN: S0806 E11255
AREA: INDONESIA
SOURCE ELEV: 3657M AMSL
ADVISORY NR: 2026/758
INFO SOURCE: HIMAWARI-9, CVGHM
ERUPTION DETAILS: VA REP FM GND AT 04/1048Z
EST VA DTG: 04/1210Z
EST VA CLD: SFC/FL150 S0800 E11255 - S0817 E11328 - S0833
E11321 - S0839 E11301 - S0805 E11248 MOV SE 05KT
FCST VA CLD +6 HR: 04/1810Z SFC/FL150 S0800 E11255 - S0812
E11328 - S0831 E11326 - S0837 E11305 - S0805 E11248
FCST VA CLD +12 HR: 05/0010Z SFC/FL150 S0800 E11255 - S0814
E11326 - S0833 E11318 - S0835 E11256 - S0805 E11249
FCST VA CLD +18 HR: 05/0610Z SFC/FL150 S0801 E11255 - S0814
E11326 - S0833 E11320 - S0837 E11257 - S0805 E11248
RMK: VA NOT IDENTIFIABLE ON CURRENT SATELLITE IMAGERY DUE TO
MET CLOUD. GROUND REPORTS INDICATE INTERMITTENT ERUPTIONS
ARE ONGOING. HEIGHT AND MOVEMENT BASED ON SATELLITE IMAGERY,
GROUND REPORTS AND MODEL GUIDANCE.
NXT ADVISORY: NO LATER THAN 20260704/1830Z=`,
        notam: `A2334/26 NOTAMN
Q) WAAF/QWMLW/IV/BO /W /000/310/0030S11648E002
A) WAAF B) 2607182300 C) 2607221000
D) 18 22 2300 - 1000
E) GUN FIRING EXER WILL TAKE PLACE WI COORD AS FLW :
003033S1164935E - 003157S1164741E - 003014S1164627E 
- 002850S1164834E - 003033S1164935E
UPPER TERRAIN ELEV : 4000FT
RMK: ALL TFC SUBJ ATC CLR
F) GND G) 27000FT AGL`,
        tc: `WTPN32 PGTW 042100
TROPICAL STORM 10W (MAYSAK) WARNING NR 013
WARNING POSITION:
041800Z --- NEAR 21.6N 107.9E
MAX SUSTAINED WINDS - 050 KT, GUSTS 065 KT
RADIUS OF 050 KT WINDS - 000 NM NORTHEAST QUADRANT
                         040 NM SOUTHEAST QUADRANT
                         000 NM SOUTHWEST QUADRANT
                         000 NM NORTHWEST QUADRANT
RADIUS OF 034 KT WINDS - 060 NM NORTHEAST QUADRANT
                         180 NM SOUTHEAST QUADRANT
                         140 NM SOUTHWEST QUADRANT
                         030 NM NORTHWEST QUADRANT
FORECASTS:
12 HRS, VALID AT:
050600Z --- 22.9N 108.3E
MAX SUSTAINED WINDS - 035 KT, GUSTS 045 KT
RADIUS OF 034 KT WINDS - 010 NM NORTHEAST QUADRANT
                         110 NM SOUTHEAST QUADRANT
                         070 NM SOUTHWEST QUADRANT
                         010 NM NORTHWEST QUADRANT`
    };
    document.getElementById('mainInput').value = templates[activeTab] || '';
    setStatus(`Template loaded for ${activeTab}`, 'success');
}

// --- KML EXPORT ---
/**
 * Generates and downloads a KML file for the specified data type.
 * @param {string} type - The data type to export (navtech, vona, notam, tc).
 */
function downloadKML(type) {
    let name, kml;
    
    console.log(`[EXPORT] Preparing KML for type: ${type}`);

    if (type === 'navtech' && storedData.navtech.coords.length) {
        name = 'Navtech_Route';
        const coords = storedData.navtech.coords.map(c => `${c.lng},${c.lat},0`).join(' ');
        kml = `<Placemark><name>Route</name><LineString><coordinates>${coords}</coordinates></LineString></Placemark>`;
    } else if (type === 'vona' && storedData.vona) {
        name = `VONA_${storedData.vona.volcano}`;
        const c = storedData.vona.coords;
        kml = `<Placemark><name>${storedData.vona.volcano}</name><Point><coordinates>${c[1]},${c[0]},0</coordinates></Point></Placemark>`;
    } else if (type === 'notam' && storedData.notam.length) {
        name = 'NOTAM_Areas';
        kml = storedData.notam.map(n => {
            const coords = n.type === 'circle' ? [] : n.coords.map(c => `${c[1]},${c[0]},0`).join(' ');
            return `<Placemark><name>${n.id}</name>${n.type==='circle'?'<Point><coordinates>'+n.center[1]+','+n.center[0]+',0</coordinates></Point>':'<Polygon><outerBoundaryIs><LinearRing><coordinates>'+coords+'</coordinates></LinearRing></outerBoundaryIs></Polygon>'}</Placemark>`;
        }).join('');
    } else if (type === 'tc' && storedData.tc) {
        name = `TC_${storedData.tc.name}`;
        const coords = storedData.tc.points.map(p => `${p.lng},${p.lat},0`).join(' ');
        kml = `<Placemark><name>${storedData.tc.name} Track</name><LineString><coordinates>${coords}</coordinates></LineString></Placemark>`;
    } else {
        console.warn(`[EXPORT] Failed: No data found for type: ${type}`);
        return alert('No data to export');
    }

    // Wrap in KML document structure
    const full = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${name}</name>${kml}</Document></kml>`;
    
    // Create blob and trigger download
    console.log(`[EXPORT] Generated KML content size: ${full.length} characters`);
    const blob = new Blob([full], { type: 'application/vnd.google-earth.kml+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.kml`;
    a.click();
    console.log(`[EXPORT] Download triggered for ${name}.kml`);
}

// --- PRINT REPORT ---
function printReport() {
    const printArea = document.getElementById('printArea');
    printArea.style.display = 'block';
    printArea.innerHTML = `
        <h1>Flight Dispatch Report</h1>
        <p>Generated: ${new Date().toUTCString()}</p>
        <hr>
        <h3>Route</h3>
        <p>${storedData.navtech.coords.length} waypoints</p>
        <ul>${storedData.navtech.coords.map(c => `<li>${c.name}: ${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}</li>`).join('')}</ul>
        <h3>VONA</h3>
        ${storedData.vona ? `<p>Volcano: ${storedData.vona.volcano}</p><p>DTG: ${storedData.vona.dtg}</p>` : '<p>No VONA data</p>'}
        <h3>NOTAM</h3>
        ${storedData.notam.length ? storedData.notam.map(n => `<p><b>${n.id}</b>: ${n.type}</p>`).join('') : '<p>No NOTAM data</p>'}
        <h3>Tropical Cyclone</h3>
        ${storedData.tc ? `<p>Name: ${storedData.tc.name}</p><p>Winds: ${storedData.tc.points[0].winds} KT</p>` : '<p>No TC data</p>'}
        <hr>
        <p><i>This report is for operational use only.</i></p>
    `;
    window.print();
    printArea.style.display = 'none';
}

// --- FIT BOUNDS ---
function fitBoundsAll() {
    const group = new L.featureGroup();
    Object.values(layers).forEach(l => l.eachLayer(layer => group.addLayer(layer)));
    if (group.getLayers().length) {
        map.fitBounds(group.getBounds(), { padding: [40,40] });
    }
}

// --- CLEAR ALL ---
function clearAll() {
    const sidebar = document.querySelector('.sidebar');
    sidebar.style.opacity = '0.5';
    sidebar.style.transition = 'opacity 0.2s';
    
    setTimeout(() => {
        Object.values(layers).forEach(l => l.clearLayers());
        document.querySelectorAll('.card').forEach(c => c.style.display = 'none');
        document.getElementById('mainInput').value = '';
        storedData = { navtech: { coords: [], polyline: null, markers: [] }, vona: null, notam: [], tc: null };
        routeCoords = [];
        vonaPolygons = [];
        notamPolygons = [];
        tcPolygons = [];
        isRulerActive = false;
        clearRuler();
        const rulerBtn = document.getElementById('rulerBtn');
        if (rulerBtn) rulerBtn.classList.remove('active');
        map.getContainer().style.cursor = '';
        updateDashboard();
        setStatus('All data cleared', '');
        sidebar.style.opacity = '1';
    }, 200);
}


// --- RULER TOOL LOGIC ---
/**
 * Toggles the ruler tool state and attaches/detaches event listeners.
 */
function toggleRuler() {
    isRulerActive = !isRulerActive;
    console.log(`[RULER] Tool state: ${isRulerActive ? 'ACTIVE' : 'INACTIVE'}`);
    
    const btn = document.getElementById('rulerBtn');
    const mapContainer = map.getContainer();
    
    if (isRulerActive) {
        btn.classList.add('active');
        mapContainer.style.cursor = 'crosshair';
        setStatus('RULER ACTIVE: Click for points. Double-click to finish segment.', 'info');
        
        // Disable double click zoom while ruler is active
        map.doubleClickZoom.disable();
        map.on('mousedown', onRulerMouseDown);
        map.on('dblclick', onRulerDblClick);
    } else {
        btn.classList.remove('active');
        mapContainer.style.cursor = '';
        map.doubleClickZoom.enable();
        map.off('mousedown', onRulerMouseDown);
        map.off('dblclick', onRulerDblClick);
        clearRuler();
        setStatus('Ruler Deactivated', '');
    }
}

function onRulerMouseDown(e) {
    if (!isRulerActive) return;
    if (rulerPoints.length < 2) {
        addRulerPoint(e.latlng);
    } else {
        setStatus('Segment complete. Double-click to clear and start new measurement.', 'warning');
    }
}

function onRulerDblClick(e) {
    if (!isRulerActive) return;
    finishRulerSegment();
}

function finishRulerSegment() {
    if (rulerPoints.length > 0) {
        rulerPoints = [];
        if (rulerTempLine) rulerLayer.removeLayer(rulerTempLine);
        if (rulerTempMarker) rulerLayer.removeLayer(rulerTempMarker);
        rulerTempLine = null;
        rulerTempMarker = null;
        setStatus('Measurement cleared. Ready for new segment.', 'info');
    }
}

function addRulerPoint(latlng) {
    if (!rulerLayer) return;
    rulerPoints.push(latlng);
    
    // Add point
    L.circleMarker(latlng, { 
        radius: 6, 
        color: '#3b82f6', 
        fillColor: '#fff', 
        fillOpacity: 1, 
        weight: 2,
        interactive: false 
    }).addTo(rulerLayer);
    
    if (rulerPoints.length > 1) {
        const prev = rulerPoints[rulerPoints.length - 2];
        const distM = prev.distanceTo(latlng);
        const distNM = (distM / 1852).toFixed(2);
        
        L.polyline([prev, latlng], { 
            color: '#3b82f6', 
            weight: 4, 
            dashArray: '10, 10',
            className: 'ruler-animated-path',
            interactive: false 
        }).addTo(rulerLayer);
        
        L.marker(latlng, {
            interactive: false,
            icon: L.divIcon({
                className: 'ruler-tooltip',
                html: `${distNM} NM`,
                iconSize: [80, 20],
                iconAnchor: [-10, 10]
            })
        }).addTo(rulerLayer);
        
        setStatus(`Final Distance: ${distNM} NM. Double-click to start over.`, 'success');
    } else {
        setStatus('Start point set. Click to set end point.', 'info');
    }
    document.getElementById('rulerClearBtn').style.display = 'flex';
}

function updateRuler(currentLatLng) {
    if (!rulerLayer || rulerPoints.length === 0) return;
    const start = rulerPoints[rulerPoints.length - 1];
    
    if (rulerTempLine) rulerLayer.removeLayer(rulerTempLine);
    if (rulerTempMarker) rulerLayer.removeLayer(rulerTempMarker);
    
    rulerTempLine = L.polyline([start, currentLatLng], { 
        color: '#3b82f6', 
        weight: 2, 
        dashArray: '5, 5', 
        opacity: 0.6,
        interactive: false 
    }).addTo(rulerLayer);
    
    const distM = start.distanceTo(currentLatLng);
    const distNM = (distM / 1852).toFixed(2);
    
    rulerTempMarker = L.marker(currentLatLng, {
        interactive: false,
        icon: L.divIcon({
            className: 'ruler-tooltip',
            html: `DIST: ${distNM} NM`,
            iconSize: [100, 24],
            iconAnchor: [-15, 12]
        })
    }).addTo(rulerLayer);
}

function clearRuler() {
    rulerPoints = [];
    rulerLayer.clearLayers();
    rulerTempLine = null;
    rulerTempMarker = null;
    document.getElementById('rulerClearBtn').style.display = 'none';
}

// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    document.getElementById('mainInput').placeholder = 'Paste Navtech route data (waypoints with coordinates)';
    updateDashboard();
});
