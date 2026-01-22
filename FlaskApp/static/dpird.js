// DPIRD entry points split out from index.js.
// These rely on shared globals and helpers defined in index.js:
// appMode, dpirdViewState, leafletMap, markers, playback, WA_BOUNDS, WA_BOUNDS_PADDING,
// colorMaps, latestMapCoords, lastMapRequestBody, fillPaintState and helpers like
// setLoading, setDateError, validateDpirdConfig, handleConfigChange, attachConfigChangeHandlers,
// updateVariableDependentUI, toggleViewUI, teardownMap, computeScalarColor, applyFillColors,
// clearRadiusOverlays, clearHullOverlay, clearFillOverlays, initializePlayback, pausePlayback,
// clearPlaybackAttention.

// Upload DPIRD NetCDF file and initialise config UI
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

        const varStack = document.getElementById('varStack');
        if (varStack) {
            varStack.innerHTML = (data.variables || []).map(v => `
                <label class="var-row"><input type="radio" name="vItem" value="${v}"> ${v}</label>`
            ).join('');
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
        setLoading(false, 'Dataset ready. Choose a variable and view.');
    } catch (err) {
        console.error(err);
        setLoading(false, `Error loading dataset: ${err.message}`);
    } finally {
        if (uploadBtn) uploadBtn.disabled = false;
        fileInput.disabled = false;
    }
}

// Render DPIRD map view
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
            method: 'POST', headers: { 'Content-Type': 'application/json' },
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
            applyFillColors(timeIdx);
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
        clearRadiusOverlays();
        clearHullOverlay();
        clearFillOverlays();
        latestMapCoords = createDefaultMapState();
        disposePlayback(true);
    }
}

// Render DPIRD time-series/aggregate graph
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
    if (appMode !== 'dpird') {
        alert('Rendering is only available in DPIRD mode right now.');
        return;
    }
    const mode = document.getElementById('viewMode').value;
    const varName = document.querySelector('input[name="vItem"]:checked')?.value;
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
