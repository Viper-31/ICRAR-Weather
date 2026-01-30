// DPIRD entry points split out from index.js.
// These rely on shared globals and helpers defined in index.js:
// appMode, dpirdViewState, leafletMap, markers, playback, WA_BOUNDS, WA_BOUNDS_PADDING,
// colorMaps, latestMapCoords, lastMapRequestBody,  and helpers like
// setLoading, setDateError, validateDpirdConfig, handleConfigChange, attachConfigChangeHandlers,
// updateVariableDependentUI, toggleViewUI, teardownMap, computeScalarColor
// initializePlayback, pausePlayback,
// clearPlaybackAttention.

// Upload DPIRD NetCDF file and initialise config UI

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
