// DPIRD entry points split out from index.js.
// These rely on shared globals and helpers defined in index.js:
// appMode, dpirdViewState, leafletMap, markers, playback, WA_BOUNDS, WA_BOUNDS_PADDING,
// colorMaps, latestMapCoords, lastMapRequestBody,  and helpers like
// setLoading, setDateError, validateDpirdConfig, handleConfigChange, attachConfigChangeHandlers,
// updateVariableDependentUI, toggleViewUI, teardownMap, computeScalarColor
// initializePlayback, pausePlayback,
// clearPlaybackAttention.
// Upload DPIRD NetCDF file and initialise config UI

// DPIRD variable to colormap mapping
const DPIRD_VAR_CMAPS = {
    airTemperature: 'thermal',
    apparentAirTemperature: 'thermal',
    dewPoint: 'thermal',
    wetBulb: 'thermal',
    deltaT: 'RdBu_r',
    relativeHumidity: 'Blues',
    panEvaporation: 'YlGnBu',
    evaporationTranspiration: 'YlGn',
    solarExposure: 'plasma',
    rainfall: 'Blues',
    frostcondition: 'Blues',
    heatcondition: 'Reds' 
};

// DPIRD colormaps
const CMAP_DEFS = {
    coolwarm: {
        gradient: 'linear-gradient(to top, #3b4cc0, #bcb8b7, #b40426)',
        stops: [
            { pos: 0.0, color: [59, 76, 192] },
            { pos: 0.5, color: [188, 184, 183] },
            { pos: 1.0, color: [180, 4, 38] }
        ]
    },
    thermal: {
        gradient: 'linear-gradient(to top, #2166ac, #4393c3, #92c5de, #d1e5f0, #fddbc7, #f4a582, #d6604d, #b2182b)',
        stops: [
            { pos: 0.00, color: [33, 102, 172] },    
            { pos: 0.14, color: [67, 147, 195] },    
            { pos: 0.29, color: [146, 197, 222] },   
            { pos: 0.43, color: [209, 229, 240] },   
            { pos: 0.57, color: [253, 219, 199] },   
            { pos: 0.71, color: [244, 165, 130] },   
            { pos: 0.86, color: [214, 96, 77] },    
            { pos: 1.00, color: [178, 24, 43] }     
        ]
    },
    plasma: {
        gradient: 'linear-gradient(to top, #0d0887, #cc4678, #f0f921)',
        stops: [
            { pos: 0.0, color: [13, 8, 135] },
            { pos: 0.5, color: [204, 70, 120] },
            { pos: 1.0, color: [240, 249, 33] }
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
    YlGn: {
        gradient: 'linear-gradient(to top, #ffffe5, #66c2a4, #00441b)',
        stops: [
            { pos: 0.0, color: [255, 255, 229] },
            { pos: 0.5, color: [102, 194, 164] },
            { pos: 1.0, color: [0, 68, 27] }
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

// Helper to get colormap definition for a DPIRD variable
function getDpirdCmapDef(varName) {
    const cmapName = DPIRD_VAR_CMAPS[varName] || 'viridis';
    return CMAP_DEFS[cmapName] || CMAP_DEFS['viridis'];
}

// Linear interpolation helper
function lerp(a, b, t) {
    return a + (b - a) * t;
}

// Clamp value to [0, 1]
function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

// Sample a DPIRD colormap at a given position (0.0 to 1.0)
function sampleDpirdColormap(pct, varName) {
    const t = clamp01(pct);
    const def = getDpirdCmapDef(varName);
    const stops = def.stops;
    
    if (!Array.isArray(stops) || !stops.length) {
        // Fallback: grayscale
        const gray = Math.round(255 * t);
        return `rgb(${gray}, ${gray}, ${gray})`;
    }
    
    // Handle edge cases
    if (t <= stops[0].pos) {
        const c = stops[0].color;
        return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    }
    if (t >= stops[stops.length - 1].pos) {
        const c = stops[stops.length - 1].color;
        return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    }
    
    // Find surrounding stops and interpolate
    for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i];
        const b = stops[i + 1];
        if (t >= a.pos && t <= b.pos) {
            const span = (b.pos - a.pos) || 1;
            const localT = (t - a.pos) / span;
            const r = lerp(a.color[0], b.color[0], localT);
            const g = lerp(a.color[1], b.color[1], localT);
            const bVal = lerp(a.color[2], b.color[2], localT);
            return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(bVal)})`;
        }
    }
    // Fallback if no stops matched
    const c = stops[stops.length - 1].color;
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

// Compute color for a scalar value using the DPIRD colormap
function computeDpirdColor(value, vMin, vMax, varName) {
    if (!Number.isFinite(value) || vMin === null || vMax === null) {
        return 'rgb(0, 0, 0)'; // Black for missing data
    }
    const range = (vMax - vMin) || 1;
    const pct = clamp01((value - vMin) / range);
    return sampleDpirdColormap(pct, varName);
}

// ---Shared UI Populator ---
window.populateDpirdUi = function(data) {
    if (!data) return;
    
    const variables = Array.isArray(data.variables) ? data.variables : (data.variables || []);

    // Legacy radio-stack support (if varStack still exists)
    const varStack = document.getElementById('varStack');
    if (varStack) {
        varStack.innerHTML = variables.map(v => `
            <label class="var-row"><input type="radio" name="vItem" value="${v}"> ${v}</label>`
        ).join('');
    }

    // New DPIRD variable dropdown
    const varSelect = document.getElementById('dpirdVarSelect');
    if (varSelect) {
        varSelect.innerHTML = variables.map(v => `<option value="${v}">${v}</option>`).join('');
    }

    const stationDropdown = document.getElementById('stationDropdown');
    if (stationDropdown) {
        stationDropdown.innerHTML = (data.stations || []).map(s => `<option value="${s}">${s}</option>`).join('');
    }

    const startInput = document.getElementById('startDate');
    const endInput = document.getElementById('endDate');
    if (startInput && endInput && Array.isArray(data.date_range) && data.date_range.length === 2) {
        startInput.value = data.date_range[0];
        endInput.value = data.date_range[1];
    }

    // Show which DPIRD file/dataset is currently loaded (including preloads)
    const dpirdInfo = document.getElementById('dpirdUploadInfo');
    if (dpirdInfo && data.source_label) {
        dpirdInfo.textContent = `Loaded: ${data.source_label}`;
    }

    const configSection = document.getElementById('configSection');
    if (configSection) configSection.classList.remove('hidden');

    if (window.registerDpirdUiMeta) {
        window.registerDpirdUiMeta(data);
    }

    attachVariableListeners();
    attachConfigChangeHandlers();
    validateDpirdConfig();
}
async function uploadFile() {
    const fileInput = document.getElementById('fileInput');
    const uploadBtn = document.getElementById('uploadBtn');
    if (!fileInput || !fileInput.files || !fileInput.files[0]) return;

    fileInput.disabled = true;
    if (uploadBtn) uploadBtn.disabled = true;
    setLoading(true, `Processing ${fileInput.files[0].name}...`);

    const fd = new FormData();
    fd.append('file', fileInput.files[0]);
    try {
        const res = await fetch('/upload', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'Upload failed');

        // Flag for revert, if wrong. Update Global State
        loadedDatasets.dpird = true;
        
        // --- CHANGED: Use the helper ---
        window.populateDpirdUi(data);
        
        // Update Switcher
        updateContextSwitcher();
        
        if (loadedDatasets.ecmwf) {
            setLoading(false, 'Both datasets loaded. Select "Both (Overlay)" to use dual mode.');
        } else {
            setLoading(false, 'Dataset ready. Choose a variable and view.');
        }
    } catch (err) {
        console.error(err);
        setLoading(false, `Error: ${err.message}`);
    } finally {
        fileInput.disabled = false;
    }
}

// Render DPIRD map view
async function renderMap(varName) {
    if (appMode !== 'dpird' && appMode !== 'dual') return; // Map rendering for DPIRD mode 
    try {
        if (appMode === 'dpird') {
            teardownMap();
        } else {
            // In dual mode, clear DPIRD markers but keep map instance
            markers.forEach(m => {
                if (leafletMap && leafletMap.hasLayer(m)) {
                    leafletMap.removeLayer(m);
                }
            });
            markers = [];
        }
        
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
        
        setLoading(true, 'Rendering map view...');
        const res = await fetch('/map_data', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const d = await res.json();
        if (!res.ok || d.error) throw new Error(d.error || 'Map request failed');

        if (!leafletMap) {
            const waBounds = L.latLngBounds(WA_BOUNDS);
            const paddedBounds = waBounds.pad(WA_BOUNDS_PADDING);
            leafletMap = L.map('target-area', {
                maxBounds: paddedBounds,
                maxBoundsViscosity: 0.8
            });
            leafletMap.fitBounds(waBounds, { padding: [30, 30] });
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(leafletMap);
        }

        const cmapDef = getDpirdCmapDef(varName);
        const isCombinedWind = (varName === 'wind_3m');
        const isWindDeg = (varName === 'wind_3m_degN');
        const isWindSpeed = (varName === 'wind_3m_speed');

        document.getElementById('color-bar').style.background = cmapDef.gradient;
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

                const color = (isCombinedWind || isWindDeg || isWindSpeed)
                    ? 'rgb(0, 0, 0)'  // Monochrome black for all wind arrows
                    : computeDpirdColor(speedVal, d.v_min, d.v_max, varName);
                const range = (d.v_max - d.v_min) || 1;
                const pct = clamp01((speedVal - d.v_min) / range);

                const rotator = element.querySelector('.rotator');
                if (rotator) {
                    if (angleVal !== null || isCombinedWind) {
                        const targetBase = (angleVal !== null) ? angleVal : 0;
                        const targetAngle = targetBase - 90;
                        let prevAngle = m._lastAngle || 0;
                        let diff = (targetAngle - prevAngle) % 360;
                        if (diff > 180) diff -= 360;
                        if (diff < -180) diff += 360;
                        const newAngle = prevAngle + diff;
                        rotator.style.setProperty('--rot', `${newAngle}deg`);
                        m._lastAngle = newAngle;
                    }

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
            dpirdViewState.timeIdx = timeIdx;
        };

        markers = d.lats.map((lat, i) => {
            let html = '';
            if (isCombinedWind || isWindDeg || isWindSpeed) {
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

            const icon = L.divIcon({ className: 'marker-icon', html: html, iconSize: [32, 32] });
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

        latestMapCoords = {
            points: stationPoints,
            fillPoints:[]
        };
        updateVariableDependentUI();

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
        setTimeout(() => updateMarkers(0), 10);

        document.getElementById('timeSliderCard').classList.remove('hidden');
        document.getElementById('empty-state').style.display = 'none';
        document.getElementById('right-ui-stack').style.display = 'flex';
        document.getElementById('active-var').innerText = varName;

        dpirdViewState.mode = 'map';
        dpirdViewState.varName = varName;
        dpirdViewState.datasetVar = null;
        dpirdViewState.displayLabel = null;
        dpirdViewState.timeIdx = 0;
        setLoading(false, 'Map ready. Use the timeline to explore.');
    } catch (err) {
        console.error(err);
        setLoading(false, err.message || 'Error rendering map');
        latestMapCoords = createDefaultMapState();
        disposePlayback(true);
    }
}

// Render DPIRD time-series/aggregate graph in dual or DPIRD mode
async function renderGraph(datasetVar, displayLabel) {
    if (appMode !== 'dpird' && appMode !== 'dual') return;
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

// Main DPIRD visualisation entry point
async function runVisualization() {
    if (appMode !== 'dpird' && appMode !== 'dual') {
        alert('Rendering DPIRD visualization is only available in DPIRD or Dual mode.');
        return;
    }
    const mode = document.getElementById('viewMode').value;
    const varSelect = document.getElementById('dpirdVarSelect');
    const varName = (varSelect && varSelect.value)
        ? varSelect.value
        : document.querySelector('input[name="vItem"]:checked')?.value;
    if (!varName) return alert('Select a variable!');
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
