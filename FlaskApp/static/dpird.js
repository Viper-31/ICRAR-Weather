// DPIRD entry points split out from index.js.
// These rely on shared globals and helpers defined in index.js:
// appMode, dpirdViewState, leafletMap, markers, playback, WA_BOUNDS, WA_BOUNDS_PADDING,
// colorMaps, latestMapCoords, lastMapRequestBody,  and helpers like
// setLoading, setDateError, validateDpirdConfig, handleConfigChange, attachConfigChangeHandlers,
// updateVariableDependentUI, toggleViewUI, teardownMap, computeScalarColor
// initializePlayback, pausePlayback,
// clearPlaybackAttention.

// Upload DPIRD NetCDF file and initialise config UI


// DPIRD colormaps
const DPIRD_CMAP_DEFS = {
    airTemperature: {
        scale: 'coolwarm',
        gradient: 'linear-gradient(to top, #3b4cc0, #bcb8b7, #b40426)',
        stops: [
            { pos: 0.0, color: [59, 76, 192] },
            { pos: 0.5, color: [188, 184, 183] },
            { pos: 1.0, color: [180, 4, 38] }
        ]
    },
    dewPoint: {
        scale: 'coolwarm',
        gradient: 'linear-gradient(to top, #3b4cc0, #bcb8b7, #b40426)',
        stops: [
            { pos: 0.0, color: [59, 76, 192] },
            { pos: 0.5, color: [188, 184, 183] },
            { pos: 1.0, color: [180, 4, 38] }
        ]
    },
    relativeHumidity: {
        scale: 'Blues',
        gradient: 'linear-gradient(to top, #eff3ff, #6baed6, #08519c)',
        stops: [
            { pos: 0.0, color: [239, 243, 255] },
            { pos: 0.5, color: [107, 174, 214] },
            { pos: 1.0, color: [8, 81, 156] }
        ]
    },
    wind_3m: {
        scale: 'Plasma',
        gradient: 'linear-gradient(to top, #0d0887, #cc4678, #f0f921)',
        stops: [
            { pos: 0.0, color: [13, 8, 135] },
            { pos: 0.5, color: [204, 70, 120] },
            { pos: 1.0, color: [240, 249, 33] }
        ]
    },
    default: {
        scale: 'Viridis',
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
    return DPIRD_CMAP_DEFS[varName] || DPIRD_CMAP_DEFS.default;
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
}

// Compute color for a scalar value using the DPIRD colormap
function DpirdMissingColor(value, vMin, vMax, varName) {
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

    const configSection = document.getElementById('configSection');
    if (configSection) configSection.classList.remove('hidden');

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

                const color = DpirdMissingColor(speedVal, d.v_min, d.v_max, varName);
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
