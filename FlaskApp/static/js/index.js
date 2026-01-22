let appMode = 'dpird'; // 'dpird' or 'ecmwf'
const dpirdViewState = {
    mode: null,          // 'map' or 'graph'
    varName: null,       // DPIRD logical variable (e.g. 'airTemperature' or 'wind_3m')
    datasetVar: null,    // Underlying dataset var used for graph
    displayLabel: null,  // Graph label
    timeIdx: 0           // Last timeline index for map mode
};
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
// ECMWF colormap mappings (approximate equivalents of the Python mappings)
const ECMWF_VAR_CMAPS = {
    t2m: 'coolwarm',
    d2m: 'coolwarm',
    msl: 'Spectral_r',
    sh2: 'GnBu',
    swvl1: 'YlGnBu',
    cp: 'Purples',
    tp: 'Blues',
    lsp: 'GnBu',
    i10fg: 'Reds',
    tcc: 'Greys_trunc',
    lcc: 'Greys_trunc',
    mcc: 'Greys_trunc',
    hcc: 'Greys_trunc'
};

const ECMWF_PREFIX_CMAPS = {
    z: 'copper',
    t: 'coolwarm',
    r: 'YlGnBu',
    q: 'GnBu',
    w: 'RdBu_r'
};

// Gradient definitions (CSS) and colour stops (for marker/overlay colouring)
const ECMWF_CMAP_DEFS = {
    coolwarm: {
        gradient: 'linear-gradient(to top, #0022ff, #ff0000)',
        stops: [
            { pos: 0.0, color: [59, 76, 192] },
            { pos: 1.0, color: [180, 4, 38] }
        ]
    },
    Spectral_r: {
        gradient: 'linear-gradient(to top, #5e4fa2, #3288bd, #66c2a5, #fdae61, #d53e4f, #9e0142)',
        stops: [
            { pos: 0.0, color: [94, 79, 162] },
            { pos: 0.25, color: [50, 136, 189] },
            { pos: 0.5, color: [102, 194, 165] },
            { pos: 0.75, color: [253, 174, 97] },
            { pos: 1.0, color: [158, 1, 66] }
        ]
    },
    GnBu: {
        gradient: 'linear-gradient(to top, #f7fcf0, #7bccc4, #084081)',
        stops: [
            { pos: 0.0, color: [247, 252, 240] },
            { pos: 0.5, color: [123, 204, 196] },
            { pos: 1.0, color: [8, 64, 129] }
        ]
    },
    YlGnBu: {
        gradient: 'linear-gradient(to top, #ffffd9, #41b6c4, #081d58)',
        stops: [
            { pos: 0.0, color: [255, 255, 217] },
            { pos: 0.5, color: [65, 182, 196] },
            { pos: 1.0, color: [8, 29, 88] }
        ]
    },
    Purples: {
        gradient: 'linear-gradient(to top, #f2f0f7, #9e9ac8, #3f007d)',
        stops: [
            { pos: 0.0, color: [242, 240, 247] },
            { pos: 0.5, color: [158, 154, 200] },
            { pos: 1.0, color: [63, 0, 125] }
        ]
    },
    Blues: {
        gradient: 'linear-gradient(to top, #eff3ff, #6baed6, #08519c)',
        stops: [
            { pos: 0.0, color: [239, 243, 255] },
            { pos: 0.5, color: [107, 174, 214] },
            { pos: 1.0, color: [8, 81, 156] }
        ]
    },
    Reds: {
        gradient: 'linear-gradient(to top, #fee0d2, #fc9272, #cb181d)',
        stops: [
            { pos: 0.0, color: [254, 224, 210] },
            { pos: 0.5, color: [252, 146, 114] },
            { pos: 1.0, color: [203, 24, 29] }
        ]
    },
    copper: {
        gradient: 'linear-gradient(to top, #000000, #b87333, #ffdead)',
        stops: [
            { pos: 0.0, color: [0, 0, 0] },
            { pos: 0.5, color: [184, 115, 51] },
            { pos: 1.0, color: [255, 222, 173] }
        ]
    },
    RdBu_r: {
        gradient: 'linear-gradient(to top, #053061, #2166ac, #f7f7f7, #b2182b, #67001f)',
        stops: [
            { pos: 0.0, color: [5, 48, 97] },
            { pos: 0.5, color: [247, 247, 247] },
            { pos: 1.0, color: [103, 0, 31] }
        ]
    },
    Greys_trunc: {
        gradient: 'linear-gradient(to top, #f7f7f7, #bdbdbd, #636363)',
        stops: [
            { pos: 0.0, color: [247, 247, 247] },
            { pos: 0.5, color: [189, 189, 189] },
            { pos: 1.0, color: [99, 99, 99] }
        ]
    },
    viridis: {
        gradient: 'linear-gradient(to top, #440154, #218f8d, #fde725)',
        stops: [
            { pos: 0.0, color: [68, 1, 84] },
            { pos: 0.5, color: [33, 143, 141] },
            { pos: 1.0, color: [253, 231, 37] }
        ]
    }
};

function getEcmwfCmapName(varName) {
    if (!varName) return 'viridis';
    if (Object.prototype.hasOwnProperty.call(ECMWF_VAR_CMAPS, varName)) {
        return ECMWF_VAR_CMAPS[varName];
    }
    const prefixes = Object.keys(ECMWF_PREFIX_CMAPS);
    for (let i = 0; i < prefixes.length; i++) {
        const p = prefixes[i];
        if (varName.startsWith(p)) {
            return ECMWF_PREFIX_CMAPS[p];
        }
    }
    return 'viridis';
}

function getEcmwfCmapDef(name) {
    return ECMWF_CMAP_DEFS[name] || ECMWF_CMAP_DEFS.viridis;
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function sampleEcmwfColormap(pct, cmapName) {
    const t = clamp01(pct);
    const def = getEcmwfCmapDef(cmapName);
    const stops = def.stops;
    if (!Array.isArray(stops) || !stops.length) {
        const c = [255 * t, 255 * t, 255 * t];
        return `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;
    }
    if (t <= stops[0].pos) {
        const c = stops[0].color;
        return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    }
    if (t >= stops[stops.length - 1].pos) {
        const c = stops[stops.length - 1].color;
        return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    }
    for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i];
        const b = stops[i + 1];
        if (t >= a.pos && t <= b.pos) {
            const span = (b.pos - a.pos) || 1;
            const localT = (t - a.pos) / span;
            const r = lerp(a.color[0], b.color[0], localT);
            const g = lerp(a.color[1], b.color[1], localT);
            const bch = lerp(a.color[2], b.color[2], localT);
            return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(bch)})`;
        }
    }
    const c = stops[stops.length - 1].color;
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
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
const ecmwfState = {
    timeLabels: [],
    vMin: null,
    vMax: null,
    currentIdx: 0,
    layer: null,
    variables: [],
    currentVar: null,
    rangeStart: 0,
    rangeEnd: 0,
    dateLabels: [],
    dateStartIndices: [],
    dateEndIndices: [],
    stepValues: [],
    timeCount: 0,
    stepCount: 0,
    timeIndex: 0,
    stepIndex: 0,
    useContours: false,
    hasFitted: false,
    heatLayer: null,
    cmapName: 'viridis'
};

function setLoading(isLoading, message) {
    const spinner = document.getElementById('spinner');
    const statusText = document.getElementById('status-text');
    const viz = document.getElementById('viz-container');
    if (spinner) spinner.style.display = isLoading ? 'block' : 'none';
    if (viz) viz.setAttribute('aria-busy', isLoading ? 'true' : 'false');
    if (statusText && typeof message === 'string') {
        statusText.innerText = message;
    }
}

function setDateError(message) {
    const errEl = document.getElementById('dateError');
    if (!errEl) return;
    errEl.textContent = message || '';
}

function validateDpirdConfig() {
    const renderBtn = document.getElementById('renderBtn');
    if (!renderBtn) return;
    const modeSel = document.getElementById('viewMode');
    const startInput = document.getElementById('startDate');
    const endInput = document.getElementById('endDate');
    const stationSelect = document.getElementById('stationDropdown');
    const mode = modeSel ? modeSel.value : 'map';
    const startVal = startInput ? startInput.value : '';
    const endVal = endInput ? endInput.value : '';
    const stationVal = stationSelect ? stationSelect.value : '';
    const varSelected = !!document.querySelector('input[name="vItem"]:checked');

    let dateValid = !!startVal && !!endVal;
    if (dateValid && startVal > endVal) {
        dateValid = false;
    }
    if (!dateValid && startVal && endVal) {
        setDateError('End date must be on or after start date.');
    } else {
        setDateError('');
    }

    const stationRequired = mode === 'graph';
    const stationValid = !stationRequired || !!stationVal;

    const ok = varSelected && dateValid && stationValid;
    renderBtn.disabled = !ok;
}

function setAppMode(mode) {
    const prevMode = appMode;
    appMode = mode;
    const dpirdSidebar = document.getElementById('dpirdSidebar');
    const ecmwfSidebar = document.getElementById('ecmwfSidebar');
    if (dpirdSidebar) {
        dpirdSidebar.style.display = (mode === 'dpird') ? '' : 'none';
    }
    if (ecmwfSidebar) {
        ecmwfSidebar.style.display = (mode === 'ecmwf') ? '' : 'none';
    }

    const statusText = document.getElementById('status-text');

    // If we are leaving DPIRD, snapshot its visual state then reset map/plot
    if (prevMode === 'dpird' && mode === 'ecmwf') {
        if (dpirdViewState.mode === 'map') {
            dpirdViewState.timeIdx = playback.currentIdx || 0;
        }
        teardownMap();
        if (rightUi) rightUi.style.display = 'none';
        if (statusText) {
            statusText.innerText = 'ECMWF mode selected. Waiting for ECMWF configuration...';
        }
        // If we already have an ECMWF dataset loaded, restore its view
        if (ecmwfState.timeLabels.length) {
            setupEcmwfMap({
                time_labels: ecmwfState.timeLabels
            }, true);
        }
        return;
    }

    // If we are returning to DPIRD, restore its previous visualisation if any
    if (prevMode === 'ecmwf' && mode === 'dpird') {
        if (statusText && statusText.innerText.startsWith('ECMWF mode selected')) {
            statusText.innerText = 'Waiting for data...';
        }
        // Only attempt restore if we have a remembered state
        if (dpirdViewState.mode === 'map' && dpirdViewState.varName) {
            // Re-render map and restore timeline position
            renderMap(dpirdViewState.varName).then(() => {
                const idx = Math.max(0, Math.min(dpirdViewState.timeIdx || 0, (playback.totalSteps || 1) - 1));
                if (playback.slider && typeof playback.updateMarkers === 'function') {
                    playback.slider.value = idx;
                    playback.updateMarkers(idx);
                }
            }).catch(err => console.error(err));
        } else if (dpirdViewState.mode === 'graph' && dpirdViewState.datasetVar && dpirdViewState.displayLabel) {
            renderGraph(dpirdViewState.datasetVar, dpirdViewState.displayLabel).catch(err => console.error(err));
        }
        return;
    }
}

function onDataModeChange() {
    const select = document.getElementById('dataMode');
    const mode = select ? select.value : 'dpird';
    setAppMode(mode);
}

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
    validateDpirdConfig();
}

function attachConfigChangeHandlers() {
    if (configListenersAttached) return;
    const startInput = document.getElementById('startDate');
    const endInput = document.getElementById('endDate');
    const stationSelect = document.getElementById('stationDropdown');
    if (startInput) {
        startInput.addEventListener('change', handleConfigChange);
        startInput.addEventListener('blur', validateDpirdConfig);
        startInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                validateDpirdConfig();
                const btn = document.getElementById('renderBtn');
                if (btn && !btn.disabled) runVisualization();
            }
        });
    }
    if (endInput) {
        endInput.addEventListener('change', handleConfigChange);
        endInput.addEventListener('blur', validateDpirdConfig);
        endInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                validateDpirdConfig();
                const btn = document.getElementById('renderBtn');
                if (btn && !btn.disabled) runVisualization();
            }
        });
    }
    if (stationSelect) {
        stationSelect.addEventListener('change', handleConfigChange);
        stationSelect.addEventListener('blur', validateDpirdConfig);
        stationSelect.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                validateDpirdConfig();
                const btn = document.getElementById('renderBtn');
                if (btn && !btn.disabled) runVisualization();
            }
        });
    }
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
            validateDpirdConfig();
        });
    });
    updateVariableDependentUI();
    validateDpirdConfig();
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
    validateDpirdConfig();
    updateVariableDependentUI();
}

async function uploadFile() {
    const fileInput = document.getElementById('fileInput');
    const uploadBtn = document.getElementById('uploadBtn');
    if(!fileInput.files[0]) return;

    fileInput.disabled = true;
    uploadBtn.disabled = true;
    setLoading(true, `Processing ${fileInput.files[0].name}...`);

    const fd = new FormData(); fd.append('file', fileInput.files[0]);
    try {
        const res = await fetch('/upload', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'Upload failed');
        document.getElementById('varStack').innerHTML = data.variables.map(v => `
            <label class="var-row"><input type="radio" name="vItem" value="${v}"> ${v}</label>`).join('');
        document.getElementById('stationDropdown').innerHTML = data.stations.map(s => `<option value="${s}">${s}</option>`).join('');
        document.getElementById('startDate').value = data.date_range[0];
        document.getElementById('endDate').value = data.date_range[1];
        document.getElementById('configSection').classList.remove('hidden');
        attachVariableListeners();
        attachConfigChangeHandlers();
        validateDpirdConfig();
        setLoading(false, 'Dataset ready. Choose a variable and view.');
    } catch (err) {
        console.error(err);
        setLoading(false, `Error loading dataset: ${err.message}`);
    } finally {
        uploadBtn.disabled = false;
        fileInput.disabled = false;
    }
}

async function uploadEcmwfFile() {
    if (appMode !== 'ecmwf') return;
    const input = document.getElementById('ecmwfFileInput');
    if (!input || !input.files || !input.files[0]) return;

    const file = input.files[0];
    setLoading(true, `Loading ECMWF file: ${file.name}...`);

    const fd = new FormData();
    fd.append('file', file);
    try {
        const res = await fetch('/ecmwf_upload', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'Upload failed');

        ecmwfState.timeLabels = Array.isArray(data.time_labels) ? data.time_labels : [];
        ecmwfState.stepValues = Array.isArray(data.step_values) ? data.step_values : [];
        ecmwfState.timeCount = typeof data.time_count === 'number' ? data.time_count : ecmwfState.timeLabels.length;
        ecmwfState.stepCount = typeof data.step_count === 'number' ? data.step_count : ecmwfState.stepValues.length;
        ecmwfState.timeIndex = 0;
        ecmwfState.stepIndex = 0;
        ecmwfState.rangeStart = 0;
        ecmwfState.rangeEnd = Math.max(0, ecmwfState.timeLabels.length - 1);

        setupEcmwfMap({ time_labels: ecmwfState.timeLabels }, false);
        initEcmwfConfigUi(data);
        setLoading(false, 'ECMWF dataset loaded. Configure options and click Render.');
    } catch (err) {
        console.error(err);
        setLoading(false, `ECMWF error: ${err.message}`);
    } finally {
    }
}

async function renderMap(varName) {
    if (appMode !== 'dpird') return; // Map rendering currently only for DPIRD mode
    try {
        teardownMap();
        const start_date = document.getElementById('startDate').value;
        const end_date = document.getElementById('endDate').value;
        const mode = 'map';
        const payload = {
            variable: varName,
            start_date,
            end_date,
            station: null,
            mode,
            extra_options: {}
        };
        lastMapRequestBody = payload;
        fillPaintState.enabled = false;
        fillPaintState.values = [];
        fillPaintState.vMin = null;
        fillPaintState.vMax = null;
        const fillPaintToggle = document.getElementById('fillPaintToggle');
        if (fillPaintToggle) fillPaintToggle.checked = false;
        setLoading(true, 'Rendering map view...');
        const res = await fetch('/map_data', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        const d = await res.json();
        if (!res.ok || d.error) throw new Error(d.error || 'Map request failed');

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
            dpirdViewState.timeIdx = timeIdx;
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

        // Remember DPIRD view state for restoring after mode switches
        dpirdViewState.mode = 'map';
        dpirdViewState.varName = varName;
        dpirdViewState.datasetVar = null;
        dpirdViewState.displayLabel = null;
        dpirdViewState.timeIdx = 0;
        setLoading(false, 'Map ready. Use the timeline to explore.');
    } catch (err) { 
        console.error(err);
        setLoading(false, err.message || 'Error rendering map');
        clearRadiusOverlays();
        clearHullOverlay();
        clearFillOverlays();
        latestMapCoords = createDefaultMapState();
        disposePlayback(true);
    }
}

async function renderGraph(datasetVar, displayLabel) {
    if (appMode !== 'dpird') return; // Graph rendering currently only for DPIRD mode
    try {
        teardownMap();
        const start_date = document.getElementById('startDate').value;
        const end_date = document.getElementById('endDate').value;
        const station = document.getElementById('stationDropdown').value;
        const payload = {
            variable: datasetVar,
            start_date,
            end_date,
            station,
            mode: 'graph',
            extra_options: {}
        };
        setLoading(true, 'Rendering graph view...');
        const res = await fetch('/plot', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const d = await res.json();
        if (!res.ok || d.error) throw new Error(d.error || 'Plot request failed');
        const series = d[datasetVar];
        if (!series) throw new Error('No series returned for selection.');
        document.getElementById('empty-state').style.display = 'none';
        document.getElementById('timeSliderCard').classList.add('hidden');
        Plotly.newPlot('target-area', [{ x: series.x, y: series.y, type: 'scatter', mode: 'lines+markers', name: displayLabel }], { title: displayLabel });
        document.getElementById('right-ui-stack').style.display = 'none';
        
        // Remember DPIRD graph state for restoring after mode switches
        dpirdViewState.mode = 'graph';
        dpirdViewState.varName = datasetVar;
        dpirdViewState.datasetVar = datasetVar;
        dpirdViewState.displayLabel = displayLabel;
        dpirdViewState.timeIdx = 0;
        setLoading(false, 'Graph ready.');
    } catch (err) { 
        console.error(err);
        setLoading(false, err.message || 'Error rendering graph');
        document.getElementById('empty-state').style.display = 'flex';
    }
}

async function runVisualization() {
    if (appMode !== 'dpird') {
        alert('Rendering is only available in DPIRD mode right now.');
        return;
    }
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

async function runEcmwfVisualization() {
    if (appMode !== 'ecmwf') {
        alert('ECMWF rendering is only available in ECMWF mode.');
        return;
    }
    setLoading(true, 'Preparing ECMWF view...');
    await updateEcmwfConfigFromUi();
    // Draw a frame using current time/step slider positions after configuration
    const timeSlider = document.getElementById('ecmwfTimeSlider');
    const stepSlider = document.getElementById('ecmwfStepSlider');
    let tIdx = timeSlider ? parseInt(timeSlider.value, 10) : 0;
    let sIdx = stepSlider ? parseInt(stepSlider.value, 10) : 0;
    if (!Number.isFinite(tIdx)) tIdx = 0;
    if (!Number.isFinite(sIdx)) sIdx = 0;
    const contourToggle = document.getElementById('ecmwfContourToggle');
    const useContours = contourToggle ? !!contourToggle.checked : false;
    ecmwfState.useContours = useContours;
    if (useContours) {
        if (!leafletMap && ecmwfState.timeLabels.length) {
            setupEcmwfMap({ time_labels: ecmwfState.timeLabels }, true);
        }
        await renderEcmwfContourPlot(tIdx, sIdx);
    } else {
        if (!leafletMap && ecmwfState.timeLabels.length) {
            setupEcmwfMap({ time_labels: ecmwfState.timeLabels }, true);
        }
        if (ecmwfState.heatLayer && leafletMap && leafletMap.hasLayer(ecmwfState.heatLayer)) {
            leafletMap.removeLayer(ecmwfState.heatLayer);
        }
        await requestEcmwfContours(tIdx, sIdx);
    }
    setLoading(false, '');
}

document.addEventListener('DOMContentLoaded', () => {
    const modeSelect = document.getElementById('dataMode');
    if (modeSelect) {
        setAppMode(modeSelect.value || 'dpird');
    }
    const contourToggle = document.getElementById('ecmwfContourToggle');
    if (contourToggle) {
        contourToggle.addEventListener('change', (e) => {
            ecmwfState.useContours = !!e.target.checked;
            const timeSlider = document.getElementById('ecmwfTimeSlider');
            const stepSlider = document.getElementById('ecmwfStepSlider');
            let tIdx = timeSlider ? parseInt(timeSlider.value, 10) : (ecmwfState.timeIndex || 0);
            let sIdx = stepSlider ? parseInt(stepSlider.value, 10) : (ecmwfState.stepIndex || 0);
            if (!Number.isFinite(tIdx)) tIdx = 0;
            if (!Number.isFinite(sIdx)) sIdx = 0;
            if (ecmwfState.useContours) {
                if (!leafletMap && ecmwfState.timeLabels.length) {
                    setupEcmwfMap({ time_labels: ecmwfState.timeLabels }, true);
                }
                renderEcmwfContourPlot(tIdx, sIdx);
            } else if (ecmwfState.timeLabels.length) {
                if (!leafletMap) {
                    setupEcmwfMap({ time_labels: ecmwfState.timeLabels }, true);
                }
                if (ecmwfState.heatLayer && leafletMap && leafletMap.hasLayer(ecmwfState.heatLayer)) {
                    leafletMap.removeLayer(ecmwfState.heatLayer);
                }
                requestEcmwfContours(tIdx, sIdx);
            }
        });
    }
});

function createEcmwfColor(value) {
    if (!Number.isFinite(value) || ecmwfState.vMin === null || ecmwfState.vMax === null) {
        return 'rgb(148, 163, 184)';
    }
    const range = (ecmwfState.vMax - ecmwfState.vMin) || 1;
    const pct = (value - ecmwfState.vMin) / range;
    const cmap = ecmwfState.cmapName || 'viridis';
    return sampleEcmwfColormap(pct, cmap);
}

async function renderEcmwfContourPlot(timeIndex, stepIndex) {
    const statusText = document.getElementById('status-text');
    try {
        const body = {
            var_name: ecmwfState.currentVar,
            time_index: timeIndex,
            step_index: stepIndex,
            stride: 1
        };
        const res = await fetch('/ecmwf_field', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'ECMWF field request failed');

        ecmwfState.timeIndex = timeIndex;
        ecmwfState.stepIndex = stepIndex;

        const label = data.time_label || `T[${timeIndex}] +S[${stepIndex}]`;
        const timeLabelEl = document.getElementById('ecmwfTimeLabel');
        if (timeLabelEl) timeLabelEl.innerText = label;
        const activeTime = document.getElementById('active-time');
        if (activeTime) activeTime.innerText = label;
        if (statusText) statusText.innerText = label;

        const activeVar = document.getElementById('active-var');
        if (activeVar) activeVar.innerText = ecmwfState.currentVar || 'ECMWF';
        if (!leafletMap) return;

        // Remove any existing ECMWF point layer when drawing the heat overlay
        if (ecmwfState.layer && leafletMap.hasLayer(ecmwfState.layer)) {
            leafletMap.removeLayer(ecmwfState.layer);
            ecmwfState.layer = null;
        }

        const lat = Array.isArray(data.lat) ? data.lat : [];
        const lon = Array.isArray(data.lon) ? data.lon : [];
        const z = Array.isArray(data.z) ? data.z : [];
        if (!lat.length || !lon.length || !z.length) return;

        const width = lon.length;
        const height = lat.length;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(width, height);

        const vMin = ecmwfState.vMin;
        const vMax = ecmwfState.vMax;
        const range = (vMax !== null && vMin !== null) ? (vMax - vMin || 1) : 1;
        const cmap = ecmwfState.cmapName || getEcmwfCmapName(ecmwfState.currentVar || '');
        const latAscending = lat.length > 1 ? (lat[0] < lat[lat.length - 1]) : true;

        let p = 0;
        for (let y = 0; y < height; y++) {
            const latIdx = latAscending ? (height - 1 - y) : y; // ensure north is at top
            const row = Array.isArray(z[latIdx]) ? z[latIdx] : [];
            for (let x = 0; x < width; x++) {
                const vRaw = row[x];
                const v = (typeof vRaw === 'number') ? vRaw : NaN;
                if (!Number.isFinite(v) || vMin === null || vMax === null) {
                    imgData.data[p++] = 0;
                    imgData.data[p++] = 0;
                    imgData.data[p++] = 0;
                    imgData.data[p++] = 0; // transparent where no data
                } else {
                    let pct = (v - vMin) / range;
                    pct = clamp01(pct);
                    const rgb = sampleEcmwfColormap(pct, cmap);
                    const m = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/i);
                    const r = m ? parseInt(m[1], 10) : 0;
                    const g = m ? parseInt(m[2], 10) : 0;
                    const b = m ? parseInt(m[3], 10) : 0;
                    imgData.data[p++] = r;
                    imgData.data[p++] = g;
                    imgData.data[p++] = b;
                    imgData.data[p++] = 200; // alpha
                }
            }
        }

        ctx.putImageData(imgData, 0, 0);
        const url = canvas.toDataURL('image/png');

        const minLat = Math.min.apply(null, lat);
        const maxLat = Math.max.apply(null, lat);
        const minLon = Math.min.apply(null, lon);
        const maxLon = Math.max.apply(null, lon);
        const bounds = L.latLngBounds([
            [minLat, minLon],
            [maxLat, maxLon]
        ]);

        if (ecmwfState.heatLayer && leafletMap.hasLayer(ecmwfState.heatLayer)) {
            leafletMap.removeLayer(ecmwfState.heatLayer);
        }
        ecmwfState.heatLayer = L.imageOverlay(url, bounds, { opacity: 1 }).addTo(leafletMap);
    } catch (err) {
        console.error(err);
        if (statusText) statusText.innerText = `ECMWF error: ${err.message}`;
    }
}

async function updateEcmwfConfigFromUi() {
    const varSelect = document.getElementById('ecmwfVarSelect');
    const startSel = document.getElementById('ecmwfStartSelect');
    const endSel = document.getElementById('ecmwfEndSelect');
    const statusText = document.getElementById('status-text');
    if (!varSelect || !startSel || !endSel) return;

    let varName = varSelect.value;
    let startGroup = parseInt(startSel.value, 10);
    let endGroup = parseInt(endSel.value, 10);
    const maxGroup = (Array.isArray(ecmwfState.dateLabels) ? ecmwfState.dateLabels.length : 0) - 1;
    if (!Number.isFinite(startGroup)) startGroup = 0;
    if (!Number.isFinite(endGroup)) endGroup = maxGroup;
    if (endGroup < startGroup) {
        const tmp = startGroup;
        startGroup = endGroup;
        endGroup = tmp;
    }

    const startIdx = Array.isArray(ecmwfState.dateStartIndices) && ecmwfState.dateStartIndices.length
        ? ecmwfState.dateStartIndices[Math.max(0, Math.min(startGroup, maxGroup))]
        : 0;
    const endIdx = Array.isArray(ecmwfState.dateEndIndices) && ecmwfState.dateEndIndices.length
        ? ecmwfState.dateEndIndices[Math.max(0, Math.min(endGroup, maxGroup))]
        : (ecmwfState.timeLabels.length ? ecmwfState.timeLabels.length - 1 : 0);

    try {
        setLoading(true, 'Configuring ECMWF view...');
        const res = await fetch('/ecmwf_config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                var_name: varName,
                frame_range: { start: startIdx, end: endIdx }
            })
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'ECMWF config failed');

        ecmwfState.currentVar = varName;
        ecmwfState.cmapName = getEcmwfCmapName(varName);
        ecmwfState.vMin = typeof data.v_min === 'number' ? data.v_min : ecmwfState.vMin;
        ecmwfState.vMax = typeof data.v_max === 'number' ? data.v_max : ecmwfState.vMax;
        ecmwfState.rangeStart = typeof data.range_start === 'number' ? data.range_start : startIdx;
        ecmwfState.rangeEnd = typeof data.range_end === 'number' ? data.range_end : endIdx;

        // Enforce date-range bounds on the time slider
        const timeSlider = document.getElementById('ecmwfTimeSlider');
        const timeLabelEl = document.getElementById('ecmwfTimeLabel');
        if (timeSlider && timeLabelEl) {
            const minIdx = ecmwfState.rangeStart;
            const maxIdx = ecmwfState.rangeEnd;
            timeSlider.min = String(minIdx);
            timeSlider.max = String(maxIdx);
            let current = parseInt(timeSlider.value, 10);
            if (!Number.isFinite(current)) current = minIdx;
            const clamped = Math.max(minIdx, Math.min(current, maxIdx));
            timeSlider.value = String(clamped);
            const lbl = (Array.isArray(ecmwfState.timeLabels) && clamped < ecmwfState.timeLabels.length)
                ? ecmwfState.timeLabels[clamped]
                : `T[${clamped}]`;
            timeLabelEl.innerText = lbl;
            ecmwfState.timeIndex = clamped;
        }

        const colorBar = document.getElementById('color-bar');
        const maxValEl = document.getElementById('max-val');
        const minValEl = document.getElementById('min-val');
        const rightUi = document.getElementById('right-ui-stack');
        const activeVar = document.getElementById('active-var');
        const cmapDef = getEcmwfCmapDef(ecmwfState.cmapName || 'viridis');
        if (colorBar) colorBar.style.background = cmapDef.gradient;
        if (typeof ecmwfState.vMax === 'number' && maxValEl) maxValEl.innerText = ecmwfState.vMax.toFixed(1);
        if (typeof ecmwfState.vMin === 'number' && minValEl) minValEl.innerText = ecmwfState.vMin.toFixed(1);
        if (rightUi) rightUi.style.display = 'flex';
        if (activeVar) activeVar.innerText = varName;

        startSel.value = String(startGroup);
        endSel.value = String(endGroup);
        setLoading(false, 'ECMWF configuration ready. Click Render to draw.');
    } catch (err) {
        console.error(err);
        setLoading(false, `ECMWF config error: ${err.message}`);
    }
}

function initEcmwfConfigUi(meta) {
    const varSelect = document.getElementById('ecmwfVarSelect');
    const startSel = document.getElementById('ecmwfStartSelect');
    const endSel = document.getElementById('ecmwfEndSelect');
    const configCard = document.getElementById('ecmwfConfigCard');
    if (!varSelect || !startSel || !endSel || !configCard) return;

    const vars = Array.isArray(meta.variables) ? meta.variables : [];
    ecmwfState.variables = vars;
    varSelect.innerHTML = vars.map(v => `<option value="${v}">${v}</option>`).join('');

    const defaultVar = meta.default_var || (vars[0] || null);
    if (defaultVar) {
        varSelect.value = defaultVar;
        ecmwfState.currentVar = defaultVar;
    }

    const labels = Array.isArray(ecmwfState.timeLabels) ? ecmwfState.timeLabels : [];
    const dateLabels = [];
    const dateStartIndices = [];
    const dateEndIndices = [];

    let currentDate = null;
    labels.forEach((full, idx) => {
        const raw = typeof full === 'string' ? full : String(full);
        const datePart = raw.split(' ')[0];
        if (currentDate === null || datePart !== currentDate) {
            currentDate = datePart;
            dateLabels.push(datePart);
            dateStartIndices.push(idx);
            dateEndIndices.push(idx);
        } else {
            // extend last group's end index
            dateEndIndices[dateEndIndices.length - 1] = idx;
        }
    });

    ecmwfState.dateLabels = dateLabels;
    ecmwfState.dateStartIndices = dateStartIndices;
    ecmwfState.dateEndIndices = dateEndIndices;

    const optionsHtml = dateLabels.map((lbl, idx) => `<option value="${idx}">${lbl}</option>`).join('');
    startSel.innerHTML = optionsHtml;
    endSel.innerHTML = optionsHtml;
    startSel.value = '0';
    endSel.value = String(Math.max(0, dateLabels.length - 1));

    configCard.classList.remove('hidden');

    const handler = () => { updateEcmwfConfigFromUi(); };
    varSelect.onchange = handler;
    startSel.onchange = handler;
    endSel.onchange = handler;

    const onKey = (e) => {
        if (e.key === 'Enter') {
            updateEcmwfConfigFromUi().then(() => {
                const btn = document.getElementById('ecmwfRenderBtn');
                if (btn) btn.click();
            });
        }
    };
    varSelect.addEventListener('keydown', onKey);
    startSel.addEventListener('keydown', onKey);
    endSel.addEventListener('keydown', onKey);
}

async function requestEcmwfContours(timeIndex, stepIndex) {
    if (!leafletMap) return;
    try {
        const res = await fetch('/ecmwf_contours', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                var_name: ecmwfState.currentVar,
                time_index: timeIndex,
                step_index: stepIndex,
                frame_range: { start: ecmwfState.rangeStart, end: ecmwfState.rangeEnd }
            })
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'ECMWF contour request failed');

        ecmwfState.timeIndex = timeIndex;
        ecmwfState.stepIndex = stepIndex;
        if (Array.isArray(data.time_label)) {
            // Should be string, but guard anyway
        }
        const label = data.time_label || `T[${timeIndex}] +S[${stepIndex}]`;
        const labelEl = document.getElementById('ecmwfTimeLabel');
        if (labelEl) labelEl.innerText = label;
        const activeTime = document.getElementById('active-time');
        if (activeTime) activeTime.innerText = label;
        const statusText = document.getElementById('status-text');
        if (statusText) statusText.innerText = label;

        // Remove any existing heat overlay when switching to point view
        if (ecmwfState.heatLayer && leafletMap.hasLayer(ecmwfState.heatLayer)) {
            leafletMap.removeLayer(ecmwfState.heatLayer);
            ecmwfState.heatLayer = null;
        }

        if (ecmwfState.layer && leafletMap.hasLayer(ecmwfState.layer)) {
            leafletMap.removeLayer(ecmwfState.layer);
        }

        const layer = L.geoJSON(data.geojson, {
            pointToLayer: (feature, latlng) => {
                const v = feature.properties && feature.properties.value;
                const color = createEcmwfColor(v);
                return L.circleMarker(latlng, {
                    radius: 4,
                    color,
                    weight: 0.5,
                    opacity: 0.9,
                    fillColor: color,
                    fillOpacity: 0.8
                });
            }
        });

        layer.addTo(leafletMap);
        ecmwfState.layer = layer;

        if (!ecmwfState.hasFitted && layer.getBounds && layer.getBounds().isValid()) {
            leafletMap.fitBounds(layer.getBounds(), { padding: [20, 20] });
            ecmwfState.hasFitted = true;
        }
    } catch (err) {
        console.error(err);
        const statusText = document.getElementById('status-text');
        if (statusText) statusText.innerText = `ECMWF error: ${err.message}`;
    }
}

function setupEcmwfMap(meta, restore) {
    teardownMap();

    const waBounds = L.latLngBounds(WA_BOUNDS);
    const paddedBounds = waBounds.pad(WA_BOUNDS_PADDING);
    leafletMap = L.map('target-area', {
        maxBounds: paddedBounds,
        maxBoundsViscosity: 0.8
    });
    leafletMap.fitBounds(waBounds, { padding: [30, 30] });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(leafletMap);

    const timeLabels = Array.isArray(meta.time_labels) ? meta.time_labels : [];
    ecmwfState.timeLabels = timeLabels;

    const rightUi = document.getElementById('right-ui-stack');
    if (rightUi) rightUi.style.display = 'none';
    const activeVar = document.getElementById('active-var');
    if (activeVar) activeVar.innerText = 'ECMWF';

    const timeCard = document.getElementById('ecmwfTimeCard');
    const timeSlider = document.getElementById('ecmwfTimeSlider');
    const timeLabelEl = document.getElementById('ecmwfTimeLabel');
    const stepCard = document.getElementById('ecmwfStepCard');
    const stepSlider = document.getElementById('ecmwfStepSlider');
    const stepLabelEl = document.getElementById('ecmwfStepLabel');

    if (timeCard && timeSlider && timeLabelEl) {
        const maxTime = Math.max(0, (Array.isArray(timeLabels) ? timeLabels.length : 0) - 1);
        const minIdx = (typeof ecmwfState.rangeStart === 'number') ? ecmwfState.rangeStart : 0;
        const maxIdx = (typeof ecmwfState.rangeEnd === 'number') ? ecmwfState.rangeEnd : maxTime;
        const safeMin = Math.max(0, Math.min(minIdx, maxTime));
        const safeMax = Math.max(safeMin, Math.min(maxIdx, maxTime));
        timeSlider.min = String(safeMin);
        timeSlider.max = String(safeMax);
        const startIdx = restore ? (ecmwfState.timeIndex || safeMin) : safeMin;
        const safeT = Math.max(safeMin, Math.min(startIdx, safeMax));
        timeSlider.value = String(safeT);
        const lbl = timeLabels[safeT] || `T[${safeT}]`;
        timeLabelEl.innerText = lbl;
        timeCard.classList.remove('hidden');

        timeSlider.oninput = (e) => {
            const idx = parseInt(e.target.value, 10);
            if (!Number.isFinite(idx)) return;
            const txt = timeLabels[idx] || `T[${idx}]`;
            timeLabelEl.innerText = txt;
        };
        timeSlider.onchange = (e) => {
            const tIdx = parseInt(e.target.value, 10);
            if (!Number.isFinite(tIdx)) return;
            const sIdx = (typeof ecmwfState.stepIndex === 'number') ? ecmwfState.stepIndex : 0;
            if (ecmwfState.useContours) {
                renderEcmwfContourPlot(tIdx, sIdx);
            } else {
                requestEcmwfContours(tIdx, sIdx);
            }
        };
    }

    if (stepCard && stepSlider && stepLabelEl) {
        const maxStep = Math.max(0, (Array.isArray(ecmwfState.stepValues) ? ecmwfState.stepValues.length : 0) - 1);
        stepSlider.min = '0';
        stepSlider.max = String(maxStep);
        const startS = restore ? (ecmwfState.stepIndex || 0) : 0;
        const safeS = Math.max(0, Math.min(startS, maxStep));
        stepSlider.value = String(safeS);
        const stepVal = Array.isArray(ecmwfState.stepValues) && safeS < ecmwfState.stepValues.length
            ? ecmwfState.stepValues[safeS]
            : 0;
        stepLabelEl.innerText = `+${stepVal} h`;
        stepCard.classList.remove('hidden');

        stepSlider.oninput = (e) => {
            const idx = parseInt(e.target.value, 10);
            if (!Number.isFinite(idx)) return;
            const sVal = Array.isArray(ecmwfState.stepValues) && idx < ecmwfState.stepValues.length
                ? ecmwfState.stepValues[idx]
                : 0;
            stepLabelEl.innerText = `+${sVal} h`;
        };
        stepSlider.onchange = (e) => {
            const sIdx = parseInt(e.target.value, 10);
            if (!Number.isFinite(sIdx)) return;
            const tIdx = (typeof ecmwfState.timeIndex === 'number') ? ecmwfState.timeIndex : 0;
            if (ecmwfState.useContours) {
                renderEcmwfContourPlot(tIdx, sIdx);
            } else {
                requestEcmwfContours(tIdx, sIdx);
            }
        };
    }

    const emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.style.display = 'none';

    const viewModeCard = document.getElementById('ecmwfViewModeCard');
    if (viewModeCard) viewModeCard.classList.remove('hidden');
}
