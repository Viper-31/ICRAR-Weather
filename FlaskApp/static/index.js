let appMode = 'none'; // changed default
const loadedDatasets = { dpird: false, ecmwf: false }; 
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

// --- Acacia Date Range Validation ---
function validateAcaciaDateRange() {
    const chkEcmwf = document.getElementById('chkEcmwf');
    const dateRangeDiv = document.getElementById('acaciaDateRange');
    const startInput = document.getElementById('acaciaStartDate');
    const endInput = document.getElementById('acaciaEndDate');
    const errorDiv = document.getElementById('acaciaDateError');
    const btnQuery = document.getElementById('btnQuery');
    
    // Only validate if ECMWF is checked
    const ecmwfSelected = chkEcmwf && chkEcmwf.checked;
    
    if (!ecmwfSelected) {
        if (errorDiv) errorDiv.textContent = '';
        return true;
    }
    const startVal = startInput ? startInput.value : '';
    const endVal = endInput ? endInput.value : '';
    
    if (!startVal || !endVal) {
        if (errorDiv) errorDiv.textContent = 'Both dates required for ECMWF';
        if (btnQuery) btnQuery.disabled = true;
        return false;
    }
    
    if (startVal > endVal) {
        if (errorDiv) errorDiv.textContent = 'End date must be after start date';
        if (btnQuery) btnQuery.disabled = true;
        return false;
    }
    
    // Check date range span (warn if > 28 days)
    const start = new Date(startVal);
    const end = new Date(endVal);
    const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    
    if (daysDiff > 28) {
        if (errorDiv) {
            errorDiv.textContent = `⚠️ ${daysDiff} days selected. Load time may be >5 minutes.`;
            errorDiv.style.color = '#f59e0b'; // Warning color
        }
    } else {
        if (errorDiv) errorDiv.textContent = '';
    }
    
    if (btnQuery) btnQuery.disabled = false;
    return true;
}

function updateAcaciaDateUI() {
    const chkDpird = document.getElementById('chkDpird');
    const chkEcmwf = document.getElementById('chkEcmwf');
    const dateRangeDiv = document.getElementById('acaciaDateRange');
    const warningDiv = document.getElementById('ecmwfDateWarning');
    const btnQuery = document.getElementById('btnQuery');
    
    const ecmwfChecked = chkEcmwf && chkEcmwf.checked;
    const dpirdChecked = chkDpird && chkDpird.checked;
    
    // Warn if ECMWF is selected
    if (warningDiv) {
        warningDiv.classList.toggle('hidden', !ecmwfChecked);
    }
    
    //Warn if ECMWF is selected
    if (dateRangeDiv) {
        dateRangeDiv.classList.toggle('hidden', !ecmwfChecked);
    }
    
    // Enable/disable query button
    if (btnQuery) {
        if (!dpirdChecked && !ecmwfChecked) {
            btnQuery.disabled = true;
        } else if (ecmwfChecked) {
            validateAcaciaDateRange();
        } else {
            btnQuery.disabled = false;
        }
    }
}

// --- Query Functionality ---
async function queryAcacia() {
    const chkDpird = document.getElementById('chkDpird');
    const chkEcmwf = document.getElementById('chkEcmwf');
    const startInput = document.getElementById('acaciaStartDate');
    const endInput = document.getElementById('acaciaEndDate');
    
    // Build selection list
    const selection = [];
    if (chkDpird && chkDpird.checked) selection.push('DPIRD');
    if (chkEcmwf && chkEcmwf.checked) selection.push('ECMWF');

    if (selection.length === 0) {
        setLoading(false, 'Please select at least one data source.');
        return;
    }

    // Validate dates if ECMWF is selected
    if (chkEcmwf && chkEcmwf.checked) {
        if (!validateAcaciaDateRange()) {
            return;
        }
    }

    // Build request payload
    const payload = { datasets: selection };
    
    // Add date range if ECMWF is selected
    if (chkEcmwf && chkEcmwf.checked && startInput && endInput) {
        payload.date_range = {
            start: startInput.value,
            end: endInput.value
        };
    }

    setLoading(true, `Querying Acacia... (${selection.join(', ')})`);

    try {
        const res = await fetch('/query', {
            method: 'POST', 
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        
        if (data.error) throw new Error(data.error);

        // Sync DPIRD date inputs with Acacia dates if provided
        if (data.dpird_meta) {
            loadedDatasets.dpird = true;
            if (startInput && endInput && startInput.value && endInput.value) {
                const dpirdStart = document.getElementById('startDate');
                const dpirdEnd = document.getElementById('endDate');
                if (dpirdStart) dpirdStart.value = startInput.value;
                if (dpirdEnd) dpirdEnd.value = endInput.value;
            }
            if(window.populateDpirdUi) window.populateDpirdUi(data.dpird_meta); 
        } else {
            loadedDatasets.dpird = false;
        }

        // Handle ECMWF
        if (data.ecmwf_meta) {
            loadedDatasets.ecmwf = true;
            console.log('ECMWF metadata received:', data.ecmwf_meta);
            console.log('Time labels:', data.ecmwf_meta.time_labels);
            
            if(window.populateEcmwfUi) window.populateEcmwfUi(data.ecmwf_meta);
        } else {
            loadedDatasets.ecmwf = false;
        }
        
        updateContextSwitcher();
        setLoading(false, 'Data loaded. Use Active Control Panel to configure.');

    } catch (err) {
        console.error(err);
        setLoading(false, `Query failed: ${err.message}`);
    }
}

// --- Context Switching Logic ---
function updateContextSwitcher() {
    const sw = document.getElementById('contextSwitch');
    const optDpird = document.getElementById('optDpird');
    const optEcmwf = document.getElementById('optEcmwf');

    if (!loadedDatasets.dpird && !loadedDatasets.ecmwf) {
        sw.classList.add('hidden');
        switchViewContext('none'); 
        return;
    }

    sw.classList.remove('hidden');
    
    // Show/Hide specific radio buttons
    optDpird.style.display = loadedDatasets.dpird ? 'flex' : 'none';
    optEcmwf.style.display = loadedDatasets.ecmwf ? 'flex' : 'none';

    // Auto-select logic
    const currentRad = document.querySelector('input[name="viewContext"]:checked');
    const currentVal = currentRad ? currentRad.value : null;

    if (currentVal === 'dpird' && loadedDatasets.dpird) {
        // Keep current
    } else if (currentVal === 'ecmwf' && loadedDatasets.ecmwf) {
        // Keep current
    } else if (loadedDatasets.dpird) {
        // Switch to DPIRD
        const r = document.querySelector('input[name="viewContext"][value="dpird"]');
        if(r) { r.checked = true; switchViewContext('dpird'); }
    } else if (loadedDatasets.ecmwf) {
        // Switch to ECMWF
        const r = document.querySelector('input[name="viewContext"][value="ecmwf"]');
        if(r) { r.checked = true; switchViewContext('ecmwf'); }
    }
}

// Replaces the old setAppMode
function switchViewContext(mode) {
    const prevMode = appMode;
    appMode = mode; 
    const dpirdSidebar = document.getElementById('dpirdSidebar');
    const ecmwfSidebar = document.getElementById('ecmwfSidebar');
    
    if (mode === 'dpird') {
        if (dpirdSidebar) dpirdSidebar.classList.remove('hidden');
        if (ecmwfSidebar) ecmwfSidebar.classList.add('hidden');
    } else if (mode === 'ecmwf') {
        if (dpirdSidebar) dpirdSidebar.classList.add('hidden');
        if (ecmwfSidebar) ecmwfSidebar.classList.remove('hidden');
    } else {
        if (dpirdSidebar) dpirdSidebar.classList.add('hidden');
        if (ecmwfSidebar) ecmwfSidebar.classList.add('hidden');
    }

    // Cleanup Logic (Merged from old setAppMode)
    const ecmwfOverlay = document.getElementById('ecmwf-time-overlay');
    if (mode !== 'ecmwf' && ecmwfOverlay) {
        ecmwfOverlay.classList.add('hidden');
        ecmwfOverlay.textContent = '--';
    }

    const statusText = document.getElementById('status-text');

    // If we are leaving DPIRD, snapshot its visual state then reset map/plot
    if (prevMode === 'dpird' && mode === 'ecmwf') {
        if (dpirdViewState.mode === 'map') {
            dpirdViewState.timeIdx = playback.currentIdx || 0;
        }
        teardownMap(); // Clear map for ECMWF
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
        // Restore DPIRD map state if available
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
    
    // Default Empty State
    if (mode === 'none') {
        teardownMap();
        if (statusText) statusText.innerText = 'No datasets loaded. Select sources above.';
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

    const ecmwfOverlay = document.getElementById('ecmwf-time-overlay');
    if (ecmwfOverlay) {
        ecmwfOverlay.classList.add('hidden');
        ecmwfOverlay.textContent = '--';
    }
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

document.addEventListener('DOMContentLoaded', () => {
    updateContextSwitcher();
    const chkDpird = document.getElementById('chkDpird');
    const chkEcmwf = document.getElementById('chkEcmwf');
    const acaciaStart = document.getElementById('acaciaStartDate');
    const acaciaEnd = document.getElementById('acaciaEndDate');

    if (chkDpird) chkDpird.addEventListener('change', updateAcaciaDateUI);
    if (chkEcmwf) chkEcmwf.addEventListener('change', updateAcaciaDateUI);
    if (acaciaStart) acaciaStart.addEventListener('change', validateAcaciaDateRange);
    if (acaciaEnd) acaciaEnd.addEventListener('change', validateAcaciaDateRange);

    if (acaciaStart && acaciaEnd) {
        const today = new Date();
        const threeDaysAgo = new Date(today);
        threeDaysAgo.setDate(today.getDate() - 3);
        
        acaciaEnd.value = today.toISOString().split('T')[0];
        acaciaStart.value = threeDaysAgo.toISOString().split('T')[0];
    }
    
    updateAcaciaDateUI();
});
