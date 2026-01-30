let appMode = 'none'; // changed default
const loadedDatasets = { dpird: false, ecmwf: false }; 
let dpirdUiMeta = null;
let ecmwfUiMeta = null;
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

// --- Shared date range selection (DPIRD + ECMWF) ---
function computeDpirdDateRangeFromMeta(meta) {
    if (!meta || !Array.isArray(meta.date_range) || meta.date_range.length !== 2) return null;
    const [startStr, endStr] = meta.date_range;
    if (!startStr || !endStr) return null;
    const start = new Date(`${startStr}T00:00:00Z`);
    const end = new Date(`${endStr}T00:00:00Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    const rangeStart = start <= end ? start : end;
    const rangeEnd = end >= start ? end : start;
    return { start: rangeStart, end: rangeEnd };
}

function computeEcmwfDateRangeFromMeta(meta) {
    if (!meta || !Array.isArray(meta.time_labels) || meta.time_labels.length === 0) return null;
    const first = meta.time_labels[0];
    const last = meta.time_labels[meta.time_labels.length - 1];
    if (typeof first !== 'string' || typeof last !== 'string') return null;

    function parseLabel(label) {
        const parts = label.trim().split(/\s+/);
        if (parts.length < 2) return null;
        const iso = `${parts[0]}T${parts[1]}:00Z`;
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    const start = parseLabel(first);
    const end = parseLabel(last);
    if (!start || !end) return null;
    const rangeStart = start <= end ? start : end;
    const rangeEnd = end >= start ? end : start;
    return { start: rangeStart, end: rangeEnd };
}

function maybeUpdateSharedDateRange() {
    // Only adjust when both datasets are loaded
    if (!loadedDatasets.dpird || !loadedDatasets.ecmwf) return;

    const dpRange = computeDpirdDateRangeFromMeta(dpirdUiMeta);
    const ecRange = computeEcmwfDateRangeFromMeta(ecmwfUiMeta);
    if (!dpRange && !ecRange) return;

    const startInput = document.getElementById('startDate');
    const endInput = document.getElementById('endDate');
    if (!startInput || !endInput) return;

    let chosen = null;
    if (dpRange && ecRange) {
        const dpSpan = Math.max(0, dpRange.end.getTime() - dpRange.start.getTime());
        const ecSpan = Math.max(0, ecRange.end.getTime() - ecRange.start.getTime());
        chosen = dpSpan <= ecSpan ? dpRange : ecRange;
    } else if (dpRange) {
        chosen = dpRange;
    } else {
        chosen = ecRange;
    }

    if (!chosen) return;
    const startIso = chosen.start.toISOString().slice(0, 10);
    const endIso = chosen.end.toISOString().slice(0, 10);
    startInput.value = startIso;
    endInput.value = endIso;

    if (typeof validateDpirdConfig === 'function') {
        validateDpirdConfig();
    }
}

// When in dual mode, keep ECMWF frame range in sync with
// the shared DPIRD date configuration by adjusting the
// ECMWF date-group selectors based on start/end dates.
function syncEcmwfToDpirdDates() {
    if (appMode !== 'dual' || !loadedDatasets.ecmwf) return;

    const startInput = document.getElementById('startDate');
    const endInput = document.getElementById('endDate');
    const startVal = startInput ? startInput.value : '';
    const endVal = endInput ? endInput.value : '';
    if (!startVal || !endVal) return;

    let start = new Date(`${startVal}T00:00:00Z`);
    let end = new Date(`${endVal}T00:00:00Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
    if (end < start) {
        const tmp = start;
        start = end;
        end = tmp;
    }

    const dateLabels = Array.isArray(ecmwfState.dateLabels) ? ecmwfState.dateLabels : [];
    if (!dateLabels.length) return;

    const startSel = document.getElementById('ecmwfStartSelect');
    const endSel = document.getElementById('ecmwfEndSelect');
    if (!startSel || !endSel) return;

    const parseDay = (dStr) => {
        const d = new Date(`${dStr}T00:00:00Z`);
        return Number.isNaN(d.getTime()) ? null : d;
    };

    let startGroup = 0;
    let endGroup = dateLabels.length - 1;

    for (let i = 0; i < dateLabels.length; i++) {
        const d = parseDay(dateLabels[i]);
        if (!d) continue;
        if (d >= start) {
            startGroup = i;
            break;
        }
    }

    for (let i = 0; i < dateLabels.length; i++) {
        const d = parseDay(dateLabels[i]);
        if (!d) continue;
        if (d <= end) {
            endGroup = i;
        } else {
            break;
        }
    }

    if (endGroup < startGroup) {
        endGroup = startGroup;
    }

    startSel.value = String(startGroup);
    endSel.value = String(endGroup);

    if (typeof updateEcmwfConfigFromUi === 'function') {
        updateEcmwfConfigFromUi();
    }
}

// Called by DPIRD/ECMWF UI populators when metadata is ready
window.registerDpirdUiMeta = function(meta) {
    dpirdUiMeta = meta;
    maybeUpdateSharedDateRange();
};

window.registerEcmwfUiMeta = function(meta) {
    ecmwfUiMeta = meta;
    maybeUpdateSharedDateRange();
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
    const dpirdVarSelect = document.getElementById('dpirdVarSelect');
    const varSelected = dpirdVarSelect
        ? !!dpirdVarSelect.value
        : !!document.querySelector('input[name="vItem"]:checked');

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
    
    const dpirdVarSelect = document.getElementById('dpirdVarSelect');
    const dpirdVar = (dpirdVarSelect && dpirdVarSelect.value)
        ? dpirdVarSelect.value
        : document.querySelector('input[name="vItem"]:checked')?.value;
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
    if (colorBar && typeof getDpirdCmapDef === 'function') {
        const cmapDef = getDpirdCmapDef(varName);
        colorBar.style.background = cmapDef.gradient;
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
        const handler = () => {
            validateDpirdConfig();
            if (appMode === 'dual') {
                syncEcmwfToDpirdDates();
            }
        };
        startInput.addEventListener('change', handler);
        startInput.addEventListener('blur', handler);
        startInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                validateDpirdConfig();
                if (appMode === 'dual') {
                    syncEcmwfToDpirdDates();
                }
                const btn = document.getElementById('renderBtn');
                if (btn && !btn.disabled) runVisualization();
            }
        });
    }
    
    if (endInput) {
        const handler = () => {
            validateDpirdConfig();
            if (appMode === 'dual') {
                syncEcmwfToDpirdDates();
            }
        };
        endInput.addEventListener('change', handler);
        endInput.addEventListener('blur', handler);
        endInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                validateDpirdConfig();
                if (appMode === 'dual') {
                    syncEcmwfToDpirdDates();
                }
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

    // Titles and labels we may tweak for dual layout
    const dpirdConfigTitle = document.getElementById('dpirdConfigTitle');
    const dpirdViewModeLabel = document.getElementById('dpirdViewModeLabel');
    const viewModeSelect = document.getElementById('viewMode');
    const ecmwfConfigTitle = document.getElementById('ecmwfConfigTitle');
    const ecmwfConfigCard = document.getElementById('ecmwfConfigCard');
    const ecmwfVarLabel = document.getElementById('ecmwfVarLabel');
    const ecmwfDateRangeLabel = document.getElementById('ecmwfDateRangeLabel');
    const ecmwfStartSelect = document.getElementById('ecmwfStartSelect');
    const ecmwfEndSelect = document.getElementById('ecmwfEndSelect');
    const ecmwfTimeCard = document.getElementById('ecmwfTimeCard');

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

    // Reset any text/visibility tweaks from dual mode
    if (dpirdConfigTitle) dpirdConfigTitle.textContent = 'DPIRD Configuration';
    if (dpirdViewModeLabel) dpirdViewModeLabel.classList.remove('hidden');
    if (viewModeSelect) viewModeSelect.classList.remove('hidden');
    const stationSelector = document.getElementById('stationSelector');
    const windComponentSelector = document.getElementById('windComponentSelector');
    if (stationSelector) stationSelector.classList.add('hidden');
    if (windComponentSelector) windComponentSelector.classList.add('hidden');
    if (ecmwfConfigTitle) ecmwfConfigTitle.textContent = 'ECMWF Configuration';
    if (ecmwfVarLabel) ecmwfVarLabel.textContent = 'Variable';
    if (ecmwfDateRangeLabel) ecmwfDateRangeLabel.textContent = 'Date Range';
    if (ecmwfDateRangeLabel) ecmwfDateRangeLabel.classList.remove('hidden');
    if (ecmwfStartSelect) ecmwfStartSelect.classList.remove('hidden');
    if (ecmwfEndSelect) ecmwfEndSelect.classList.remove('hidden');

    // Ensure ECMWF time/step card is restored to ECMWF sidebar
    if (ecmwfSidebar && ecmwfTimeCard && ecmwfTimeCard.parentElement !== ecmwfSidebar) {
        const ecmwfViewModeCard = document.getElementById('ecmwfViewModeCard');
        if (ecmwfViewModeCard && ecmwfViewModeCard.parentElement === ecmwfSidebar) {
            ecmwfSidebar.insertBefore(ecmwfTimeCard, ecmwfViewModeCard);
        } else if (ecmwfRenderBtn && ecmwfRenderBtn.parentElement === ecmwfSidebar) {
            ecmwfSidebar.insertBefore(ecmwfTimeCard, ecmwfRenderBtn);
        } else {
            ecmwfSidebar.appendChild(ecmwfTimeCard);
        }
    }
    // Ensure ECMWF config card is restored to ECMWF sidebar
    if (ecmwfSidebar && ecmwfConfigCard && ecmwfConfigCard.parentElement !== ecmwfSidebar) {
        const firstChild = ecmwfSidebar.firstChild;
        if (firstChild) {
            ecmwfSidebar.insertBefore(ecmwfConfigCard, firstChild);
        } else {
            ecmwfSidebar.appendChild(ecmwfConfigCard);
        }
    }
    
    if (mode === 'dpird') {
        // Ensure DPIRD timeline card sits directly under the DPIRD config card,
        // above station selector / variable / render button.
        const configSection = document.getElementById('configSection');
        const timeSliderCard = document.getElementById('timeSliderCard');
        if (configSection && timeSliderCard) {
            const dpirdConfigCard = dpirdConfigTitle ? dpirdConfigTitle.closest('.section-card') : null;
            if (dpirdConfigCard && dpirdConfigCard.parentElement === configSection) {
                dpirdConfigCard.insertAdjacentElement('afterend', timeSliderCard);
            } else {
                configSection.insertBefore(timeSliderCard, configSection.firstChild);
            }
        }

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

        // In dual mode, unify the layout visually:
        // - Use DPIRD block as shared date configuration
        // - Hide DPIRD-specific view mode controls (map/graph)
        // - Emphasise DPIRD/ECMWF variable labels
        if (dpirdConfigTitle) dpirdConfigTitle.textContent = 'Date Configuration';
        if (dpirdViewModeLabel) dpirdViewModeLabel.classList.add('hidden');
        if (viewModeSelect) {
            viewModeSelect.classList.add('hidden');
            // Force map view in dual mode
            viewModeSelect.value = 'map';
        }
        if (stationSelector) stationSelector.classList.add('hidden');
        if (windComponentSelector) windComponentSelector.classList.add('hidden');

        if (ecmwfConfigTitle) ecmwfConfigTitle.classList.add('hidden');
        if (ecmwfVarLabel) ecmwfVarLabel.textContent = 'ECMWF Variable';
        // Hide ECMWF date range controls in dual mode so the
        // top-level DPIRD date inputs act as the shared range.
        if (ecmwfDateRangeLabel) ecmwfDateRangeLabel.classList.add('hidden');
        if (ecmwfStartSelect) ecmwfStartSelect.classList.add('hidden');
        if (ecmwfEndSelect) ecmwfEndSelect.classList.add('hidden');

        // In dual mode, reorder cards to create a unified stack:
        // - group DPIRD and ECMWF variable cards together
        // - move DPIRD timeline and ECMWF time/step into the same
        //   DPIRD config section so they appear together.
        const configSection = document.getElementById('configSection');
        const timeSliderCard = document.getElementById('timeSliderCard');
        if (configSection) {
            // Group variable cards: place ECMWF config card directly after DPIRD variable card
            const dpirdVarSelect = document.getElementById('dpirdVarSelect');
            const dpirdVarCard = dpirdVarSelect ? dpirdVarSelect.closest('.section-card') : null;
            if (ecmwfConfigCard) {
                if (dpirdVarCard && dpirdVarCard.parentElement === configSection) {
                    dpirdVarCard.insertAdjacentElement('afterend', ecmwfConfigCard);
                } else {
                    configSection.appendChild(ecmwfConfigCard);
                }
            }

            // Keep timeline and ECMWF time/step controls within the shared config stack
            if (timeSliderCard) {
                configSection.appendChild(timeSliderCard);
            }
            if (ecmwfTimeCard) {
                configSection.appendChild(ecmwfTimeCard);
            }
        }

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
    
    const dpirdVarSelect = document.getElementById('dpirdVarSelect');
    const dpirdVar = (dpirdVarSelect && dpirdVarSelect.value)
        ? dpirdVarSelect.value
        : document.querySelector('input[name="vItem"]:checked')?.value;
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

        
        if (typeof updateEcmwfConfigFromUi === 'function') {
            await updateEcmwfConfigFromUi();
        }
        // Wind variable special handling
        const isWindVar = typeof ecmwfState.currentVar === 'string' && ecmwfState.currentVar.startsWith('wind');

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
        
        // Render ECMWF layer (wind → arrows, scalar → always contours)
        if (isWindVar) {
            ecmwfState.useContours = false;
            
            if (ecmwfState.heatLayer && leafletMap && leafletMap.hasLayer(ecmwfState.heatLayer)) {
                leafletMap.removeLayer(ecmwfState.heatLayer);
            }
            
            if (typeof requestEcmwfContours === 'function') {
                await requestEcmwfContours(tIdx, sIdx, opacitySlider.value / 100);
            }
        } else {
            // Scalar ECMWF variables: always render contour/heatmap (no dots)
            ecmwfState.useContours = true;
            if (typeof renderEcmwfContourPlot === 'function') {
                await renderEcmwfContourPlot(tIdx, sIdx, opacitySlider.value / 100);
            }
        }
        
        // Render DPIRD on top
        if (dpirdVar && typeof renderMap === 'function') {
            await renderMap(dpirdVar);
        }
        // Ensure ECMWF time/step controls are visible after dual render
        const ecmwfTimeCard = document.getElementById('ecmwfTimeCard');
        if (ecmwfTimeCard) {
            ecmwfTimeCard.classList.remove('hidden');
        }
        
        // Update colorbar visibility
        updateColorbarVisibility();
        const rightUi = document.getElementById('right-ui-stack');
        if (rightUi) rightUi.style.display = 'flex';   
               
        setLoading(false, 'Dual layer visualization ready.');

        console.log('Dual visualization rendered successfully.');

        // Derive human-readable times for logging
        let ecmwfTimeString = '';
        if (typeof formatEcmwfValidTime === 'function') {
            ecmwfTimeString = formatEcmwfValidTime(tIdx, sIdx);
        } else if (Array.isArray(ecmwfState.timeLabels) && ecmwfState.timeLabels.length) {
            const base = ecmwfState.timeLabels[Math.max(0, Math.min(tIdx, ecmwfState.timeLabels.length - 1))];
            const step = Array.isArray(ecmwfState.stepValues) && ecmwfState.stepValues.length
                ? ecmwfState.stepValues[Math.max(0, Math.min(sIdx, ecmwfState.stepValues.length - 1))]
                : 0;
            ecmwfTimeString = `${base} (+${step}h)`;
        } else {
            ecmwfTimeString = `t${tIdx} +${sIdx}h`;
        }

        const dpirdTimeLabelEl = document.getElementById('timeLabel');
        const dpirdTimeString = dpirdTimeLabelEl && dpirdTimeLabelEl.innerText
            ? dpirdTimeLabelEl.innerText
            : `index ${playback.currentIdx || 0}`;

        console.log('ECMWF variable:', ecmwfState.currentVar, 'Valid time:', ecmwfTimeString);
        console.log('DPIRD variable:', dpirdVar, 'Time:', dpirdTimeString);


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

        // In dual mode, keep ECMWF aligned at 1h steps while
        // DPIRD advances in 15-minute steps. Every 4th DPIRD
        // frame (0,1,2,3 → then 4) we bump the ECMWF step.
        if (appMode === 'dual' && loadedDatasets && loadedDatasets.ecmwf && (nextIndex % 4 === 0)) {
            const stepSlider = document.getElementById('ecmwfStepSlider');
            const stepLabelEl = document.getElementById('ecmwfStepLabel');
            if (stepSlider && typeof ecmwfState !== 'undefined' && ecmwfState.timeLabels.length) {
                const maxStep = parseInt(stepSlider.max || '0', 10) || 0;
                let currentStep = parseInt(stepSlider.value || '0', 10);
                if (!Number.isFinite(currentStep)) currentStep = 0;
                let nextStep = currentStep + 1;
                if (nextStep > maxStep) nextStep = maxStep;
                stepSlider.value = String(nextStep);

                // Update the visible "+X h" label to match the new step
                let stepVal = 0;
                if (Array.isArray(ecmwfState.stepValues) && nextStep < ecmwfState.stepValues.length) {
                    const raw = ecmwfState.stepValues[nextStep];
                    stepVal = typeof raw === 'number' ? raw : 0;
                }
                if (stepLabelEl) {
                    stepLabelEl.innerText = `+${stepVal} h`;
                }

                const tIdx = (typeof ecmwfState.timeIndex === 'number') ? ecmwfState.timeIndex : 0;
                const isWindVar = typeof ecmwfState.currentVar === 'string' && ecmwfState.currentVar.startsWith('wind');
                opacitySlider = document.getElementById('ecmwfOpacitySlider');

                if (typeof requestEcmwfContours === 'function' && typeof renderEcmwfContourPlot === 'function') {
                    if (isWindVar) {
                        requestEcmwfContours(tIdx, nextStep, opacitySlider.value / 100);
                    } else {
                        renderEcmwfContourPlot(tIdx, nextStep, opacitySlider.value / 100);
                    }
                }
            }
        }
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
    
    // Attempt to initialise UI from any datasets that were
    // preloaded on the server (e.g. via CLI flag).
    fetch('/initial_state')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
            if (!data) return;

            if (data.dpird_meta && window.populateDpirdUi) {
                loadedDatasets.dpird = true;
                window.populateDpirdUi(data.dpird_meta);
            }

            if (data.ecmwf_meta && window.populateEcmwfUi) {
                loadedDatasets.ecmwf = true;
                window.populateEcmwfUi(data.ecmwf_meta);
            }

            if (data.dpird_meta || data.ecmwf_meta) {
                setLoading(false, 'Preloaded datasets ready. Configure and render.');
            }

            updateContextSwitcher();
        })
        .catch(() => {
            // Preload is optional; ignore errors here.
        });
    
    const dpirdVarSelect = document.getElementById('dpirdVarSelect');
    if (dpirdVarSelect) {
        dpirdVarSelect.addEventListener('change', () => {
            // Revalidate DPIRD config and dependent UI when variable changes
            validateDpirdConfig();
            updateVariableDependentUI();
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
