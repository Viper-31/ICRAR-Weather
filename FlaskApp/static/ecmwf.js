// ECMWF-specific state, colormaps, and rendering logic

// Colormap mappings (approximate equivalents of the Python mappings)
const ECMWF_VAR_CMAPS = {
    t2m: 'coolwarm',
    d2m: 'coolwarm',
    msl: 'viridis',
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
    z: 'viridis',
    t: 'coolwarm',
    r: 'YlGnBu',
    q: 'GnBu',
    w: 'RdBu_r'
};

// Gradient definitions (CSS) and colour stops (for marker/overlay colouring)
const ECMWF_CMAP_DEFS = {
    coolwarm: {
        gradient: 'linear-gradient(to top, #3b4cc0, #bcb8b7, #b40426)',
        stops: [
            { pos: 0.0, color: [59, 76, 192] },
            { pos: 0.5, color: [188, 184, 183] },
            { pos: 1.0, color: [180, 4, 38] }
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

// --- Shared UI Populator ---
window.populateEcmwfUi = function(data) {
    if (!data) return;

    // Update internal ECMWF state
    ecmwfState.timeLabels = Array.isArray(data.time_labels) ? data.time_labels : [];
    ecmwfState.stepValues = Array.isArray(data.step_values) ? data.step_values : [];
    ecmwfState.timeCount = typeof data.time_count === 'number' ? data.time_count : ecmwfState.timeLabels.length;
    ecmwfState.stepCount = typeof data.step_count === 'number' ? data.step_count : ecmwfState.stepValues.length;
    ecmwfState.timeIndex = 0;
    ecmwfState.stepIndex = 0;
    ecmwfState.rangeStart = 0;
    ecmwfState.rangeEnd = Math.max(0, ecmwfState.timeLabels.length - 1);

    // Initialise the Map container basics
    setupEcmwfMap({ time_labels: ecmwfState.timeLabels }, false);
    
    // Initialise the Sidebar controls (Dropdowns etc)
    initEcmwfConfigUi(data);
}

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

// Global ECMWF view state
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

function createEcmwfColor(value) {
    if (!Number.isFinite(value) || ecmwfState.vMin === null || ecmwfState.vMax === null) {
        return 'rgb(148, 163, 184)';
    }
    const range = (ecmwfState.vMax - ecmwfState.vMin) || 1;
    const pct = (value - ecmwfState.vMin) / range;
    const cmap = ecmwfState.cmapName || 'viridis';
    return sampleEcmwfColormap(pct, cmap);
}

function formatEcmwfValidTime(timeIndex, stepIndex) {
    const labels = Array.isArray(ecmwfState.timeLabels) ? ecmwfState.timeLabels : [];
    const steps = Array.isArray(ecmwfState.stepValues) ? ecmwfState.stepValues : [];
    const base = labels[timeIndex];
    const stepHoursRaw = steps[stepIndex];
    const stepHours = typeof stepHoursRaw === 'number' ? stepHoursRaw : 0;

    if (!base || typeof base !== 'string') {
        return `t${timeIndex} +${stepHours}h`;
    }

    const m = base.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
    if (!m) {
        return `${base} (+${stepHours}h)`;
    }

    const [, yStr, monStr, dStr, hStr, minStr] = m;
    const year = parseInt(yStr, 10);
    const month = parseInt(monStr, 10) - 1;
    const day = parseInt(dStr, 10);
    const hour = parseInt(hStr, 10);
    const minute = parseInt(minStr, 10);

    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) ||
        !Number.isFinite(hour) || !Number.isFinite(minute)) {
        return `${base} (+${stepHours}h)`;
    }

    let date = new Date(Date.UTC(year, month, day, hour, minute));
    if (Number.isFinite(stepHours) && stepHours !== 0) {
        date = new Date(date.getTime() + stepHours * 3600 * 1000);
    }

    const dd = String(date.getUTCDate()).padStart(2, '0');
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = date.getUTCFullYear();

    let hh = date.getUTCHours();
    const ampm = hh >= 12 ? 'pm' : 'am';
    hh = hh % 12;
    if (hh === 0) hh = 12;
    const hhStr = String(hh).padStart(2, '0');
    const minOut = String(date.getUTCMinutes()).padStart(2, '0');

    return `${dd}-${mm}-${yyyy} ${hhStr}:${minOut} ${ampm}`;
}

async function uploadEcmwfFile() {
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

        // Update Global State
        loadedDatasets.ecmwf = true;

        // --- CHANGED: Use the helper ---
        window.populateEcmwfUi(data);

        // Update Switcher
        updateContextSwitcher();

        setLoading(false, 'ECMWF dataset loaded. Configure options and click Render.');
    } catch (err) {
        console.error(err);
        setLoading(false, `ECMWF error: ${err.message}`);
    }
}

async function runEcmwfVisualization() {
    if (appMode !== 'ecmwf' && appMode !== 'dual') {
        alert('Rendering ECMWF visualization is only available in ECMWF or Dual mode.');
        return;
    }
    if (!ecmwfState.timeLabels || ecmwfState.timeLabels.length === 0) {
        alert('No ECMWF data loaded. Please load a dataset first.');
        setLoading(false, 'No ECMWF data available.');
        return;
    }
    setLoading(true, 'Preparing ECMWF view...');
    await updateEcmwfConfigFromUi();
    const timeSlider = document.getElementById('ecmwfTimeSlider');
    const stepSlider = document.getElementById('ecmwfStepSlider');
    let tIdx = timeSlider ? parseInt(timeSlider.value, 10) : 0;
    let sIdx = stepSlider ? parseInt(stepSlider.value, 10) : 0;
    if (!Number.isFinite(tIdx)) tIdx = 0;
    if (!Number.isFinite(sIdx)) sIdx = 0;
    const contourToggle = document.getElementById('ecmwfContourToggle');
    const useContours = contourToggle ? !!contourToggle.checked : false;
    const isWindVar = typeof ecmwfState.currentVar === 'string' && ecmwfState.currentVar.startsWith('wind');
    // Wind variables are always shown as arrows on data points (no contour heatmap)

    const opacitySlider = document.getElementById('ecmwfOpacitySlider');
    const opacity = opacitySlider ? parseFloat(opacitySlider.value, 10)/100 : 1.0;
    if (isWindVar) {
        ecmwfState.useContours = false;
        if (!leafletMap && ecmwfState.timeLabels.length) {
            setupEcmwfMap({ time_labels: ecmwfState.timeLabels }, true);
        }
        if (ecmwfState.heatLayer && leafletMap && leafletMap.hasLayer(ecmwfState.heatLayer)) {
            leafletMap.removeLayer(ecmwfState.heatLayer);
        }
        await requestEcmwfContours(tIdx, sIdx);
    } else {
        ecmwfState.useContours = useContours;
        if (useContours) {
            if (!leafletMap && ecmwfState.timeLabels.length) {
                setupEcmwfMap({ time_labels: ecmwfState.timeLabels }, true);
            }
            await renderEcmwfContourPlot(tIdx, sIdx, opacity);
        } else {
            if (!leafletMap && ecmwfState.timeLabels.length) {
                setupEcmwfMap({ time_labels: ecmwfState.timeLabels }, true);
            }
            if (ecmwfState.heatLayer && leafletMap && leafletMap.hasLayer(ecmwfState.heatLayer)) {
                leafletMap.removeLayer(ecmwfState.heatLayer);
            }
            await requestEcmwfContours(tIdx, sIdx);
        }
    }

    // Reveal the ECMWF time/step controls only after a render
    const timeCard = document.getElementById('ecmwfTimeCard');
    if (timeCard) timeCard.classList.remove('hidden');

    setLoading(false, '');
}

async function renderEcmwfContourPlot(timeIndex, stepIndex, opacity = 1.0) {
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

        const backendLabel = data.time_label || `T[${timeIndex}] +S[${stepIndex}]`;
        const validLabel = formatEcmwfValidTime(timeIndex, stepIndex);
        
        // Update colorbar and labels
        const timeLabelEl = document.getElementById('ecmwfTimeLabel');
        if (timeLabelEl) timeLabelEl.innerText = backendLabel;
        
        const overlay = document.getElementById('ecmwf-time-overlay');
        if (overlay) {
            overlay.textContent = validLabel;
            overlay.classList.remove('hidden');
        }
        
        // Colorbar logic based on mode
        if (appMode === 'ecmwf') {
            // ECMWF-only mode: Use DPIRD colorbar element styled for ECMWF
            const colorBar = document.getElementById('color-bar');
            const maxValEl = document.getElementById('max-val');
            const minValEl = document.getElementById('min-val');
            const activeVar = document.getElementById('active-var');
            const activeUnits = document.getElementById('active-units');
            const activeTime = document.getElementById('active-time');
            
            const cmapDef = getEcmwfCmapDef(ecmwfState.cmapName || 'viridis');
            if (colorBar) colorBar.style.background = cmapDef.gradient;
            if (maxValEl) maxValEl.innerText = ecmwfState.vMax.toFixed(1);
            if (minValEl) minValEl.innerText = ecmwfState.vMin.toFixed(1);
            if (activeVar) activeVar.innerText = ecmwfState.longName || ecmwfState.currentVar || 'ECMWF';
            if (activeUnits) activeUnits.innerText = ecmwfState.units ? `(${ecmwfState.units})` : '';
            if (activeTime) activeTime.innerText = validLabel;
            if (statusText) statusText.innerText = validLabel;
        } else if (appMode === 'dual') {
            // Dual mode - update appropriate colorbar based on variable
            if (shouldUseSharedColorbar()) {
                const colorBar = document.getElementById('color-bar');
                const maxValEl = document.getElementById('max-val');
                const minValEl = document.getElementById('min-val');
                const activeVar = document.getElementById('active-var');
                const activeUnits = document.getElementById('active-units');
                const activeTime = document.getElementById('active-time');
                const coolwarmDef = getEcmwfCmapDef('coolwarm');
                
                if (colorBar) colorBar.style.background = coolwarmDef.gradient;
                if (maxValEl) maxValEl.innerText = ecmwfState.vMax.toFixed(1);
                if (minValEl) minValEl.innerText = ecmwfState.vMin.toFixed(1);
                if (activeVar) activeVar.innerText = ecmwfState.longName || ecmwfState.currentVar;
                if (activeUnits) activeUnits.innerText = ecmwfState.units ? `(${ecmwfState.units})` : '';
                if (activeTime) activeTime.innerText = validLabel;
            } else {
                // Separate ECMWF colorbar
                if (typeof updateEcmwfColorbar === 'function') {
                    updateEcmwfColorbar(
                        ecmwfState.vMin,
                        ecmwfState.vMax,
                        ecmwfState.currentVar,
                        ecmwfState.units || '--',
                        ecmwfState.longName || ecmwfState.currentVar,
                        validLabel
                    );
                }
            }
            
            // Update colorbar visibility after rendering
            if (typeof updateColorbarVisibility === 'function') {
                updateColorbarVisibility();
            }
        }
        
        if (!leafletMap) return;

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

        const alphaValue = Math.round(opacity * 255);
        let p = 0;
        for (let y = 0; y < height; y++) {
            const latIdx = latAscending ? (height - 1 - y) : y;
            const row = Array.isArray(z[latIdx]) ? z[latIdx] : [];
            for (let x = 0; x < width; x++) {
                const vRaw = row[x];
                const v = (typeof vRaw === 'number') ? vRaw : NaN;
                if (!Number.isFinite(v) || vMin === null || vMax === null) {
                    imgData.data[p++] = 0;
                    imgData.data[p++] = 0;
                    imgData.data[p++] = 0;
                    imgData.data[p++] = 0;
                } else {
                    let pct = (v - vMin) / range;
                    pct = clamp01(pct);
                    const STEPS = 12;
                    pct = Math.round(pct * STEPS) / STEPS;
                    const rgb = sampleEcmwfColormap(pct, cmap);
                    const m = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/i);
                    const r = m ? parseInt(m[1], 10) : 0;
                    const g = m ? parseInt(m[2], 10) : 0;
                    const b = m ? parseInt(m[3], 10) : 0;
                    imgData.data[p++] = r;
                    imgData.data[p++] = g;
                    imgData.data[p++] = b;
                    imgData.data[p++] = alphaValue;
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
        ecmwfState.heatLayer = L.imageOverlay(url, bounds, { opacity: opacity }).addTo(leafletMap);

        if (ecmwfState.heatLayer && typeof ecmwfState.heatLayer.bringToBack === 'function') {
            ecmwfState.heatLayer.bringToBack();
        }
    } catch (err) {
        console.error(err);
        if (statusText) statusText.innerText = `ECMWF error: ${err.message}`;
    }
}

async function updateEcmwfConfigFromUi() {
    const varSelect = document.getElementById('ecmwfVarSelect');
    const startSel = document.getElementById('ecmwfStartSelect');
    const endSel = document.getElementById('ecmwfEndSelect');
    
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

    setLoading(true, 'Configuring ECMWF view...')

    try {
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
        ecmwfState.vMin = data.v_min;
        ecmwfState.vMax = data.v_max;
        ecmwfState.rangeStart = data.range_start || 0;
        ecmwfState.rangeEnd = data.range_end || 0;
        ecmwfState.units = data.units || '--';
        ecmwfState.longName = data.long_name || varName;

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

        if (appMode === 'ecmwf') {
            const colorBar = document.getElementById('color-bar');
            const maxValEl = document.getElementById('max-val');
            const minValEl = document.getElementById('min-val');
            const activeVar = document.getElementById('active-var');
            const activeUnits = document.getElementById('active-units');
            const rightUi = document.getElementById('right-ui-stack');
            const dpirdColorbar = document.getElementById('dpird-colorbar-card');
            
            const cmapDef = getEcmwfCmapDef(ecmwfState.cmapName || 'viridis');
            if (colorBar) colorBar.style.background = cmapDef.gradient;
            if (maxValEl) maxValEl.innerText = ecmwfState.vMax.toFixed(1);
            if (minValEl) minValEl.innerText = ecmwfState.vMin.toFixed(1);
            if (activeVar) activeVar.innerText = ecmwfState.longName || varName;
            if (activeUnits) activeUnits.innerText = ecmwfState.units ? `(${ecmwfState.units})` : '';
            if (rightUi) rightUi.style.display = 'flex';
            if (dpirdColorbar) dpirdColorbar.classList.remove('hidden');
            if (dpirdColorbarHeader) dpirdColorbarHeader.textContent = 'ECMWF';
        } else if (appMode === 'dual') {
            // Dual mode - update ECMWF colorbar
            if (shouldUseSharedColorbar()) {
                // Use shared colorbar (DPIRD element with coolwarm)
                const colorBar = document.getElementById('color-bar');
                const maxValEl = document.getElementById('max-val');
                const minValEl = document.getElementById('min-val');
                const activeVar = document.getElementById('active-var');
                const activeUnits = document.getElementById('active-units')
                const dpirdColorbarHeader = document.getElementById('dpird-colorbar-header');
                
                if (colorBar) colorBar.style.background = coolwarmDef.gradient;
                if (maxValEl) maxValEl.innerText = ecmwfState.vMax.toFixed(1);
                if (minValEl) minValEl.innerText = ecmwfState.vMin.toFixed(1);
                if (activeVar) activeVar.innerText = `${ecmwfState.longName} / ${varName}`;
                if (activeUnits) activeUnits.innerText = ecmwfState.units ? `(${ecmwfState.units})` : '';
                if (dpirdColorbarHeader) dpirdColorbarHeader.textContent = 'Shared (ECMWF + DPIRD)'
            } else {
                // Separate ECMWF colorbar
                updateEcmwfColorbar(
                    ecmwfState.vMin,
                    ecmwfState.vMax,
                    varName,
                    ecmwfState.units,
                    ecmwfState.longName,
                    formatEcmwfValidTime(ecmwfState.timeIndex, ecmwfState.stepIndex)
                );
            }
            updateColorbarVisibility();
        }

        // Hide contour/heatmap toggle for wind variables (always show arrows)
        const viewModeCard = document.getElementById('ecmwfViewModeCard');
        const contourToggle = document.getElementById('ecmwfContourToggle');
        const isWindVar = typeof varName === 'string' && varName.startsWith('wind');
        if (viewModeCard) {
            viewModeCard.style.display = isWindVar ? 'none' : '';
        }
        if (contourToggle && isWindVar) {
            contourToggle.checked = false;
            ecmwfState.useContours = false;
        }

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
        // Dynamically thin the grid so we don't render an excessive
        // number of markers (especially for wind arrow fields).
        let stride = 2;
        if (typeof ecmwfState.currentVar === 'string' && ecmwfState.currentVar.startsWith('wind')) {
            const zoom = leafletMap.getZoom ? leafletMap.getZoom() : 6;
            if (zoom <= 5) {
                stride = 8;
            } else if (zoom <= 7) {
                stride = 6;
            } else {
                stride = 4;
            }
        }

        const res = await fetch('/ecmwf_contours', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                var_name: ecmwfState.currentVar,
                time_index: timeIndex,
                step_index: stepIndex,
                frame_range: { start: ecmwfState.rangeStart, end: ecmwfState.rangeEnd },
                stride
            })
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'ECMWF contour request failed');

        ecmwfState.timeIndex = timeIndex;
        ecmwfState.stepIndex = stepIndex;
        const backendLabel = data.time_label || `T[${timeIndex}] +S[${stepIndex}]`;
        const validLabel = formatEcmwfValidTime(timeIndex, stepIndex);
        const labelEl = document.getElementById('ecmwfTimeLabel');
        if (labelEl) labelEl.innerText = backendLabel;
        const activeTime = document.getElementById('active-time');
        if (activeTime) activeTime.innerText = validLabel;
        const overlay = document.getElementById('ecmwf-time-overlay');
        if (overlay) {
            overlay.textContent = validLabel;
            overlay.classList.remove('hidden');
        }
        const statusText = document.getElementById('status-text');
        if (statusText) statusText.innerText = validLabel;

        if (ecmwfState.heatLayer && leafletMap.hasLayer(ecmwfState.heatLayer)) {
            leafletMap.removeLayer(ecmwfState.heatLayer);
            ecmwfState.heatLayer = null;
        }

        if (ecmwfState.layer && leafletMap.hasLayer(ecmwfState.layer)) {
            leafletMap.removeLayer(ecmwfState.layer);
            ecmwfState.layer = null;
        }

        const layer = L.geoJSON(data.geojson, {
            pointToLayer: (feature, latlng) => {
                const props = feature.properties || {};
                const v = props.value;
                const color = 'rgb(0, 0, 0)';

                // For wind variables, always render arrows using speed & angle from due north
                if (typeof props.angle_degN === 'number') {
                    const angle = props.angle_degN;
                    const vMin = ecmwfState.vMin;
                    const vMax = ecmwfState.vMax;
                    const range = (typeof vMin === 'number' && typeof vMax === 'number') ? (vMax - vMin || 1) : 1;
                    let pct = 0.5;
                    if (typeof v === 'number' && typeof vMin === 'number') {
                        pct = clamp01((v - vMin) / range);
                    }
                    const size = 0.5 + (pct * 1.5);
                    console.log('Creating wind arrow:', v, pct, size, angle);
                    const html = `<div class="rotator" style="--rot:${angle}deg; --size:${size}; color:${color};">
                        <svg class="arrow-svg" viewBox="0 0 24 24">
                            <g class="arrow-group" style="stroke:${color};">
                                <line x1="2" y1="12" x2="21" y2="12" class="arrow-path arrow-fill" />
                                <polyline points="15 6 21 12 15 18" class="arrow-path arrow-fill" />
                            </g>
                        </svg>
                    </div>`;
                    const icon = L.divIcon({ className: 'marker-icon', html, iconSize: [32, 32], iconAnchor: [16, 16] });

                    return L.marker(latlng, { icon });
                }

                // Scalar variables: default to simple coloured circle markers
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

        // Keep the card hidden until the user triggers a render.
        // On restored maps, respect the existing visibility state.
        if (!restore) {
            timeCard.classList.add('hidden');
        }

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

    if (stepSlider && stepLabelEl) {
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

// Hook the ECMWF contour toggle when the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
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
