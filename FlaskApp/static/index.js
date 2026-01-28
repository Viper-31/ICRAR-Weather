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
const createDefaultMapState = () => ({
    points: [],
    fillPoints: []
});
let latestMapCoords = createDefaultMapState();
let lastMapRequestBody = null;

const colorMaps = {
    'airTemperature': { 
        scale: 'coolwarm', 
        gradient: 'linear-gradient(to top, #3b4cc0, #bcb8b7, #b40426)',
        stops: [
            { pos: 0.0, color: [59, 76, 192] },
            { pos: 0.5, color: [188, 184, 183] },
            { pos: 1.0, color: [180, 4, 38] }
        ]
    },
    'dewPoint': { 
        scale: 'coolwarm', 
        gradient: 'linear-gradient(to top, #3b4cc0, #bcb8b7, #b40426)',
        stops: [
            { pos: 0.0, color: [59, 76, 192] },
            { pos: 0.5, color: [188, 184, 183] },
            { pos: 1.0, color: [180, 4, 38] }
        ]
    },
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

const ECMWF_DPIRD_VAR_MAP = {
    't2m': 'airTemperature',
    'd2m': 'dewPoint'
};

const DPIRD_ECMWF_VAR_MAP = {
    'airTemperature': 't2m',
    'dewPoint': 'd2m'
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
    const optDual = document.getElementById('optDual');

    if (!loadedDatasets.dpird && !loadedDatasets.ecmwf) {
        sw.classList.add('hidden');
        switchViewContext('none'); 
        return;
    }

    sw.classList.remove('hidden');
    
    // Show/Hide specific radio buttons
    optDpird.style.display = loadedDatasets.dpird ? 'flex' : 'none';
    optEcmwf.style.display = loadedDatasets.ecmwf ? 'flex' : 'none';
    optDual.style.display = (loadedDatasets.dpird && loadedDatasets.ecmwf) ? 'flex' : 'none';

    // Auto-select logic
    const currentRad = document.querySelector('input[name="viewContext"]:checked');
    const currentVal = currentRad ? currentRad.value : null;

    // Keep current selection if still valid
    if (currentVal === 'dpird' && loadedDatasets.dpird) {
        switchViewContext('dpird');
    } else if (currentVal === 'ecmwf' && loadedDatasets.ecmwf) {
        switchViewContext('ecmwf');
    } else if (currentVal === 'dual' && loadedDatasets.dpird && loadedDatasets.ecmwf) {
        switchViewContext('dual');
    }
    
    // Auto-select based on what's available
    if (loadedDatasets.dpird && loadedDatasets.ecmwf) {
        const r = document.querySelector('input[name="viewContext"][value="dual"]');
        if (r) { 
            r.checked = true; 
            switchViewContext('dual'); 
            updateColorbarVisibility();
        }
    } else if (loadedDatasets.dpird) {
        const r = document.querySelector('input[name="viewContext"][value="dpird"]');
        if (r) { r.checked = true; switchViewContext('dpird'); }
    } else if (loadedDatasets.ecmwf) {
        const r = document.querySelector('input[name="viewContext"][value="ecmwf"]');
        if (r) { r.checked = true; switchViewContext('ecmwf'); }
    }
}

// Check if current dual-mode selection should use shared colorbar
function shouldUseSharedColorbar() {
    if (appMode !== 'dual') return false;
    
    const dpirdVar = document.querySelector('input[name="vItem"]:checked')?.value;
    const ecmwfVar = ecmwfState.currentVar;
    
    if (!dpirdVar || !ecmwfVar) return false;
    
    // Check if ECMWF var maps to DPIRD var
    const mappedDpird = ECMWF_DPIRD_VAR_MAP[ecmwfVar];
    return mappedDpird === dpirdVar;
}

// Update ECMWF colorbar (for dual mode)
function updateEcmwfColorbar(vMin, vMax, varName, units, longName, timeLabel) {
    const maxEl = document.getElementById('ecmwf-max-val');
    const minEl = document.getElementById('ecmwf-min-val');
    const varEl = document.getElementById('ecmwf-active-var');
    const unitsEl = document.getElementById('ecmwf-active-units');
    const timeEl = document.getElementById('ecmwf-active-time');
    const colorBar = document.getElementById('ecmwf-color-bar');
    
    if (maxEl) maxEl.textContent = typeof vMax === 'number' ? vMax.toFixed(1) : '--';
    if (minEl) minEl.textContent = typeof vMin === 'number' ? vMin.toFixed(1) : '--';
    if (varEl) varEl.textContent = longName || varName || '--';
    if (unitsEl) unitsEl.textContent = units ? `(${units})` : '--';
    if (timeEl) timeEl.textContent = timeLabel || '--';
    
    // Update gradient (use ECMWF colormap)
    if (colorBar && typeof getEcmwfCmapName === 'function' && typeof getEcmwfCmapDef === 'function') {
        const cmapName = getEcmwfCmapName(varName);
        const cmapDef = getEcmwfCmapDef(cmapName);
        colorBar.style.background = cmapDef.gradient;
    }
}

// Update DPIRD colorbar (for consistency)
function updateDpirdColorbar(vMin, vMax, varName, units, timeLabel) {
    const maxEl = document.getElementById('max-val');
    const minEl = document.getElementById('min-val');
    const varEl = document.getElementById('active-var');
    const unitsEl = document.getElementById('active-units');
    const timeEl = document.getElementById('active-time');
    const colorBar = document.getElementById('color-bar');
    
    if (maxEl) maxEl.textContent = typeof vMax === 'number' ? vMax.toFixed(1) : '--';
    if (minEl) minEl.textContent = typeof vMin === 'number' ? vMin.toFixed(1) : '--';
    if (varEl) varEl.textContent = varName || '--';
    if (unitsEl) unitsEl.textContent = units ? `(${units})` : '--';
    if (timeEl) timeEl.textContent = timeLabel || '--';
    
    // Update gradient
    if (colorBar) {
        const theme = colorMaps[varName] || colorMaps['default'];
        colorBar.style.background = theme.gradient;
    }
}

// Update colorbar visibility based on dual mode selection
function updateColorbarVisibility() {
    const ecmwfColorbar = document.getElementById('ecmwf-colorbar-card');
    const dpirdColorbar = document.getElementById('dpird-colorbar-card');
    const dpirdColorbarHeader = document.getElementById('dpird-colorbar-header');
    
    if (appMode === 'dual') {
        if (shouldUseSharedColorbar()) {
            // Single shared colorbar
            if (ecmwfColorbar) ecmwfColorbar.classList.add('hidden');
            if (dpirdColorbar) dpirdColorbar.classList.remove('hidden');
            if (dpirdColorbarHeader) dpirdColorbarHeader.textContent = 'Shared (ECMWF + DPIRD)';
        } else {
            // Dual colorbars
            if (ecmwfColorbar) ecmwfColorbar.classList.remove('hidden');
            if (dpirdColorbar) dpirdColorbar.classList.remove('hidden');
            if (dpirdColorbarHeader) dpirdColorbarHeader.textContent = 'DPIRD';
        }
    }
}

// Teardown map and clear state
function teardownMap() {
    disposePlayback(true);
    if (leafletMap) {
        leafletMap.remove();
        leafletMap = null;
    }
    markers = [];
    latestMapCoords = createDefaultMapState();
    
    const targetArea = document.getElementById('target-area');
    if (window.Plotly && typeof Plotly.purge === 'function') {
        Plotly.purge(targetArea);
    }
    targetArea.innerHTML = '';
    targetArea.removeAttribute('class');
    targetArea.removeAttribute('style');
    
    const rightUi = document.getElementById('right-ui-stack');
    if (rightUi) rightUi.style.display = 'none';

    const ecmwfOverlay = document.getElementById('ecmwf-time-overlay');
    if (ecmwfOverlay) {
        ecmwfOverlay.classList.add('hidden');
        ecmwfOverlay.textContent = '--';
    }
    
    const emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.style.display = 'flex';
    
}

function attachVariableListeners() {
    const varStack = document.getElementById('varStack');
    if (!varStack) return;
    
    varStack.querySelectorAll('input[name="vItem"]').forEach(radio => {
        radio.addEventListener('change', () => {
            validateDpirdConfig();
            if (appMode === 'dual') {
                updateColorbarVisibility();
            }
        });
    });
    
    validateDpirdConfig();
}

function attachConfigChangeHandlers() {
    if (configListenersAttached) return;
    
    const startInput = document.getElementById('startDate');
    const endInput = document.getElementById('endDate');
    const stationSelect = document.getElementById('stationDropdown');
    const viewMode = document.getElementById('viewMode');
    
    if (startInput) {
        startInput.addEventListener('change', validateDpirdConfig);
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
        endInput.addEventListener('change', validateDpirdConfig);
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
        stationSelect.addEventListener('change', validateDpirdConfig);
        stationSelect.addEventListener('blur', validateDpirdConfig);
        stationSelect.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                validateDpirdConfig();
                const btn = document.getElementById('renderBtn');
                if (btn && !btn.disabled) runVisualization();
            }
        });
    }
    
    if (viewMode) {
        viewMode.addEventListener('change', toggleViewUI);
    }
    
    // Wind component radio buttons (for graph mode)
    document.querySelectorAll('input[name="windComponent"]').forEach(r => {
        r.addEventListener('change', validateDpirdConfig);
    });
    
    configListenersAttached = true;
}

function updateVariableDependentUI() {
    const windCard = document.getElementById('windComponentSelector');
    const mode = document.getElementById('viewMode')?.value || 'map';
    const selectedVar = document.querySelector('input[name="vItem"]:checked')?.value;

    // Show wind component selector only in graph mode for wind_3m
    const shouldShowWind = mode === 'graph' && selectedVar === 'wind_3m';
    if (windCard) {
        windCard.classList.toggle('hidden', !shouldShowWind);
        if (!shouldShowWind) {
            const defaultOption = document.querySelector('input[name="windComponent"][value="speed"]');
            if (defaultOption) defaultOption.checked = true;
        }
    }
}

// switchViewContext to handle dual mode, selects appropriate sidebars and colorbars
function switchViewContext(mode) {
    const prevMode = appMode;
    appMode = mode; 
    
    const dpirdSidebar = document.getElementById('dpirdSidebar');
    const ecmwfSidebar = document.getElementById('ecmwfSidebar');
    const dualSidebar = document.getElementById('dualSidebar');
    const ecmwfColorbar = document.getElementById('ecmwf-colorbar-card');
    const dpirdColorbar = document.getElementById('dpird-colorbar-card');
    const dpirdColorbarHeader = document.getElementById('dpird-colorbar-header');
    // Render buttons
    const dpirdRenderBtn = document.getElementById('renderBtn');
    const ecmwfRenderBtn = document.getElementById('ecmwfRenderBtn');
    const dualRenderBtn = document.getElementById('dualRenderBtn');

    // Check if elements exist before manipulating
    console.log('switchViewContext called:', mode);
    console.log('dpirdSidebar exists:', !!dpirdSidebar);
    console.log('ecmwfSidebar exists:', !!ecmwfSidebar);
    console.log('dualSidebar exists:', !!dualSidebar);

    // Hide all sidebars first
    if (dpirdSidebar) dpirdSidebar.classList.add('hidden');
    if (ecmwfSidebar) ecmwfSidebar.classList.add('hidden');
    if (dualSidebar) dualSidebar.classList.add('hidden');
    
    // Hide all colorbars first
    if (ecmwfColorbar) ecmwfColorbar.classList.add('hidden');
    if (dpirdColorbar) dpirdColorbar.classList.add('hidden');
    // Hide all render buttons first
    if (dpirdRenderBtn) dpirdRenderBtn.style.display = 'none';
    if (ecmwfRenderBtn) ecmwfRenderBtn.style.display = 'none';
    if (dualRenderBtn) dualRenderBtn.style.display = 'none';
    
    if (mode === 'dpird') {
        if (dpirdSidebar) dpirdSidebar.classList.remove('hidden');
        if (dpirdColorbar) dpirdColorbar.classList.remove('hidden');
        if (dpirdColorbarHeader) dpirdColorbarHeader.textContent = 'DPIRD';
        if (dpirdRenderBtn) dpirdRenderBtn.style.display = 'block';
    } else if (mode === 'ecmwf') {
        if (ecmwfSidebar) ecmwfSidebar.classList.remove('hidden');
        // Use DPIRD colorbar element but label it for ECMWF (single colorbar)
        if (dpirdColorbar) dpirdColorbar.classList.remove('hidden');
        if (dpirdColorbarHeader) dpirdColorbarHeader.textContent = 'ECMWF';
        if (ecmwfRenderBtn) ecmwfRenderBtn.style.display = 'block';
    } else if (mode === 'dual') {
        // Show both sidebars and dual controls
        if (dpirdSidebar) dpirdSidebar.classList.remove('hidden');
        if (ecmwfSidebar) ecmwfSidebar.classList.remove('hidden');
        if (dualSidebar) dualSidebar.classList.remove('hidden');
        if (dualRenderBtn) dualRenderBtn.style.display = 'block';

        // Update colorbar visibility 
        if (shouldUseSharedColorbar()) {
            // Single shared colorbar
            if (dpirdColorbar) dpirdColorbar.classList.remove('hidden');
            if (dpirdColorbarHeader) dpirdColorbarHeader.textContent = 'Shared (ECMWF + DPIRD)';
            const coolwarmDef = typeof getEcmwfCmapDef === 'function' 
            ? getEcmwfCmapDef('coolwarm') 
            : { gradient: 'linear-gradient(to top, #3b4cc0, #bcb8b7, #b40426)' };
        const colorBar = document.getElementById('color-bar');
        if (colorBar) colorBar.style.background = coolwarmDef.gradient;   
        } else {
            // Dual colorbars
            if (ecmwfColorbar) ecmwfColorbar.classList.remove('hidden');
            if (dpirdColorbar) dpirdColorbar.classList.remove('hidden');
            if (dpirdColorbarHeader) dpirdColorbarHeader.textContent = 'DPIRD';
        }
    } else {
        // mode === 'none'
        teardownMap();
        const statusText = document.getElementById('status-text');
        if (statusText) statusText.innerText = 'No datasets loaded. Select sources above.';
    }

    // Handle ECMWF overlay visibility
    const ecmwfOverlay = document.getElementById('ecmwf-time-overlay');
    if (mode !== 'ecmwf' && mode !== 'dual' && ecmwfOverlay) {
        ecmwfOverlay.classList.add('hidden');
        ecmwfOverlay.textContent = '--';
    }

    // Snapshot and restore logic for mode transitions
    const statusText = document.getElementById('status-text');
    const rightUi = document.getElementById('right-ui-stack');

    // Leaving DPIRD → Snapshot DPIRD state
    if (prevMode === 'dpird' && (mode === 'ecmwf' || mode === 'dual')) {
        // Snapshot DPIRD timeline position
        if (dpirdViewState.mode === 'map') {
            dpirdViewState.timeIdx = playback.currentIdx || 0;
        }
        
        // Only teardown if going to ECMWF (not dual)
        if (mode === 'ecmwf') {
            teardownMap();
            if (rightUi) rightUi.style.display = 'none';
            if (statusText) {
                statusText.innerText = 'ECMWF mode selected. Configure and click Render ECMWF.';
            }
            
            // Restore ECMWF map if already loaded
            if (typeof ecmwfState !== 'undefined' && ecmwfState.timeLabels.length) {
                if (typeof setupEcmwfMap === 'function') {
                    setupEcmwfMap({ time_labels: ecmwfState.timeLabels }, true);
                }
            }
        }
        // In dual mode, keep DPIRD map intact
        return;
    }

    // Leaving ECMWF → Snapshot ECMWF state
    if (prevMode === 'ecmwf' && (mode === 'dpird' || mode === 'dual')) {      
        // Only teardown if going to DPIRD (not dual)
        if (mode === 'dpird') {
            teardownMap();
            if (statusText && statusText.innerText.startsWith('ECMWF mode selected')) {
                statusText.innerText = 'DPIRD mode. Configure and click Render DPIRD.';
            }
            
            // Restore DPIRD map if available
            if (dpirdViewState.mode === 'map' && dpirdViewState.varName && typeof renderMap === 'function') {
                renderMap(dpirdViewState.varName).then(() => {
                    const idx = Math.max(0, Math.min(dpirdViewState.timeIdx || 0, (playback.totalSteps || 1) - 1));
                    if (playback.slider && typeof playback.updateMarkers === 'function') {
                        playback.slider.value = idx;
                        playback.updateMarkers(idx);
                    }
                }).catch(err => console.error(err));
            } else if (dpirdViewState.mode === 'graph' && dpirdViewState.datasetVar && dpirdViewState.displayLabel && typeof renderGraph === 'function') {
                renderGraph(dpirdViewState.datasetVar, dpirdViewState.displayLabel).catch(err => console.error(err));
            }
        }
        // In dual mode, keep ECMWF map intact
        return;
    }
    
    // Entering dual mode from none
    if (prevMode === 'none' && mode === 'dual') {
        if (statusText) statusText.innerText = 'Dual mode. Configure both layers and click Render Both Layers.';
        return;
    }
    
    // Default: Entering 'none' mode
    if (mode === 'none') {
        teardownMap();
        if (statusText) statusText.innerText = 'No datasets loaded. Select sources above.';
    }
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

function toggleViewUI() {
    const mode = document.getElementById('viewMode')?.value || 'map';
    const stationSelector = document.getElementById('stationSelector');
    const timeSliderCard = document.getElementById('timeSliderCard');
    
    // Show station selector only in graph mode
    if (stationSelector) {
        stationSelector.classList.toggle('hidden', mode === 'map');
    }
    
    // Hide time slider when switching modes (will be shown again on render)
    if (timeSliderCard) {
        timeSliderCard.classList.add('hidden');
    }
    
    // Clean up visualizations when switching modes
    if (mode === 'graph') {
        if (leafletMap) {
            teardownMap();
        }
    } else {
        const targetArea = document.getElementById('target-area');
        if (window.Plotly && typeof Plotly.purge === 'function') {
            Plotly.purge(targetArea);
            targetArea.innerHTML = '';
            targetArea.removeAttribute('class');
            targetArea.removeAttribute('style');
        }
        const rightUi = document.getElementById('right-ui-stack');
        if (rightUi) rightUi.style.display = 'none';
    }
    
    // Reset UI to waiting state
    const emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.style.display = 'flex';
    
    const spinner = document.getElementById('spinner');
    if (spinner) spinner.style.display = 'none';
    
    const statusText = document.getElementById('status-text');
    if (statusText) statusText.innerText = 'Waiting for data...';
    
    validateDpirdConfig();
    updateVariableDependentUI();
}

// Handle configuration changes (used by event listeners)
function handleConfigChange() {
    validateDpirdConfig();
}

// Dual visualization render function 
async function runDualVisualization() {
    if (appMode !== 'dual') {
        alert('Dual rendering requires both DPIRD and ECMWF datasets.');
        return;
    }
    
    if (!loadedDatasets.dpird || !loadedDatasets.ecmwf) {
        alert('Please load both DPIRD and ECMWF datasets first.');
        return;
    }
    
    const dpirdVar = document.querySelector('input[name="vItem"]:checked')?.value;
    if (!dpirdVar) {
        alert('Please select a DPIRD variable first.');
        return;
    }
    
    if (!ecmwfState.currentVar) {
        alert('Please configure ECMWF variable first (click "Render ECMWF" once).');
        return;
    }

    setLoading(true, 'Rendering dual layers...');
    
    try {
        // Get ECMWF opacity from slider
        const opacitySlider = document.getElementById('ecmwfOpacitySlider');
        const ecmwfOpacity = opacitySlider ? parseInt(opacitySlider.value, 10) / 100 : 0.75;
        
        if (typeof updateEcmwfConfigFromUi === 'function') {
            await updateEcmwfConfigFromUi();
        }
        
        const timeSlider = document.getElementById('ecmwfTimeSlider');
        const stepSlider = document.getElementById('ecmwfStepSlider');
        let tIdx = timeSlider ? parseInt(timeSlider.value, 10) : 0;
        let sIdx = stepSlider ? parseInt(stepSlider.value, 10) : 0;
        if (!Number.isFinite(tIdx)) tIdx = 0;
        if (!Number.isFinite(sIdx)) sIdx = 0;
        
        // Setup map if needed (ECMWF first)
        if (!leafletMap && typeof ecmwfState !== 'undefined' && ecmwfState.timeLabels.length) {
            if (typeof setupEcmwfMap === 'function') {
                setupEcmwfMap({ time_labels: ecmwfState.timeLabels }, true);
            }
        }
        
        // Render ECMWF layer with opacity
        if (typeof renderEcmwfContourPlot === 'function') {
            await renderEcmwfContourPlot(tIdx, sIdx, ecmwfOpacity);
        }
        
        // Render DPIRD on top
        if (dpirdVar && typeof renderMap === 'function') {
            await renderMap(dpirdVar);
        }
        
        // Update colorbar visibility
        updateColorbarVisibility();
        const rightUi = document.getElementById('right-ui-stack');
        if (rightUi) rightUi.style.display = 'flex';   
               
        setLoading(false, 'Dual layer visualization ready.');
    } catch (err) {
        console.error('Dual visualization error:', err);
        setLoading(false, `Error: ${err.message}`);
    }
}

// Playback functionality (DPIRD only for now)
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

// Listen for variable changes in dual mode (at end of file, before closing)
document.addEventListener('DOMContentLoaded', () => {
    // Init acacia date inputs and listeners
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
    // Listener for DPIRD variable changes to update colorbar visibility
    const varStack = document.getElementById('varStack');
    if (varStack) {
        varStack.addEventListener('change', () => {
            if (appMode === 'dual') {
                updateColorbarVisibility();
            }
        });
    }
    
    // Add listener for ECMWF variable changes to update colorbar visibility
    const ecmwfVarSelect = document.getElementById('ecmwfVarSelect');
    if (ecmwfVarSelect) {
        ecmwfVarSelect.addEventListener('change', () => {
            if (appMode === 'dual') {
                updateColorbarVisibility();
            }
        });
    }
    setTimeout(() => {
        updateContextSwitcher(); 
        
        // If both datasets are already loaded on init, force dual mode
        if (loadedDatasets.dpird && loadedDatasets.ecmwf) {
            console.log('Both datasets loaded on init, forcing dual mode');
            const dualRadio = document.querySelector('input[name="viewContext"][value="dual"]');
            if (dualRadio) {
                dualRadio.checked = true;
                switchViewContext('dual');
            }
        }
    }, 100);
});
