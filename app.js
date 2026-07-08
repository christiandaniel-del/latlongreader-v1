// ============================================================
// AVIATION DATA INTEGRATOR PRO – v4.0 (Airline Standard)
// ============================================================

// --- GLOBALS ---
let map;
let activeTab = 'navtech'; 
let currentView = 'dashboard';
const layers = { navtech: L.layerGroup(), vona: L.layerGroup(), notam: L.layerGroup(), tc: L.layerGroup() };
let storedData = { navtech: { coords: [], polyline: null, markers: [] }, vona: null, notam: [], tc: null };
let routeCoords = [];
let vonaPolygons = [];
let notamPolygons = [];
let tcPolygons = [];
let isRulerActive = false;
let rulerPoints = [];
let rulerLayer;

// Mock Flight Data
let flights = [
    { id: 'GA123', dep: '08:30', from: 'WIII', to: 'WARR', status: 'ACTIVE' },
    { id: 'SQ950', dep: '09:15', from: 'WIII', to: 'WSSS', status: 'SCHEDULED' },
    { id: 'QZ752', dep: '10:00', from: 'WIII', to: 'WADD', status: 'ACTIVE' },
    { id: 'ID658', dep: '11:45', from: 'WIII', to: 'WAHH', status: 'SCHEDULED' }
];

// --- AUTH & NAVIGATION ---

function handleLogin(event) {
    event.preventDefault();
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('appShell').style.display = 'block';
    
    setTimeout(() => {
        if (map) map.invalidateSize();
    }, 100);
    
    setStatus('Welcome back, Dispatcher.', 'success');
}

function switchView(viewId) {
    currentView = viewId;
    
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.view === viewId) item.classList.add('active');
    });
    
    document.querySelectorAll('.view-content').forEach(view => {
        view.classList.remove('active');
    });
    document.getElementById(viewId + 'View').classList.add('active');
    
    if (viewId === 'route-map') {
        setTimeout(() => map.invalidateSize(), 100);
    } else if (viewId === 'flight-list') {
        renderFlightTable();
    }
}

function renderFlightTable() {
    const tbody = document.getElementById('flightTableBody');
    tbody.innerHTML = flights.map(f => `
        <tr onclick="selectFlight('${f.id}')" style="cursor: pointer;">
            <td>${f.id}</td>
            <td>${f.dep} UTC</td>
            <td>${f.from} → ${f.to}</td>
            <td><span class="status-badge ${f.status === 'ACTIVE' ? 'status-active' : 'status-inactive'}">${f.status}</span></td>
            <td>
                <button class="btn btn-outline" style="padding: 4px 8px;" onclick="event.stopPropagation(); editFlight('${f.id}')"><i data-lucide="edit-2" style="width: 14px;"></i></button>
                <button class="btn btn-outline" style="padding: 4px 8px;" onclick="event.stopPropagation(); deleteFlight('${f.id}')"><i data-lucide="trash-2" style="width: 14px;"></i></button>
            </td>
        </tr>
    `).join('');
    lucide.createIcons();
}

function selectFlight(flightId) {
    const flight = flights.find(f => f.id === flightId);
    if (!flight) return;
    
    toggleRightPanel(true);
    document.getElementById('panelTitle').textContent = `Flight ${flight.id}`;
    document.getElementById('panelContent').innerHTML = `
        <div style="margin-bottom: 1.5rem;">
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.5rem;">STATUS</div>
            <div class="status-badge ${flight.status === 'ACTIVE' ? 'status-active' : 'status-inactive'}" style="display: inline-block;">${flight.status}</div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem;">
            <div>
                <div style="font-size: 0.8rem; color: var(--text-muted);">DEPARTURE</div>
                <div style="font-weight: 700; font-size: 1.1rem;">${flight.dep} UTC</div>
            </div>
            <div>
                <div style="font-size: 0.8rem; color: var(--text-muted);">AIRCRAFT</div>
                <div style="font-weight: 700; font-size: 1.1rem;">B738</div>
            </div>
        </div>
        <div style="margin-bottom: 1.5rem;">
            <div style="font-size: 0.8rem; color: var(--text-muted);">ROUTE</div>
            <div style="font-weight: 700; font-size: 1rem;">${flight.from} [CGK] → ${flight.to}</div>
        </div>
        <button class="btn btn-primary" style="width: 100%;" onclick="viewOnMap('${flight.id}')">VIEW ON MAP</button>
    `;
    lucide.createIcons();
}

function toggleRightPanel(show) {
    const panel = document.getElementById('rightPanel');
    if (show) panel.classList.remove('hidden');
    else panel.classList.add('hidden');
}

function viewOnMap(flightId) {
    switchView('route-map');
    setStatus(`Loading route for ${flightId}...`, 'info');
}

function editFlight(id) {
    setStatus(`Editing flight ${id} (Mockup)`, 'info');
}

function deleteFlight(id) {
    if (confirm(`Are you sure you want to delete ${id}?`)) {
        flights = flights.filter(f => f.id !== id);
        renderFlightTable();
        updateDashboard();
        setStatus(`Flight ${id} deleted.`, 'warning');
    }
}

// --- UTILITY FUNCTIONS ---

function normalizeInput(text) {
    return text.replace(/\r\n/g, '\n')
               .replace(/=\s*$/gm, '')
               .replace(/[\u2018\u2019]/g, "'")
               .replace(/[\u201C\u201D]/g, '"')
               .trim();
}

function dmsToDecimal(dmsStr) {
    if (!dmsStr) return null;
    let clean = dmsStr.toUpperCase().replace(/\s/g, '').replace(/,/g, '.');
    let dirMatch = clean.match(/[NSEW]/);
    if (!dirMatch) return null;
    let dir = dirMatch[0];
    let numPart = clean.replace(/[NSEW]/g, '');
    
    if (numPart.includes('.') && numPart.indexOf('.') === numPart.lastIndexOf('.')) {
        let integerPart = numPart.split('.')[0];
        if (integerPart.length <= 3) {
            let dec = parseFloat(numPart);
            if (dir === 'S' || dir === 'W') dec *= -1;
            return dec;
        }
    }

    let isLat = (dir === 'N' || dir === 'S');
    let d = 0, m = 0, s = 0;
    
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

function pointInPolygon(lat, lng, polygon) {
    if (polygon.center) {
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

// --- STATUS & UI HELPERS ---

function setStatus(msg, type = '') {
    const el = document.getElementById('statusMsg');
    const indicator = document.getElementById('statusIndicator');
    if (el) el.textContent = msg;
    if (indicator) {
        if (type === 'error') indicator.style.background = '#dc3545';
        else if (type === 'warning') indicator.style.background = '#ffc107';
        else indicator.style.background = '#28a745';
    }
}

function updateDashboard() {
    const activeCount = flights.filter(f => f.status === 'ACTIVE').length;
    const el = document.getElementById('activeFlightsCount');
    if (el) el.textContent = activeCount;
}

// --- MAP INIT ---

function initMap() {
    if (map) return;
    map = L.map('map', { center: [-2.5, 118], zoom: 5, zoomControl: true, attributionControl: false });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(map);
    Object.values(layers).forEach(l => l.addTo(map));
    L.control.zoom({ position: 'topright' }).addTo(map);

    rulerLayer = L.layerGroup().addTo(map);

    setInterval(() => {
        const now = new Date();
        const timeStr = now.toISOString().substr(11,8) + ' UTC';
        const el = document.getElementById('clockDisplay');
        if (el) el.textContent = timeStr;
    }, 1000);
}

// --- RULER TOOL ---

function toggleRuler() {
    isRulerActive = !isRulerActive;
    const btn = document.getElementById('rulerBtn');
    const mapContainer = map.getContainer();
    
    if (isRulerActive) {
        btn.classList.add('active');
        mapContainer.style.cursor = 'crosshair';
        setStatus('RULER ACTIVE: Click to set points.', 'info');
        map.on('click', onMapClickForRuler);
    } else {
        btn.classList.remove('active');
        mapContainer.style.cursor = '';
        map.off('click', onMapClickForRuler);
        clearRuler();
        setStatus('Ruler Deactivated', '');
    }
}

function onMapClickForRuler(e) {
    if (!isRulerActive) return;
    addRulerPoint(e.latlng);
}

function addRulerPoint(latlng) {
    rulerPoints.push(latlng);
    L.circleMarker(latlng, { radius: 5, color: 'var(--primary)', fillColor: '#fff', fillOpacity: 1 }).addTo(rulerLayer);
    
    if (rulerPoints.length > 1) {
        const prev = rulerPoints[rulerPoints.length - 2];
        const distM = prev.distanceTo(latlng);
        const distNM = (distM / 1852).toFixed(2);
        
        L.polyline([prev, latlng], { color: 'var(--primary)', weight: 2, dashArray: '5, 5' }).addTo(rulerLayer);
        
        L.marker(latlng, {
            icon: L.divIcon({
                className: 'ruler-tooltip-div',
                html: `<div style="background: white; padding: 2px 5px; border: 1px solid var(--primary); border-radius: 4px; font-size: 10px; font-weight: bold; white-space: nowrap;">${distNM} NM</div>`,
                iconSize: [60, 20],
                iconAnchor: [-10, 10]
            })
        }).addTo(rulerLayer);
        
        setStatus(`Distance: ${distNM} NM`, 'success');
    }
    document.getElementById('rulerClearBtn').style.display = 'flex';
}

function clearRuler() {
    rulerPoints = [];
    rulerLayer.clearLayers();
    document.getElementById('rulerClearBtn').style.display = 'none';
}

// --- PARSING FUNCTIONS (PRESERVED) ---

function parseNavtech(text) {
    layers.navtech.clearLayers();
    storedData.navtech = { coords: [], polyline: null, markers: [] };
    const lines = text.split('\n').filter(line => line.trim().length > 0);
    const wpRegex = /([A-Z0-9]+)\s+([NS])\s*(\d{2})\s*(\d{2}\.?\d*)\s+([EW])\s*(\d{3})\s*(\d{2}\.?\d*)/g;
    const parsedLines = lines.map(line => {
        const wps = [];
        let match;
        const regex = new RegExp(wpRegex.source, 'g');
        while ((match = regex.exec(line)) !== null) {
            const name = match[1];
            const lat = (parseInt(match[3]) + parseFloat(match[4])/60) * (match[2] === 'S' ? -1 : 1);
            const lng = (parseInt(match[6]) + parseFloat(match[7])/60) * (match[5] === 'W' ? -1 : 1);
            if (!isNaN(lat) && !isNaN(lng)) wps.push({ name, lat, lng });
        }
        return wps;
    });
    const nonEmpty = parsedLines.filter(arr => arr.length > 0);
    if (nonEmpty.length === 0) return;
    const hasTwoCols = nonEmpty.some(arr => arr.length === 2);
    let orderedWaypoints = [];
    if (hasTwoCols) {
        const left = [], right = [];
        nonEmpty.forEach(arr => {
            if (arr.length >= 1) left.push(arr[0]);
            if (arr.length >= 2) right.push(arr[1]);
        });
        orderedWaypoints = left.concat(right);
    } else {
        nonEmpty.forEach(arr => { orderedWaypoints = orderedWaypoints.concat(arr); });
    }
    storedData.navtech.coords = orderedWaypoints;
    const latlngs = orderedWaypoints.map(c => [c.lat, c.lng]);
    L.polyline(latlngs, { color: 'var(--primary)', weight: 4 }).addTo(layers.navtech);
    orderedWaypoints.forEach((c, i) => {
        L.circleMarker([c.lat, c.lng], { radius: 4, color: 'var(--primary)', fillColor: 'white', fillOpacity: 1 })
            .addTo(layers.navtech)
            .bindTooltip(`${i+1}: ${c.name}`);
    });
    fitBoundsAll();
}

function parseVona(text) {
    layers.vona.clearLayers();
    const psnMatch = text.match(/PSN:\s*([NS])\s*(\d{2})\s*(\d{2})\s+([EW])\s*(\d{3})\s*(\d{2})/i);
    if (!psnMatch) return;
    const lat = (parseInt(psnMatch[2]) + parseInt(psnMatch[3])/60) * (psnMatch[1].toUpperCase()==='S'?-1:1);
    const lng = (parseInt(psnMatch[5]) + parseInt(psnMatch[6])/60) * (psnMatch[4].toUpperCase()==='W'?-1:1);
    L.marker([lat, lng]).addTo(layers.vona).bindPopup('Volcano PSN');
    fitBoundsAll();
}

function parseNotam(text) {
    layers.notam.clearLayers();
    storedData.notam = [];
    const blocks = text.split(/(?=[A-Z]\d{1,5}\/\d{2}\s+NOTAM[NRC])/m);
    blocks.forEach((block, idx) => {
        const radiusMatch = block.match(/WI\s+(\d+)\s*NM\s+OF\s+PSN\s+([\d\.NSEW]+)\s+([\d\.NSEW]+)/i);
        if (radiusMatch) {
            const radiusNM = parseInt(radiusMatch[1]);
            const lat = dmsToDecimal(radiusMatch[2]);
            const lng = dmsToDecimal(radiusMatch[3]);
            if (lat !== null && lng !== null) {
                L.circle([lat, lng], { radius: radiusNM * 1852, color: '#dc3545', weight: 2 }).addTo(layers.notam);
                storedData.notam.push({ id: 'NOTAM', type: 'circle' });
            }
        }
    });
    fitBoundsAll();
}

function parseTC(text) {
    layers.tc.clearLayers();
    const coordMatch = text.match(/NEAR\s+(\d+\.\d+[NS])\s+(\d+\.\d+[EW])/i);
    if (coordMatch) {
        const lat = dmsToDecimal(coordMatch[1]);
        const lng = dmsToDecimal(coordMatch[2]);
        L.circleMarker([lat, lng], { color: '#8b5cf6' }).addTo(layers.tc).bindPopup('TC Position');
    }
    fitBoundsAll();
}

function fitBoundsAll() {
    const group = new L.featureGroup();
    Object.values(layers).forEach(l => l.eachLayer(layer => group.addLayer(layer)));
    if (group.getLayers().length) map.fitBounds(group.getBounds(), { padding: [40,40] });
}

// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    updateDashboard();
});
