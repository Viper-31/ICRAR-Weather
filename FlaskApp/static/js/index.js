let leafletMap = null;
let markers = [];
let radiusLayers = [];
let hullLayer = null;
let fillLayers = [];
const EMPTY_HULL_STATE = { boundary: [], interior: [], polygon: [], hullType: 'none' };
const createDefaultMapState = () => ({
    points: [],
    hull: {
        boundary: [],
        interior: [],
        polygon: [],
        hullType: 'none'
    },
    fillPoints: []
});
let latestMapCoords = createDefaultMapState();
let lastMapRequestBody = null;
const fillPaintState = { enabled: false, loading: false, values: [], vMin: null, vMax: null };
const hullState = { boundaryStations: [], interiorStations: [] };
const colorMaps = {
    'airTemperature': { scale: 'RdBu_r', gradient: 'linear-gradient(to top, #053061, #2166ac, #d1e5f0, #fddbc7, #d6604d, #67001f)' },
    'relativeHumidity': { scale: 'Blues', gradient: 'linear-gradient(to top, #eff3ff, #6baed6, #08519c)' },
    'wind_3m_degN': { scale: 'Hsv', gradient: 'linear-gradient(to right, red, yellow, green, blue, red)' },
    'default': { scale: 'Viridis', gradient: 'linear-gradient(to top, #440154, #218f8d, #fde725)' }
};
const WA_BOUNDS = [[-36.0, 110.0], [-10.0, 135.0]]; // Lat/Lon bounds covering WA with margin
const WA_BOUNDS_PADDING = 0.05; // extra padding for max bounds
const PLAYBACK_DELAY_MS = 500;
const COVERAGE_RADIUS_METERS = 10000;
const DEFAULT_FILL_STYLE = {
    color: 'rgba(14, 165, 233, 0.45)',
    weight: 1,
    dashArray: '2 6',
    fillColor: 'rgba(14, 165, 233, 0.2)',
    fillOpacity: 0.35
};
const playback = {
    control: null,
    button: null,
    timerId: null,
    isPlaying: false,
    totalSteps: 0,
    currentIdx: 0,
    slider: null,
    updateMarkers: null
};
let configListenersAttached = false;

function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

function computeScalarColor(rawValue, min, max) {
    if (!Number.isFinite(rawValue) || min === null || max === null) {
        return { pct: 0, color: 'rgb(148, 163, 184)' };
    }
    const range = (max - min) || 1;
    const pct = clamp01((rawValue - min) / range);
    const r = Math.floor(255 * pct);
    const b = Math.floor(255 * (1 - pct));
    return { pct, color: `rgb(${r}, 50, ${b})` };
}

function applyDefaultFillStyles() {
    if (!fillLayers.length) return;
    fillLayers.forEach(layer => {
        if (!layer || typeof layer.setStyle !== 'function') return;
        layer.setStyle(DEFAULT_FILL_STYLE);
    });
}

function applyFillColors(timeIdx) {
    if (!fillPaintState.enabled) return;
    if (!fillLayers.length || !Array.isArray(fillPaintState.values) || !fillPaintState.values.length) return;
    const safeIdx = Math.max(0, Math.min(timeIdx, fillPaintState.values.length - 1));
    const valuesForTime = Array.isArray(fillPaintState.values[safeIdx]) ? fillPaintState.values[safeIdx] : [];
    fillLayers.forEach((layer, idx) => {
        if (!layer || typeof layer.setStyle !== 'function') return;
        const val = valuesForTime[idx];
        if (!Number.isFinite(val) || fillPaintState.vMin === null || fillPaintState.vMax === null) {
            layer.setStyle(DEFAULT_FILL_STYLE);
            return;
        }
        const { color } = computeScalarColor(val, fillPaintState.vMin, fillPaintState.vMax);
        layer.setStyle({
            color,
            weight: 0.8,
            dashArray: null,
            fillColor: color,
            fillOpacity: 0.55
        });
        if (typeof layer.bringToBack === 'function') {
            layer.bringToBack();
        }
    });
}

async function setFillPaintEnabled(enabled) {
    const statusText = document.getElementById('status-text');
    if (!enabled) {
        fillPaintState.enabled = false;
        fillPaintState.loading = false;
        applyDefaultFillStyles();
        if (statusText && statusText.innerText.startsWith('Loading weighted')) {
            statusText.innerText = 'Waiting for data...';
        }
        return;
    }

    if (!leafletMap) {
        fillPaintState.enabled = false;
        return;
    }

    if (!latestMapCoords.fillPoints.length) {
        if (statusText) statusText.innerText = 'No fill circles available to colour.';
        const toggle = document.getElementById('fillPaintToggle');
        if (toggle) toggle.checked = false;
        return;
    }

    if (!lastMapRequestBody || lastMapRequestBody.variable !== 'airTemperature') {
        if (statusText) statusText.innerText = 'Colouring only applies to airTemperature.';
        const toggle = document.getElementById('fillPaintToggle');
        if (toggle) toggle.checked = false;
        return;
    }

    if (fillPaintState.loading) return;

    if (fillPaintState.values.length && fillPaintState.vMin !== null && fillPaintState.vMax !== null) {
        fillPaintState.enabled = true;
        applyFillColors(playback.currentIdx || 0);
        if (statusText) statusText.innerText = 'Weighted fill values ready.';
        return;
    }

    fillPaintState.loading = true;
    if (statusText) statusText.innerText = 'Loading weighted fill values...';
    try {
        const res = await fetch('/fill_values', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(lastMapRequestBody)
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        fillPaintState.values = Array.isArray(data.fill_values) ? data.fill_values : [];
        fillPaintState.vMin = typeof data.v_min === 'number' ? data.v_min : null;
        fillPaintState.vMax = typeof data.v_max === 'number' ? data.v_max : null;
        const toggle = document.getElementById('fillPaintToggle');
        if (!toggle || !toggle.checked) {
            fillPaintState.enabled = false;
            applyDefaultFillStyles();
            return;
        }
        fillPaintState.enabled = true;
        applyFillColors(playback.currentIdx || 0);
        if (statusText) statusText.innerText = 'Weighted fill values ready.';
    } catch (err) {
        console.error(err);
        fillPaintState.enabled = false;
        fillPaintState.values = [];
        fillPaintState.vMin = null;
        fillPaintState.vMax = null;
        const toggle = document.getElementById('fillPaintToggle');
        if (toggle) toggle.checked = false;
        if (statusText) statusText.innerText = err.message;
        applyDefaultFillStyles();
    } finally {
        fillPaintState.loading = false;
    }
}

function clearRadiusOverlays() {
    if (!radiusLayers.length) return;
    radiusLayers.forEach(layer => {
        if (leafletMap && layer && leafletMap.hasLayer(layer)) {
            leafletMap.removeLayer(layer);
        }
    });
    radiusLayers = [];
}

function updateRadiusOverlays(enabled) {
    clearRadiusOverlays();
    if (!enabled || !leafletMap) return;
    const points = Array.isArray(latestMapCoords.points) ? latestMapCoords.points : [];
    if (!points.length) return;
    radiusLayers = points.map((point) => {
        const { lat, lon } = point || {};
        if (typeof lat !== 'number' || typeof lon !== 'number') return null;
        const circle = L.circle([lat, lon], {
            radius: COVERAGE_RADIUS_METERS,
            color: 'rgba(37, 99, 235, 0.65)',
            weight: 1.5,
            dashArray: '6 4',
            fillColor: 'rgba(37, 99, 235, 0.18)',
            fillOpacity: 0.3
        });
        circle.addTo(leafletMap);
        return circle;
    }).filter(Boolean);
}

function clearFillOverlays() {
    if (!fillLayers.length) return;
    fillLayers.forEach(layer => {
        if (leafletMap && layer && leafletMap.hasLayer(layer)) {
            leafletMap.removeLayer(layer);
        }
    });
    fillLayers = [];
}

function updateFillOverlays(enabled) {
    clearFillOverlays();
    if (!enabled || !leafletMap) return;
    const candidates = Array.isArray(latestMapCoords.fillPoints) ? latestMapCoords.fillPoints : [];
    if (!candidates.length) return;
    fillLayers = candidates.map((point) => {
        const { lat, lon } = point || {};
        if (typeof lat !== 'number' || typeof lon !== 'number') return null;
        const circle = L.circle([lat, lon], {
            radius: COVERAGE_RADIUS_METERS,
            ...DEFAULT_FILL_STYLE
        });
        circle.addTo(leafletMap);
        if (typeof circle.bringToBack === 'function') circle.bringToBack();
        return circle;
    }).filter(Boolean);
    if (fillPaintState.enabled && fillPaintState.values.length) {
        applyFillColors(playback.currentIdx || 0);
    }
}

function clearHullOverlay() {
    if (leafletMap && hullLayer && leafletMap.hasLayer(hullLayer)) {
        leafletMap.removeLayer(hullLayer);
    }
    hullLayer = null;
    hullState.boundaryStations = [];
    hullState.interiorStations = [];
}

function updateHullOverlay(enabled) {
    clearHullOverlay();
    if (!enabled || !leafletMap) return;
    const hullInfo = (latestMapCoords && latestMapCoords.hull) ? latestMapCoords.hull : EMPTY_HULL_STATE;
    const boundary = Array.isArray(hullInfo.boundary) ? hullInfo.boundary : [];
    const interior = Array.isArray(hullInfo.interior) ? hullInfo.interior : [];
    const polygonCoords = Array.isArray(hullInfo.polygon) ? hullInfo.polygon : [];

    if (!boundary.length || !polygonCoords.length) {
        hullState.boundaryStations = [];
        hullState.interiorStations = [];
        return;
    }

    hullState.boundaryStations = boundary.map(p => (p && p.station) || null).filter(Boolean);
    hullState.interiorStations = interior.map(p => (p && p.station) || null).filter(Boolean);

    const latLngs = polygonCoords
        .map((pair) => (Array.isArray(pair) && pair.length === 2) ? [pair[0], pair[1]] : null)
        .filter((coords) => Array.isArray(coords) && typeof coords[0] === 'number' && typeof coords[1] === 'number');

    if (!latLngs.length) return;

    if (hullInfo.hullType === 'polyline' || latLngs.length === 2) {
        hullLayer = L.polyline(latLngs, {
            color: '#f97316',
            weight: 2,
            dashArray: '4 6'
        }).addTo(leafletMap);
        return;
    }

    hullLayer = L.polygon(latLngs, {
        color: '#f97316',
        weight: 2,
        fillColor: 'rgba(249, 115, 22, 0.18)',
        fillOpacity: 0.25
    }).addTo(leafletMap);
}

function ensurePlaybackControl(mapInstance) {
    if (!mapInstance) return;
    if (!playback.control) {
        playback.control = L.control({ position: 'topleft' });
        playback.control.onAdd = function() {
            const container = L.DomUtil.create('div', 'leaflet-control leaflet-bar playback-control');
            const btn = L.DomUtil.create('button', 'playback-btn', container);
            btn.type = 'button';
            btn.innerText = '▶';
            btn.title = 'Play timeline';
            btn.disabled = true;
            btn.addEventListener('click', (evt) => {
                evt.preventDefault();
                evt.stopPropagation();
                togglePlayback();
            });
            L.DomEvent.disableClickPropagation(container);
            L.DomEvent.disableScrollPropagation(container);
            playback.button = btn;
            return container;
        };
        playback.control.onRemove = function() {
            playback.button = null;
        };
    }
    playback.control.addTo(mapInstance);
}

function pausePlayback() {
    if (playback.timerId) {
        clearInterval(playback.timerId);
        playback.timerId = null;
    }
    playback.isPlaying = false;
    if (playback.button) {
        playback.button.innerText = '▶';
        playback.button.title = 'Play timeline';
        playback.button.classList.remove('playing');
    }
}

function disposePlayback(removeControl = false) {
    pausePlayback();
    playback.slider = null;
    playback.updateMarkers = null;
    playback.totalSteps = 0;
    playback.currentIdx = 0;
    if (playback.button) {
        playback.button.disabled = true;
        playback.button.innerText = '▶';
        playback.button.title = 'Play timeline';
        playback.button.classList.remove('playing', 'playback-attention');
    }
    if (removeControl && playback.control) {
        playback.control.remove();
        playback.control = null;
    }
}

function initializePlayback(sliderEl, totalSteps, updateFn) {
    if (!leafletMap) return;
    ensurePlaybackControl(leafletMap);
    pausePlayback();
    playback.slider = sliderEl;
    playback.totalSteps = totalSteps;
    playback.updateMarkers = updateFn;
    playback.currentIdx = parseInt(sliderEl.value || '0', 10) || 0;
    if (playback.button) {
        playback.button.disabled = totalSteps <= 1;
        playback.button.innerText = '▶';
        playback.button.title = totalSteps <= 1 ? 'Timeline needs multiple steps' : 'Play timeline';
        playback.button.classList.remove('playing', 'playback-attention');
    }
}

function clearPlaybackAttention() {
    if (playback.button) playback.button.classList.remove('playback-attention');
}

function finishPlayback() {
    pausePlayback();
    if (playback.slider && playback.totalSteps > 0) {
        const lastIndex = playback.totalSteps - 1;
        playback.slider.value = lastIndex;
    }
    if (playback.button) {
        playback.button.disabled = false;
        playback.button.classList.add('playback-attention');
    }
}

function startPlayback() {
    if (!playback.slider || !playback.updateMarkers) return;
    if (playback.timerId) {
        clearInterval(playback.timerId);
        playback.timerId = null;
    }
    if (playback.totalSteps > 0 && playback.currentIdx >= playback.totalSteps - 1) {
        playback.slider.value = 0;
        playback.updateMarkers(0);
    }
    playback.isPlaying = true;
    if (playback.button) {
        playback.button.disabled = false;
        playback.button.innerText = '⏸';
        playback.button.title = 'Pause timeline';
        playback.button.classList.add('playing');
        playback.button.classList.remove('playback-attention');
    }
    playback.timerId = setInterval(() => {
        if (!playback.slider || !playback.updateMarkers) {
            pausePlayback();
            return;
        }
        const nextIndex = playback.currentIdx + 1;
        if (nextIndex >= playback.totalSteps) {
            finishPlayback();
            return;
        }
        playback.slider.value = nextIndex;
        playback.updateMarkers(nextIndex);
    }, PLAYBACK_DELAY_MS);
}

function togglePlayback() {
    if (!playback.button || playback.button.disabled) return;
    if (playback.isPlaying) {
        pausePlayback();
    } else {
        startPlayback();
    }
}

function handleConfigChange() {
    disposePlayback(false);
    clearRadiusOverlays();
    clearHullOverlay();
    clearFillOverlays();
    const fillToggle = document.getElementById('fillToggle');
    if (fillToggle) fillToggle.checked = false;
    const fillPaintToggle = document.getElementById('fillPaintToggle');
    if (fillPaintToggle) fillPaintToggle.checked = false;
    fillPaintState.enabled = false;
    fillPaintState.values = [];
    fillPaintState.vMin = null;
    fillPaintState.vMax = null;
    lastMapRequestBody = null;
    latestMapCoords = createDefaultMapState();
}

function attachConfigChangeHandlers() {
    if (configListenersAttached) return;
    const startInput = document.getElementById('startDate');
    const endInput = document.getElementById('endDate');
    const stationSelect = document.getElementById('stationDropdown');
    if (startInput) startInput.addEventListener('change', handleConfigChange);
    if (endInput) endInput.addEventListener('change', handleConfigChange);
    if (stationSelect) stationSelect.addEventListener('change', handleConfigChange);
    document.querySelectorAll('input[name="windComponent"]').forEach(r => r.addEventListener('change', handleConfigChange));
    const radiusToggle = document.getElementById('radiusToggle');
    if (radiusToggle) {
        radiusToggle.addEventListener('change', (evt) => {
            if (!leafletMap) return;
            updateRadiusOverlays(evt.target.checked);
        });
    }
    const borderToggle = document.getElementById('borderToggle');
    if (borderToggle) {
        borderToggle.addEventListener('change', (evt) => {
            if (!leafletMap) return;
            updateHullOverlay(evt.target.checked);
        });
    }
    const fillToggle = document.getElementById('fillToggle');
    if (fillToggle) {
        fillToggle.addEventListener('change', (evt) => {
            if (!leafletMap) return;
            updateFillOverlays(evt.target.checked);
            if (!evt.target.checked) {
                const fillPaintToggle = document.getElementById('fillPaintToggle');
                if (fillPaintToggle) fillPaintToggle.checked = false;
                setFillPaintEnabled(false);
            } else if (fillPaintState.enabled && fillPaintState.values.length) {
                applyFillColors(playback.currentIdx || 0);
            }
        });
    }
    const fillPaintToggle = document.getElementById('fillPaintToggle');
    if (fillPaintToggle) {
        fillPaintToggle.addEventListener('change', async (evt) => {
            if (!leafletMap) {
                evt.target.checked = false;
                return;
            }
            if (evt.target.checked) {
                const fillToggleInstance = document.getElementById('fillToggle');
                if (fillToggleInstance && !fillToggleInstance.checked) {
                    fillToggleInstance.checked = true;
                    updateFillOverlays(true);
                }
            }
            await setFillPaintEnabled(evt.target.checked);
        });
    }
    configListenersAttached = true;
}

function teardownMap() {
    disposePlayback(true);
    if (leafletMap) {
        leafletMap.remove();
        leafletMap = null;
    }
    markers = [];
    clearRadiusOverlays();
    clearHullOverlay();
    clearFillOverlays();
    fillPaintState.enabled = false;
    fillPaintState.values = [];
    fillPaintState.vMin = null;
    fillPaintState.vMax = null;
    const paintToggle = document.getElementById('fillPaintToggle');
    if (paintToggle) paintToggle.checked = false;
    lastMapRequestBody = null;
    latestMapCoords = createDefaultMapState();
    const targetArea = document.getElementById('target-area');
    if (window.Plotly && typeof Plotly.purge === 'function') {
        Plotly.purge(targetArea);
    }
    targetArea.innerHTML = '';
    targetArea.removeAttribute('class');
    targetArea.removeAttribute('style');
    document.getElementById('right-ui-stack').style.display = 'none';
}

function updateVariableDependentUI() {
    const windCard = document.getElementById('windComponentSelector');
    const radiusCard = document.getElementById('radiusSelector');
    const radiusToggle = document.getElementById('radiusToggle');
    const borderToggle = document.getElementById('borderToggle');
    const fillToggle = document.getElementById('fillToggle');
    const fillPaintToggle = document.getElementById('fillPaintToggle');
    const mode = document.getElementById('viewMode').value;
    const selectedVar = document.querySelector('input[name="vItem"]:checked')?.value;

    const shouldShowWind = mode === 'graph' && selectedVar === 'wind_3m';
    if (windCard) {
        windCard.classList.toggle('hidden', !shouldShowWind);
        if (!shouldShowWind) {
            const defaultOption = document.querySelector('input[name="windComponent"][value="speed"]');
            if (defaultOption) defaultOption.checked = true;
        }
    }

    const shouldShowRadius = mode === 'map' && selectedVar === 'airTemperature';
    if (radiusCard) {
        radiusCard.classList.toggle('hidden', !shouldShowRadius);
        if (!shouldShowRadius) {
            if (radiusToggle) radiusToggle.checked = false;
            if (borderToggle) borderToggle.checked = false;
            if (fillPaintToggle) fillPaintToggle.checked = false;
            clearRadiusOverlays();
            clearHullOverlay();
            setFillPaintEnabled(false);
        } else {
            const hasPoints = Array.isArray(latestMapCoords.points) && latestMapCoords.points.length > 0;
            if (radiusToggle && radiusToggle.checked && leafletMap && hasPoints) {
                updateRadiusOverlays(true);
            }
            if (borderToggle && borderToggle.checked && leafletMap && hasPoints) {
                updateHullOverlay(true);
            }
            if (fillToggle && fillToggle.checked && leafletMap && latestMapCoords.fillPoints.length) {
                updateFillOverlays(true);
                if (fillPaintToggle && fillPaintToggle.checked) {
                    applyFillColors(playback.currentIdx || 0);
                }
            }
        }
    }
}

function attachVariableListeners() {
    const varStack = document.getElementById('varStack');
    if (!varStack) return;
    varStack.querySelectorAll('input[name="vItem"]').forEach(radio => {
        radio.addEventListener('change', () => {
            handleConfigChange();
            updateVariableDependentUI();
        });
    });
    updateVariableDependentUI();
}

function toggleViewUI() {
    const mode = document.getElementById('viewMode').value;
    document.getElementById('stationSelector').classList.toggle('hidden', mode === 'map');
    document.getElementById('timeSliderCard').classList.add('hidden');
    if (mode === 'graph') {
        teardownMap();
    } else if (window.Plotly && typeof Plotly.purge === 'function') {
        const targetArea = document.getElementById('target-area');
        Plotly.purge(targetArea);
        targetArea.innerHTML = '';
        targetArea.removeAttribute('class');
        targetArea.removeAttribute('style');
        document.getElementById('right-ui-stack').style.display = 'none';
    }
    document.getElementById('empty-state').style.display = 'flex';
    document.getElementById('spinner').style.display = 'none';
    document.getElementById('status-text').innerText = 'Waiting for data...';
    updateVariableDependentUI();
}

async function uploadFile() {
    const fileInput = document.getElementById('fileInput');
    const uploadBtn = document.getElementById('uploadBtn');
    const statusText = document.getElementById('status-text');
    const spinner = document.getElementById('spinner');
    if(!fileInput.files[0]) return;

    fileInput.disabled = true;
    uploadBtn.disabled = true;
    spinner.style.display = "block";
    statusText.innerHTML = `Processing <b>${fileInput.files[0].name}</b>...`;

    const fd = new FormData(); fd.append('file', fileInput.files[0]);
    try {
        const res = await fetch('/upload', { method: 'POST', body: fd });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        document.getElementById('varStack').innerHTML = data.variables.map(v => `
            <label class="var-row"><input type="radio" name="vItem" value="${v}"> ${v}</label>`).join('');
        document.getElementById('stationDropdown').innerHTML = data.stations.map(s => `<option value="${s}">${s}</option>`).join('');
        document.getElementById('startDate').value = data.date_range[0];
        document.getElementById('endDate').value = data.date_range[1];
        document.getElementById('configSection').classList.remove('hidden');
        attachVariableListeners();
        attachConfigChangeHandlers();
        statusText.innerHTML = "Dataset Ready.";
    } catch (err) { statusText.innerHTML = `<span style="color:red">Error: ${err.message}</span>`;
    } finally { uploadBtn.disabled = false; fileInput.disabled = false; spinner.style.display = "none"; }
}

async function renderMap(varName) {
    try {
        teardownMap();
        const payload = {
            variable: varName,
            start_date: document.getElementById('startDate').value,
            end_date: document.getElementById('endDate').value
        };
        lastMapRequestBody = payload;
        fillPaintState.enabled = false;
        fillPaintState.values = [];
        fillPaintState.vMin = null;
        fillPaintState.vMax = null;
        const fillPaintToggle = document.getElementById('fillPaintToggle');
        if (fillPaintToggle) fillPaintToggle.checked = false;
        const res = await fetch('/map_data', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        const d = await res.json();
        if (d.error) throw new Error(d.error);

        if (leafletMap) leafletMap.remove();

        const waBounds = L.latLngBounds(WA_BOUNDS);
        const paddedBounds = waBounds.pad(WA_BOUNDS_PADDING);
        leafletMap = L.map('target-area', {
            maxBounds: paddedBounds,
            maxBoundsViscosity: 0.8
        });
        leafletMap.fitBounds(waBounds, { padding: [30, 30] });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(leafletMap);

        const theme = colorMaps[varName] || colorMaps['default'];
        const isCombinedWind = (varName === 'wind_3m');
        const isWindDeg = (varName === 'wind_3m_degN');
        const isWindSpeed = (varName === 'wind_3m_speed');

        document.getElementById('color-bar').style.background = theme.gradient;
        document.getElementById('max-val').innerText = d.v_max.toFixed(1);
        document.getElementById('min-val').innerText = d.v_min.toFixed(1);

        const updateMarkers = (timeIdx) => {
            playback.currentIdx = timeIdx;
            clearPlaybackAttention();
            markers.forEach((m, i) => {
                const element = m.getElement();
                if (!element) return;

                const raw = d.values[timeIdx][i];
                let speedVal = 0;
                let angleVal = null;

                if (isCombinedWind) {
                    const speedCandidate = Array.isArray(raw) ? raw[0] : raw;
                    const angleCandidate = Array.isArray(raw) ? raw[1] : null;
                    speedVal = Number.isFinite(speedCandidate) ? speedCandidate : 0;
                    angleVal = Number.isFinite(angleCandidate) ? angleCandidate : 0;
                } else {
                    speedVal = Number.isFinite(raw) ? raw : 0;
                    angleVal = isWindDeg ? (Number.isFinite(raw) ? raw : 0) : null;
                }

                const { pct, color } = computeScalarColor(speedVal, d.v_min, d.v_max);

                const rotator = element.querySelector('.rotator');
                if (rotator) {
                    // --- SHORTEST PATH ROTATION LOGIC ---
                    if (angleVal !== null || isCombinedWind) {
                        // 1. Calculate the target (subtract 90 to align SVG East to North)
                        const targetBase = (angleVal !== null) ? angleVal : 0;
                        const targetAngle = targetBase - 90;

                        // 2. Get previous total rotation
                        let prevAngle = m._lastAngle || 0;

                        // 3. Calculate shortest difference
                        let diff = (targetAngle - prevAngle) % 360;
                        if (diff > 180) diff -= 360;
                        if (diff < -180) diff += 360;

                        // 4. Update cumulative angle
                        const newAngle = prevAngle + diff;
                        rotator.style.setProperty('--rot', `${newAngle}deg`);
                        
                        // 5. Store it back on the marker object
                        m._lastAngle = newAngle;
                    }

                    // --- SCALE & COLOR ---
                    if (isCombinedWind || isWindSpeed) {
                        rotator.style.setProperty('--size', 0.5 + (pct * 1.5));
                    }
                    
                    const paths = element.querySelectorAll('.arrow-fill');
                    paths.forEach(p => {
                        p.setAttribute('stroke', color);
                        p.setAttribute('fill', 'none');
                    });
                } else {
                    const square = element.querySelector('.square-inner');
                    if (square) square.style.backgroundColor = color;
                }
            });
            document.getElementById('active-time').innerText = d.time_labels[timeIdx];
            document.getElementById('timeLabel').innerText = d.time_labels[timeIdx];
            applyFillColors(timeIdx);
        };

        // Create the markers
        markers = d.lats.map((lat, i) => {
            let html = '';
            if (isCombinedWind || isWindDeg || isWindSpeed) {
                // Updated SVG for a thin line arrow
                html = `<div class="rotator">
                    <svg class="arrow-svg" viewBox="0 0 24 24">
                        <g class="arrow-group">
                            <line x1="2" y1="12" x2="21" y2="12" class="arrow-path arrow-fill" />
                            <polyline points="15 6 21 12 15 18" class="arrow-path arrow-fill" />
                        </g>
                    </svg>
                </div>`;
            } else {
                html = `<div class="square-inner"></div>`;
            }
            
            const icon = L.divIcon({ className: 'marker-icon', html: html, iconSize: [32,32] });

            const m = L.marker([lat, d.lons[i]], { icon }).addTo(leafletMap).bindPopup(`${d.stations[i]}`);
            m._lastAngle = 0;
            return m;
        });

        const stationPoints = Array.isArray(d.stations_meta) && d.stations_meta.length
            ? d.stations_meta.map((p) => {
                const latCandidate = p && typeof p.lat === 'number' ? p.lat : null;
                const lonCandidate = p && typeof p.lon === 'number' ? p.lon : null;
                const stationCandidate = p ? p.station : undefined;
                return { lat: latCandidate, lon: lonCandidate, station: stationCandidate };
            })
            : d.lats.map((lat, idx) => {
                const lonCandidate = Array.isArray(d.lons) ? d.lons[idx] : undefined;
                const stationCandidate = Array.isArray(d.stations) ? d.stations[idx] : undefined;
                return {
                    lat: typeof lat === 'number' ? lat : null,
                    lon: typeof lonCandidate === 'number' ? lonCandidate : null,
                    station: stationCandidate
                };
            });

        const rawHull = d.hull && typeof d.hull === 'object' ? d.hull : {};
        const fillPoints = Array.isArray(d.fill_circles)
            ? d.fill_circles
                .map((circle) => {
                    const latCandidate = circle && typeof circle.lat === 'number' ? circle.lat : null;
                    const lonCandidate = circle && typeof circle.lon === 'number' ? circle.lon : null;
                    return { lat: latCandidate, lon: lonCandidate };
                })
                .filter(point => typeof point.lat === 'number' && typeof point.lon === 'number')
            : [];
        latestMapCoords = {
            points: stationPoints,
            hull: {
                boundary: Array.isArray(rawHull.boundary) ? rawHull.boundary : [],
                interior: Array.isArray(rawHull.interior) ? rawHull.interior : [],
                polygon: Array.isArray(rawHull.polygon) ? rawHull.polygon : [],
                hullType: typeof rawHull.hullType === 'string' ? rawHull.hullType : 'none'
            },
            fillPoints
        };
        updateVariableDependentUI();
        const radiusToggle = document.getElementById('radiusToggle');
        const borderToggle = document.getElementById('borderToggle');
        const fillToggle = document.getElementById('fillToggle');
        if (varName === 'airTemperature') {
            if (radiusToggle && radiusToggle.checked) {
                updateRadiusOverlays(true);
            }
            if (borderToggle && borderToggle.checked) {
                updateHullOverlay(true);
            }
            if (fillToggle && fillToggle.checked) {
                updateFillOverlays(true);
            }
        }

        const slider = document.getElementById('timeSlider');
        slider.max = d.time_labels.length - 1;
        slider.value = 0;
        slider.oninput = (e) => {
            const idx = parseInt(e.target.value, 10);
            if (Number.isNaN(idx)) return;
            if (playback.isPlaying) pausePlayback();
            clearPlaybackAttention();
            updateMarkers(idx);
        };

        initializePlayback(slider, d.time_labels.length, updateMarkers);
        // Wait a tiny bit for the markers to hit the DOM before the first update
        setTimeout(() => updateMarkers(0), 10);
        
        document.getElementById('timeSliderCard').classList.remove('hidden');
        document.getElementById('empty-state').style.display = 'none';
        document.getElementById('right-ui-stack').style.display = 'flex';
        document.getElementById('active-var').innerText = varName;
    } catch (err) { 
        console.error(err);
        document.getElementById('status-text').innerText = err.message;
        document.getElementById('spinner').style.display = 'none';
        clearRadiusOverlays();
        clearHullOverlay();
        clearFillOverlays();
        latestMapCoords = createDefaultMapState();
        disposePlayback(true);
    }
}

async function renderGraph(datasetVar, displayLabel) {
    try {
        teardownMap();
        const res = await fetch('/plot', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ variables: [datasetVar], station: document.getElementById('stationDropdown').value, start_date: document.getElementById('startDate').value, end_date: document.getElementById('endDate').value })
        });
        const d = await res.json();
        if (d.error) throw new Error(d.error);
        const series = d[datasetVar];
        if (!series) throw new Error('No series returned for selection.');
        document.getElementById('empty-state').style.display = 'none';
        document.getElementById('timeSliderCard').classList.add('hidden');
        Plotly.newPlot('target-area', [{ x: series.x, y: series.y, type: 'scatter', mode: 'lines+markers', name: displayLabel }], { title: displayLabel });
        document.getElementById('right-ui-stack').style.display = 'none';
    } catch (err) { 
        console.error(err);
        document.getElementById('spinner').style.display = 'none';
        document.getElementById('status-text').innerText = err.message;
        document.getElementById('empty-state').style.display = 'flex';
    }
}

async function runVisualization() {
    const mode = document.getElementById('viewMode').value;
    const varName = document.querySelector('input[name="vItem"]:checked')?.value;
    if(!varName) return alert("Select a variable!");
    let datasetVar = varName;
    let displayLabel = varName;
    if (mode === 'graph' && varName === 'wind_3m') {
        const component = document.querySelector('input[name="windComponent"]:checked')?.value || 'speed';
        if (component === 'angle') {
            datasetVar = 'wind_3m_degN';
            displayLabel = 'Wind Direction (degN)';
        } else {
            datasetVar = 'wind_3m_speed';
            displayLabel = 'Wind Speed (3m)';
        }
    }
    document.getElementById('empty-state').style.display = 'flex';
    if (mode === 'map') await renderMap(varName);
    else await renderGraph(datasetVar, displayLabel);
}
