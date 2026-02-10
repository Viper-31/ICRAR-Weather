"""Flask application entry point for the ICRAR weather visualisation web app.

This service exposes DPIRD station observations and ECMWF operational forecasts
over Western Australia via a single web UI. The front-end (templates/index.html
and static assets) talks to the endpoints in this module to load metadata and
field data for visualisation.

Key responsibilities
--------------------
- Load DPIRD and ECMWF NetCDF datasets (from Acacia services or local files).
- Subset data to Western Australia for efficient map rendering.
- Provide DPIRD map/graph data and ECMWF fields/points to the browser.
- Support a dual overlay mode where DPIRD and ECMWF are rendered together.

The JavaScript files in static/ (index.js, dpird.js, ecmwf.js) orchestrate
mode switching (DPIRD / ECMWF / Dual), populate configuration controls, and
call these endpoints to render Leaflet maps and Plotly graphs in the browser.
"""

from flask import Flask, render_template, request, jsonify
import xarray as xr
import os
import sys
import pandas as pd
import numpy as np
import math
import dask

from services.map_processing import compute_fill_values
from services.acacia_get import ECMWFOperationalService, DPIRDService

app = Flask(__name__)
UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

ecmwf_op_service = ECMWFOperationalService()
dpird_service = DPIRDService()

active_datasets = {'DPIRD': None, 'ECMWF': None}  
dataset_configs = {'DPIRD': {}, 'ECMWF': {}} 

ds = None  # DPIRD dataset
ds_wa = None  # DPIRD dataset restricted to WA bounds
_dpird_dataset_id = None  # identifier for current DPIRD dataset (filepath)
_dpird_map_cache = {}  # cache for build_map_dataset results
_ecmwf_dataset_id= None
_ecmwf_minmax_cache= {} #cache for vmin,vmax of ecmwf
MAX_CACHE_SIZE_ecmwf = 100
ecmwf_ds = None  # ECMWF dataset

ecmwf_meta = {
    "lat_name": None,
    "lon_name": None,
    "time_dim": None,      # primary time-like dim ('time' or 'step')
    "variables": [],       # list of candidate variable names
    "var_name": None,      # currently selected variable
    "frame_count": 0,      # number of frames along primary time-like dim
    "time_labels": [],     # human-readable labels for primary time-like dim
    "time_count": 0,       # number of forecast reference times (time coord)
    "step_count": 0,       # number of forecast steps (step coord)
    "step_values": [],     # raw step values (typically hours)
    "v_min": None,         # current colour-scale min for selected range
    "v_max": None,         # current colour-scale max for selected range
    "range_start": 0,      # start frame index for selected date range
    "range_end": 0,        # end frame index for selected date range
    "var_map": {},         # mapping of display vars -> underlying components
}

WIND_LONG_NAMES = {
        'wind10': '10 metre wind speed',
        'wind250': 'Wind speed at 250 hPa',
        'wind500': 'Wind speed at 500 hPa',
        'wind850': 'Wind speed at 850 hPa',
        'wind1000': 'Wind speed at 1000 hPa',
    }

def _serialize_frames(frames):
    """Convert NaNs to None for JSON safety.

    DPIRD map values are now normalised at creation time, so this is mainly
    used for fill value arrays that may still contain NaNs.
    """
    cleaned = []
    for frame in frames:
        serialized_frame = []
        for item in frame:
            if isinstance(item, list):
                serialized_frame.append([
                    None if (isinstance(v, float) and math.isnan(v)) else v
                    for v in item
                ])
            else:
                serialized_frame.append(
                    None if (isinstance(item, float) and math.isnan(item)) else item
                )
        cleaned.append(serialized_frame)
    return cleaned

"""
Group ECMWF u/v wind components into synthetic wind variables.

For each matching pair (uXX, vXX), emit a single display variable
"windXX" and record a mapping so downstream code can derive
magnitude/angle from the components. Unpaired u* variables are kept
as-is, and all other variables pass through unchanged.
"""
def _ecmwf_group_wind_vars(raw_vars):
    display_list = []
    var_map = {}
    processed = set()

    u_vars = [v for v in raw_vars if v.startswith("u")]
    for u_name in u_vars:
        suffix = u_name[1:]
        v_name = f"v{suffix}"
        if v_name in raw_vars:
            display = f"wind{suffix}"
            display_list.append(display)
            var_map[display] = {"kind": "wind", "u": u_name, "v": v_name}
            processed.add(u_name)
            processed.add(v_name)
        else:
            display_list.append(u_name)
            var_map[u_name] = {"kind": "scalar", "var": u_name}
            processed.add(u_name)r

    for name in raw_vars:
        if name in processed:
            continue
        display_list.append(name)
        var_map[name] = {"kind": "scalar", "var": name}

    return display_list, var_map

def _init_ecmwf_metadata(dataset: xr.Dataset):
    """Initialise ECMWF metadata (lat/lon/time names, candidate vars, frame labels).

    Colour-scale min/max are computed later for a user-selected
    variable and date range via /ecmwf_config.
    """
    global ecmwf_meta

    lat_name = None
    lon_name = None
    for cand in ("latitude", "lat"):
        if cand in dataset.coords:
            lat_name = cand
            break
    for cand in ("longitude", "lon"):
        if cand in dataset.coords:
            lon_name = cand
            break

    if lat_name is None or lon_name is None:
        raise ValueError("Could not find latitude/longitude coordinates in ECMWF dataset.")

    # Determine primary time-like dimension and discover time/step coords
    time_coord = dataset.coords.get("time") if "time" in dataset.coords else None
    step_coord = dataset.coords.get("step") if "step" in dataset.coords else None

    time_dim = None
    if time_coord is not None:
        time_dim = "time"
    elif step_coord is not None:
        time_dim = "step"

    # Candidate data variables that have both lat/lon and a time-like dimension
    candidate_vars = []
    for name, var in dataset.data_vars.items():
        has_latlon = (lat_name in var.dims) and (lon_name in var.dims)
        # Accept variables that have either time or step (or both) as time-like dimensions
        has_time = ("time" in var.dims) or ("step" in var.dims) or (time_dim is None)
        if has_latlon and has_time:
            candidate_vars.append(name)

    if not candidate_vars:
        # Fallback to all data variables if nothing matches criteria
        candidate_vars = list(dataset.data_vars)

    # Group u/v wind components into synthetic windXX display variables
    display_vars, var_map = _ecmwf_group_wind_vars(candidate_vars)

    # Prefer a sensible default variable if present (e.g. 2m temperature "t2m")
    default_var = None
    for preferred in ("t2m", "airTemperature", "t", "temperature"):
        if preferred in display_vars:
            default_var = preferred
            break
    if default_var is None and display_vars:
        default_var = display_vars[0]

    # Determine counts and labels
    frame_count = 1
    time_labels = ["t0"]
    time_count = 0
    step_count = 0
    step_values: list[int] = []

    if time_coord is not None:
        time_vals = pd.to_datetime(time_coord.values)
        time_count = len(time_vals)
        frame_count = time_count
        time_labels = time_vals.strftime('%Y-%m-%d %H:%M').tolist()
    elif time_dim is not None:
        # Fallback to using primary time-like dim if no explicit time coord
        coord = dataset[time_dim]
        frame_count = int(coord.sizes.get(time_dim, coord.size))
        raw_vals = coord.values
        time_labels = [
            f"Step {int(v)}" if np.isfinite(v) else f"Step {i}"
            for i, v in enumerate(raw_vals)
        ]

    if step_coord is not None:
        raw_steps = step_coord.values
        step_values = [int(v) if np.isfinite(v) else 0 for v in raw_steps]
        step_count = len(step_values)

    ecmwf_meta = {
        "lat_name": lat_name,
        "lon_name": lon_name,
        "time_dim": time_dim,
        "variables": display_vars,
        "var_name": default_var,
        "frame_count": frame_count,
        "time_labels": time_labels,
        "time_count": time_count,
        "step_count": step_count,
        "step_values": step_values,
        "v_min": None,
        "v_max": None,
        "range_start": 0,
        "range_end": max(0, frame_count - 1),
        "var_map": var_map,
    }


def _ecmwf_load_field(time_index: int = 0, step_index: int = 0):
    """Load a 2D lat/lon field for a given ECMWF time/step index pair.

    Uses the global ecmwf_ds and ecmwf_meta to select dims and slice
    time and step down to a single frame.
    """
    if ecmwf_ds is None:
        raise ValueError("No ECMWF dataset loaded")

    meta = ecmwf_meta
    lat_name = meta["lat_name"]
    lon_name = meta["lon_name"]
    var_name = meta["var_name"]

    if var_name is None:
        raise ValueError("No ECMWF variable selected")

    var_map = meta.get("var_map") or {}
    mapping = var_map.get(var_name)

    def _slice_to_2d(da: xr.DataArray) -> xr.DataArray:
        """Reduce a DataArray to a single 2D (lat, lon) slice for the given indices."""
        data = da
        if "time" in data.dims:
            max_time = data.sizes.get("time", 1) - 1
            safe_t = max(0, min(int(time_index), max_time))
            data = data.isel(time=safe_t)
        if "step" in data.dims:
            max_step = data.sizes.get("step", 1) - 1
            safe_s = max(0, min(int(step_index), max_step))
            data = data.isel(step=safe_s)
        if (lat_name, lon_name) not in (data.dims, data.dims[::-1]):
            raise ValueError(f"Expected ECMWF variable to have latitude/longitude dims, got {data.dims}")
        if data.dims != (lat_name, lon_name):
            data = data.transpose(lat_name, lon_name)
        return data

    if mapping and mapping.get("kind") == "wind":
        u_name = mapping["u"]
        v_name = mapping["v"]
        u_da = _slice_to_2d(ecmwf_ds[u_name])
        v_da = _slice_to_2d(ecmwf_ds[v_name])
        # Magnitude of wind vector from components
        data = (u_da ** 2 + v_da ** 2) ** 0.5
    else:
        data = _slice_to_2d(ecmwf_ds[var_name])

    lat_vals = ecmwf_ds[lat_name].values
    lon_vals = ecmwf_ds[lon_name].values

    return lat_vals, lon_vals, data


def _ecmwf_points_geojson(time_index: int = 0, step_index: int = 0, stride: int = 2):
    """Compute point features for the ECMWF field at a given time index.

    Returns a GeoJSON FeatureCollection (dict) of Point features, one per
    grid cell, filtered roughly to the Western Australia region to
    reduce payload size.
    """
    if ecmwf_ds is None:
        raise ValueError("No ECMWF dataset loaded")

    meta = ecmwf_meta
    lat_name = meta["lat_name"]
    lon_name = meta["lon_name"]
    var_name = meta.get("var_name")
    var_map = meta.get("var_map") or {}
    mapping = var_map.get(var_name)

    lat_vals = ecmwf_ds[lat_name].values
    lon_vals = ecmwf_ds[lon_name].values

    def _slice_to_2d(da: xr.DataArray) -> xr.DataArray:
        data = da
        if "time" in data.dims:
            max_time = data.sizes.get("time", 1) - 1
            safe_t = max(0, min(int(time_index), max_time))
            data = data.isel(time=safe_t)
        if "step" in data.dims:
            max_step = data.sizes.get("step", 1) - 1
            safe_s = max(0, min(int(step_index), max_step))
            data = data.isel(step=safe_s)
        if (lat_name, lon_name) not in (data.dims, data.dims[::-1]):
            raise ValueError(f"Expected ECMWF variable to have latitude/longitude dims, got {data.dims}")
        if data.dims != (lat_name, lon_name):
            data = data.transpose(lat_name, lon_name)
        return data

    angle_grid = None
    if mapping and mapping.get("kind") == "wind":
        u_name = mapping["u"]
        v_name = mapping["v"]
        u_da = _slice_to_2d(ecmwf_ds[u_name])
        v_da = _slice_to_2d(ecmwf_ds[v_name])
        U = u_da.values
        V = v_da.values
        if U.ndim != 2 or V.ndim != 2:
            raise ValueError("Expected ECMWF wind components to be 2D after slicing")
        if U.shape != V.shape:
            raise ValueError("ECMWF wind components have mismatched shapes")
        Z = np.sqrt(U ** 2 + V ** 2)
        # Angle from due north, clockwise, in degrees
        angle_grid = (np.degrees(np.arctan2(U, V)) + 360.0) % 360.0
    else:
        # Scalar case: delegate to the generic loader
        _, _, data = _ecmwf_load_field(time_index=time_index, step_index=step_index)
        Z = data.values

    if Z.ndim != 2:
        raise ValueError("Expected ECMWF field to be 2D after slicing")

    # Rough WA bounding box to limit the number of points we emit
    wa_lat_min, wa_lat_max = -36.0, -10.0
    wa_lon_min, wa_lon_max = 110.0, 135.0

    lat_mask = (lat_vals >= wa_lat_min) & (lat_vals <= wa_lat_max)
    lon_mask = (lon_vals >= wa_lon_min) & (lon_vals <= wa_lon_max)

    if not np.any(lat_mask) or not np.any(lon_mask):
        lat_mask = np.ones_like(lat_vals, dtype=bool)
        lon_mask = np.ones_like(lon_vals, dtype=bool)

    # Apply WA mask, then thin grid using a stride (>=1) to reduce payload size
    sub_lat = lat_vals[lat_mask]
    sub_lon = lon_vals[lon_mask]
    sub_Z = Z[np.ix_(lat_mask, lon_mask)]
    sub_A = None
    if angle_grid is not None:
        sub_A = angle_grid[np.ix_(lat_mask, lon_mask)]

    try:
        s = int(stride)
    except (TypeError, ValueError):
        s = 2
    if s < 1:
        s = 1
    if s > 8:
        s = 8

    sub_lat = sub_lat[::s]
    sub_lon = sub_lon[::s]
    sub_Z = sub_Z[::s, ::s]
    if sub_A is not None:
        sub_A = sub_A[::s, ::s]

    lon_grid, lat_grid = np.meshgrid(sub_lon, sub_lat)

    flat_lat = lat_grid.ravel()
    flat_lon = lon_grid.ravel()
    flat_val = sub_Z.ravel()
    flat_ang = sub_A.ravel() if sub_A is not None else None

    features = []
    for idx, (lat, lon, v) in enumerate(zip(flat_lat, flat_lon, flat_val)):
        if not np.isfinite(v):
            continue
        props = {"value": float(v)}
        if flat_ang is not None:
            ang = flat_ang[idx]
            if np.isfinite(ang):
                props["angle_degN"] = float(ang)
                props["speed"] = float(v)
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [float(lon), float(lat)],
                },
                "properties": props,
            }
        )

    return {"type": "FeatureCollection", "features": features}


"""
Return WA-subsetted ECMWF field (lat, lon, Z) for a given time/step.
This is used for client-side contour plotting with Plotly.
"""
def _ecmwf_wa_field(time_index: int = 0, step_index: int = 0, stride: int = 1):
    lat_vals, lon_vals, data = _ecmwf_load_field(time_index=time_index, step_index=step_index)

    Z = data.values
    if Z.ndim != 2:
        raise ValueError("Expected ECMWF field to be 2D after slicing")

    # Rough WA bounding box to limit the number of points we emit
    wa_lat_min, wa_lat_max = -36.0, -10.0
    wa_lon_min, wa_lon_max = 110.0, 135.0

    lat_mask = (lat_vals >= wa_lat_min) & (lat_vals <= wa_lat_max)
    lon_mask = (lon_vals >= wa_lon_min) & (lon_vals <= wa_lon_max)

    if not np.any(lat_mask) or not np.any(lon_mask):
        lat_mask = np.ones_like(lat_vals, dtype=bool)
        lon_mask = np.ones_like(lon_vals, dtype=bool)

    sub_lat = lat_vals[lat_mask]
    sub_lon = lon_vals[lon_mask]
    sub_Z = Z[np.ix_(lat_mask, lon_mask)]

    try:
        s = int(stride)
    except (TypeError, ValueError):
        s = 1
    if s < 1:
        s = 1
    if s > 8:
        s = 8

    sub_lat = sub_lat[::s]
    sub_lon = sub_lon[::s]
    sub_Z = sub_Z[::s, ::s]

    # Convert to Python types with NaNs as None
    lat_list = [float(v) for v in sub_lat]
    lon_list = [float(v) for v in sub_lon]
    z_rows = []
    for row in sub_Z:
        z_rows.append([
            float(v) if np.isfinite(v) else None
            for v in row
        ])

    return lat_list, lon_list, z_rows


def build_map_dataset(config):
    global ds, ds_wa
    if ds is None:
        raise ValueError("No dataset loaded")

    if not isinstance(config, dict):
        raise ValueError("Invalid configuration payload")

    var = config.get('variable')
    if not var:
        raise ValueError("Variable selection missing")

    start_date = config.get('start_date')
    end_date = config.get('end_date')

    # Always work on the WA-restricted dataset if available
    source = ds_wa if ds_wa is not None else ds
    subset = source.sel(time=slice(start_date, end_date))

    if subset.time.size == 0 or subset.lat.size == 0:
        raise ValueError("No data found for Western Australia in this range")

    if 'station' in subset.coords:
        subset = subset.sortby('station')

    # Resample logic is broken. Resampling improves performance
    # However it breaks Timeline control to no longer use 15min native time resolution
    # times_raw = pd.to_datetime(subset.time.values)
    # if len(times_raw) > 100:
    #     total_duration = times_raw[-1] - times_raw[0]
    #     target_interval = total_duration / 100
    #     interval_minutes= max(15, int(target_interval.total_seconds() / 60 / 15) * 15)
    #     resample_rule= f"{interval_minutes}min"
        
    #     subset= subset.resample(time=resample_rule).mean(skipna=True)

    print(f"🧮 Processing {subset.time.size} timesteps from {start_date} to {end_date}...")
    times = pd.to_datetime(subset.time.values)
    lats = subset.lat.values.flatten().tolist()
    lons = subset.lon.values.flatten().tolist()

    print(f"✅ Completed spatial setup: {len(lats)} stations, {len(times)} timesteps")

    if 'station' in subset.coords:
        station_names = [str(s) for s in subset.station.values.flatten()]
    else:
        station_names = [f"Loc_{i}" for i in range(len(lats))]

    station_points = []
    for lat, lon, name in zip(lats, lons, station_names):
        lat_val = float(lat) if np.isfinite(lat) else None
        lon_val = float(lon) if np.isfinite(lon) else None
        station_points.append({
            "lat": lat_val,
            "lon": lon_val,
            "station": name
        })

    is_combined_wind = (var == 'wind_3m')
    target_var_for_scale = 'wind_3m_speed' if is_combined_wind else var

    if target_var_for_scale not in subset.data_vars:
        raise ValueError(f"Variable '{var}' not available in dataset")

    print(f"📊 Computing vmin/vmax for {target_var_for_scale}...")
    v_min = float(subset[target_var_for_scale].min(skipna=True).values)
    v_max = float(subset[target_var_for_scale].max(skipna=True).values)
    print(f"✅ Range: {v_min:.2f} to {v_max:.2f}")

    values_over_time = []
    for t in subset.time:
        if is_combined_wind:
            speeds = subset['wind_3m_speed'].sel(time=t).values.flatten()
            angles = subset['wind_3m_degN'].sel(time=t).values.flatten()
            frame = []
            for s, a in zip(speeds, angles):
                s_val = float(s) if np.isfinite(s) else 0.0
                a_val = (float(a) + 180) % 360 if np.isfinite(a) else 0.0
                frame.append([s_val, a_val])
        else:
            frame_data = subset[var].sel(time=t).values.flatten()
            # Normalise here so values are JSON-safe without extra passes
            frame = [float(x) if np.isfinite(x) else None for x in frame_data]
        values_over_time.append(frame)

    print(f"✅ Frame extraction complete")

    return {
        "lats": lats,
        "lons": lons,
        "stations": station_names,
        "station_points": station_points,
        "time_labels": times.strftime('%Y-%m-%d %H:%M').tolist(),
        "values": values_over_time,
        "v_min": v_min,
        "v_max": v_max,
        "var_name": var,
        "is_combined_wind": is_combined_wind
    }

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/metadata', methods=['GET'])
def metadata():
    """Return high-level metadata for the currently loaded DPIRD and ECMWF datasets.

    This is intended for UI tooling and documentation: variables, units,
    coordinate ranges, and basic ECMWF dimension info. If a dataset has not
    yet been uploaded, its entry will be null.
    """
    global ds, ecmwf_ds, ecmwf_meta

    response = {"dpird": None, "ecmwf": None}

    if ds is not None:
        vars_meta = []
        raw_vars = set(ds.data_vars)
        for name, da in ds.data_vars.items():
            # Hide wind components; they are exposed via the synthetic wind_3m
            if name in {"wind_3m_speed", "wind_3m_degN"}:
                continue
            vars_meta.append({
                "id": name,
                "units": da.attrs.get("units"),
                "long_name": da.attrs.get("long_name") or da.attrs.get("standard_name"),
                "dims": list(da.dims),
                "kind": "scalar",
            })

        # Describe the pseudo-variable for combined wind, for map view only
        if {"wind_3m_speed", "wind_3m_degN"}.issubset(raw_vars):
            vars_meta.append({
                "id": "wind_3m",
                "kind": "vector",
                "components": ["wind_3m_speed", "wind_3m_degN"],
                "description": "3m wind speed and direction, map view only.",
            })

        coords = {}
        if "lat" in ds.coords:
            c = ds["lat"]
            coords["lat"] = {
                "dims": list(c.dims),
                "min": float(c.min(skipna=True).values),
                "max": float(c.max(skipna=True).values),
            }
        if "lon" in ds.coords:
            c = ds["lon"]
            coords["lon"] = {
                "dims": list(c.dims),
                "min": float(c.min(skipna=True).values),
                "max": float(c.max(skipna=True).values),
            }
        if "time" in ds.coords:
            c = ds["time"]
            tvals = pd.to_datetime(c.values)
            coords["time"] = {
                "dims": list(c.dims),
                "start": tvals.min().strftime('%Y-%m-%dT%H:%M:%S'),
                "end": tvals.max().strftime('%Y-%m-%dT%H:%M:%S'),
                "count": int(c.size),
            }
        if "station" in ds.coords:
            c = ds["station"]
            coords["station"] = {
                "dims": list(c.dims),
                "count": int(c.size),
            }

        response["dpird"] = {
            "variables": vars_meta,
            "coords": coords,
        }

    if ecmwf_ds is not None:
        vars_meta = []
        for name, da in ecmwf_ds.data_vars.items():
            vars_meta.append({
                "id": name,
                "units": da.attrs.get("units"),
                "long_name": da.attrs.get("long_name") or da.attrs.get("standard_name"),
                "dims": list(da.dims),
                "kind": "scalar",
            })

        coords = {}
        for cname in ("latitude", "lat", "longitude", "lon", "time", "step"):
            if cname not in ecmwf_ds.coords:
                continue
            c = ecmwf_ds[cname]
            entry = {"dims": list(c.dims)}
            if np.issubdtype(c.dtype, np.number):
                entry["min"] = float(c.min(skipna=True).values)
                entry["max"] = float(c.max(skipna=True).values)
            elif cname == "time":
                tvals = pd.to_datetime(c.values)
                entry["start"] = tvals.min().strftime('%Y-%m-%dT%H:%M:%S')
                entry["end"] = tvals.max().strftime('%Y-%m-%dT%H:%M:%S')
                entry["count"] = int(c.size)
            coords[cname] = entry

        response["ecmwf"] = {
            "variables": vars_meta,
            "coords": coords,
            "meta": {
                "lat_name": ecmwf_meta.get("lat_name"),
                "lon_name": ecmwf_meta.get("lon_name"),
                "time_dim": ecmwf_meta.get("time_dim"),
            },
        }

    return jsonify(response)


def _dpird_cache_key(config: dict) -> tuple:
    """Build a cache key for DPIRD map datasets based on dataset id and config."""
    global _dpird_dataset_id
    if _dpird_dataset_id is None:
        return (None, None, None, None)
    var = config.get("variable")
    start_date = config.get("start_date")
    end_date = config.get("end_date")
    return (_dpird_dataset_id, var, start_date, end_date)


def _get_or_build_map_dataset(config: dict) -> dict:
    """Return a cached DPIRD map dataset or build and cache it.

    Cache key is (current file, variable, start_date, end_date). If any
    element is missing, caching is skipped and build_map_dataset is called
    directly.
    """
    global _dpird_map_cache
    key = _dpird_cache_key(config)
    if None in key:
        return build_map_dataset(config)
    if key in _dpird_map_cache:
        return _dpird_map_cache[key]
    dataset = build_map_dataset(config)
    _dpird_map_cache[key] = dataset
    return dataset


def _build_dpird_ui_meta():
    """Build UI metadata for the currently loaded DPIRD dataset.

    Shape matches the response from /upload and dpird_meta from /query so
    the frontend can call populateDpirdUi() with this payload.
    """
    global ds, _dpird_dataset_id
    if ds is None:
        return None

    raw_vars = [v for v in ds.data_vars]
    display_vars = raw_vars.copy()

    if 'wind_3m_speed' in raw_vars and 'wind_3m_degN' in raw_vars:
        display_vars.append('wind_3m')
        if 'wind_3m_speed' in display_vars:
            display_vars.remove('wind_3m_speed')
        if 'wind_3m_degN' in display_vars:
            display_vars.remove('wind_3m_degN')

    if 'station' in ds.coords:
        stations = [str(s) for s in ds.station.values]
        stations.sort()
    else:
        stations = [f"Loc_{i}" for i in range(len(ds.lat.values.flatten()))]

    time_vals = pd.to_datetime(ds.time.values)
    date_range = [
        time_vals.min().strftime('%Y-%m-%d'),
        time_vals.max().strftime('%Y-%m-%d')
    ]

    # Derive a human-friendly source label (e.g. filename or Acacia id)
    source_label = None
    if _dpird_dataset_id:
        if _dpird_dataset_id.startswith("acacia://"):
            source_label = _dpird_dataset_id.split("/")[-1]
        else:
            source_label = os.path.basename(_dpird_dataset_id)

    return {
        "variables": display_vars,
        "stations": stations,
        "date_range": date_range,
        "source_label": source_label,
    }


def _build_ecmwf_ui_meta():
    """Build UI metadata for the currently loaded ECMWF dataset.

    Shape matches ecmwf_meta from /query and the response from
    /ecmwf_upload so the frontend can call populateEcmwfUi().
    """
    global ecmwf_ds, ecmwf_meta, _ecmwf_dataset_id
    if ecmwf_ds is None or not ecmwf_meta:
        return None

    # Derive a human-friendly source label for ECMWF
    source_label = None
    if _ecmwf_dataset_id:
        if _ecmwf_dataset_id.startswith("acacia://"):
            source_label = _ecmwf_dataset_id.split("/")[-1]
        else:
            source_label = os.path.basename(_ecmwf_dataset_id)

    return {
        "time_labels": ecmwf_meta["time_labels"],
        "variables": ecmwf_meta["variables"],
        "default_var": ecmwf_meta["var_name"],
        "frame_count": ecmwf_meta["frame_count"],
        "time_count": ecmwf_meta.get("time_count", 0),
        "step_count": ecmwf_meta.get("step_count", 0),
        "step_values": ecmwf_meta.get("step_values", []),
        "source_label": source_label,
    }

@app.route('/upload', methods=['POST'])
def upload_file():
    global ds, ds_wa, _dpird_dataset_id, _dpird_map_cache
    try:
        file = request.files['file']
        filepath = os.path.join(UPLOAD_FOLDER, file.filename)
        file.save(filepath)

        # Prefer to open in a way that lets xarray/dask stream along the
        # time dimension when available, but fall back cleanly if that
        # environment is not present.
        try:
            ds = xr.open_dataset(filepath, engine= 'h5netcdf', chunks={"time": 4096})
        except Exception:
            ds = xr.open_dataset(filepath)

        # Precompute a WA-restricted view once so later calls don't have to
        # reapply the same spatial mask for every request. When the dataset
        # is chunked with dask, boolean indexing must use a computed mask
        # to avoid "boolean dask array" indexing errors.
        ds_wa = None
        if "lat" in ds.coords and "lon" in ds.coords:
            wa_lat_bounds = [-35.0, -13.0]
            wa_lon_bounds = [115.0, 129.0]
            lat_cond = (ds.lat >= wa_lat_bounds[0]) & (ds.lat <= wa_lat_bounds[1])
            lon_cond = (ds.lon >= wa_lon_bounds[0]) & (ds.lon <= wa_lon_bounds[1])
            mask = lat_cond & lon_cond
            # If this is a dask-backed array, compute the mask before indexing
            if hasattr(mask, 'chunks'):
                print(" Computing WA bounds mask...")
                mask = mask.compute()
            print(f" Applying WA bounds mask...")
            ds_wa = ds.where(mask, drop=True)
            if hasattr(ds_wa, 'chunks'):
                print("💾 Persisting WA subset to memory...")
                ds_wa = ds_wa.persist()

        # Reset DPIRD map cache whenever a new dataset is uploaded
        _dpird_dataset_id = filepath
        _dpird_map_cache = {}
        ui_meta = _build_dpird_ui_meta()
        return jsonify(ui_meta)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

"""Load specific datasets from Acacia based on selection."""
@app.route('/query', methods=['POST'])
def query_datasets():
    global ds, ds_wa, ecmwf_ds, _dpird_dataset_id, _ecmwf_dataset_id, _dpird_map_cache
    
    try:
        payload = request.json or {}
        datasets = payload.get('datasets', [])
        date_range = payload.get('date_range')
        response = {}
        
        # --- DPIRD Handling ---
        if 'DPIRD' in datasets:
            try:
                ds = dpird_service.load_dataset()
                ds = xr.decode_cf(ds, decode_times=True)
                # Apply WA bounds mask (with Dask-safe computation)
                ds_wa = None
                if "lat" in ds.coords and "lon" in ds.coords:
                    wa_lat_bounds = [-35.0, -13.0]
                    wa_lon_bounds = [115.0, 129.0]
                    lat_cond = (ds.lat >= wa_lat_bounds[0]) & (ds.lat <= wa_lat_bounds[1])
                    lon_cond = (ds.lon >= wa_lon_bounds[0]) & (ds.lon <= wa_lon_bounds[1])
                    mask = lat_cond & lon_cond
                    
                    # Compute mask if it's a Dask array
                    if hasattr(mask, 'chunks'):
                        mask = mask.compute()
                    
                    ds_wa = ds.where(mask, drop=True)
                
                _dpird_dataset_id = "acacia://clean_DPIRD/DPIRD_final_stations.nc"
                _dpird_map_cache.clear()
                response['dpird_meta'] = _build_dpird_ui_meta()
                
            except Exception as e:
                response['dpird_error'] = str(e)
            
        # --- ECMWF Handling ---
        if 'ECMWF' in datasets:
            try:
                if not date_range or 'start' not in date_range or 'end' not in date_range:
                    # Default to last 3 days if not specified
                    today = pd.Timestamp.now().normalize()
                    three_days_ago = today - pd.Timedelta(days=3)
                    date_range = {
                        'start': three_days_ago.strftime('%Y-%m-%d'),
                        'end': today.strftime('%Y-%m-%d')
                    }
                
                # Load date range using service method
                ecmwf_ds = ecmwf_op_service.load_date_range(
                    date_range['start'], 
                    date_range['end']
                )
                dataset_id_suffix = f"{date_range['start']}_to_{date_range['end']}"
                
                # Initialize metadata for the loaded dataset
                _init_ecmwf_metadata(ecmwf_ds)
                _ecmwf_dataset_id = f"acacia://ecmwf_op_clean/{dataset_id_suffix}"
                
                response['ecmwf_meta'] = _build_ecmwf_ui_meta()
                
            except Exception as e:
                response['ecmwf_error'] = str(e)
        
        return jsonify(response)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/initial_state', methods=['GET'])
def initial_state():
    """Return UI metadata for any datasets already loaded in memory.

    This lets the frontend initialise variable lists and date ranges
    when datasets have been preloaded on server startup (e.g. via a
    CLI flag) without requiring the user to upload or query first.
    """
    payload = {}

    dpird_meta = _build_dpird_ui_meta()
    if dpird_meta is not None:
        payload["dpird_meta"] = dpird_meta

    ecmwf_ui = _build_ecmwf_ui_meta()
    if ecmwf_ui is not None:
        payload["ecmwf_meta"] = ecmwf_ui

    return jsonify(payload)
    
@app.route('/ecmwf_upload', methods=['POST'])
def ecmwf_upload():
    """Upload and initialise an ECMWF NetCDF file.

    Stores the dataset in memory and returns metadata needed for
    contour visualisation (time labels and global min/max).
    """
    global ecmwf_ds, _ecmwf_dataset_id, _ecmwf_minmax_cache
    try:
        file = request.files['file']
        filepath = os.path.join(UPLOAD_FOLDER, file.filename)
        file.save(filepath)

        try:
            ecmwf_ds = xr.open_dataset(filepath,  engine='h5netcdf', chunks={})
        except Exception:
            ecmwf_ds = xr.open_dataset(filepath)

        # Track the current ECMWF dataset id (used to derive source_label
        # for the UI) and reset any cached min/max entries when a new
        # file is uploaded.
        _ecmwf_dataset_id = filepath
        _ecmwf_minmax_cache = {}

        _init_ecmwf_metadata(ecmwf_ds)

        ui_meta = _build_ecmwf_ui_meta()
        return jsonify(ui_meta)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/ecmwf_config', methods=['POST'])
def ecmwf_config():
    """Configure ECMWF variable and date range, returning colour-scale limits.

    The client sends a variable name and a start/end frame index. We update
    the global ecmwf_meta selection and compute min/max values across the
    requested date range for use in a consistent colour scale.
    """
    global ecmwf_meta, _ecmwf_minmax_cache
    try:
        if ecmwf_ds is None:
            raise ValueError("No ECMWF dataset loaded")

        payload = request.json or {}
        var_name = payload.get('var_name')
        if not var_name:
            raise ValueError("ECMWF variable selection missing")
        
        var_map = ecmwf_meta.get("var_map") or {}
        mapping = var_map.get(var_name)

        # Determine a base DataArray to drive frame counting/range selection
        if mapping and mapping.get("kind") == "wind":
            u_name = mapping["u"]
            base_da = ecmwf_ds[u_name]
            unit_str = base_da.attrs.get("units", "GRIB_units")
            long_name = WIND_LONG_NAMES.get(var_name, f"Wind speed ({var_name})")
        else:
            if var_name not in ecmwf_ds.data_vars:
                raise ValueError(f"ECMWF variable '{var_name}' not found in dataset")
            base_da = ecmwf_ds[var_name]
            unit_str = base_da.attrs.get("units", "GRIB_units")
            long_name = base_da.attrs.get("long_name", var_name)

        time_dim = ecmwf_meta.get("time_dim")

        # New unified request shape: frame_range {start, end}; fall back to legacy
        frame_range = payload.get('frame_range') or {}
        start_idx = frame_range.get('start')
        end_idx = frame_range.get('end')

        if time_dim and time_dim in base_da.dims:
            max_frame = int(base_da.sizes.get(time_dim, 1)) - 1
            if start_idx is None:
                start_idx = int(payload.get('start_index', 0))
            if end_idx is None:
                end_idx = int(payload.get('end_index', max_frame))
            start_idx = max(0, min(start_idx, max_frame))
            end_idx = max(start_idx, min(end_idx, max_frame))
            base_slice = base_da.isel({time_dim: slice(start_idx, end_idx + 1)})
        else:
            max_frame = 0
            start_idx = 0
            end_idx = 0
            base_slice = base_da

        # Check cache BEFORE expensive computation
        cache_key = (var_name, _ecmwf_dataset_id, start_idx, end_idx)
        if cache_key in _ecmwf_minmax_cache:
            cached = _ecmwf_minmax_cache[cache_key]
            print(f"✓ Cache HIT for {var_name} [{start_idx}:{end_idx}]")
            v_min = cached['v_min']
            v_max = cached['v_max']
            unit_str = cached['units']
            long_name = cached['long_name']
        else:
            print(f"⚠ Cache MISS for {var_name} [{start_idx}:{end_idx}], computing...")

            # Compute colour-scale limits. 
            # For wind variables, this is based on magnitude derived from u/v components.
            if mapping and mapping.get("kind") == "wind":
                u_all = ecmwf_ds[mapping["u"]]
                v_all = ecmwf_ds[mapping["v"]]
                if time_dim and time_dim in u_all.dims:
                    u_slice = u_all.isel({time_dim: slice(start_idx, end_idx + 1)})
                    v_slice = v_all.isel({time_dim: slice(start_idx, end_idx + 1)})
                else:
                    u_slice = u_all
                    v_slice = v_all
                
                speed = (u_slice ** 2 + v_slice ** 2) ** 0.5
                
                # Handle Dask arrays efficiently
                if hasattr(speed, 'chunks'):
                    with dask.config.set(scheduler='threads'):
                        speed_computed = speed.compute()
                        v_min = float(np.nanmin(speed_computed.values))
                        v_max = float(np.nanmax(speed_computed.values))
                else:
                    v_min = float(speed.min(skipna=True).values)
                    v_max = float(speed.max(skipna=True).values)
                
                print(f"  Wind min/max: {v_min:.2f} to {v_max:.2f} {unit_str}")
            else:
                print(f"  Computing min/max for scalar {var_name}...")
                
                # Handle Dask arrays efficiently
                if hasattr(base_slice, 'chunks'):
                    with dask.config.set(scheduler='threads'):
                        computed = base_slice.compute()
                        v_min = float(np.nanmin(computed.values))
                        v_max = float(np.nanmax(computed.values))
                else:
                    v_min = float(base_slice.min(skipna=True).values)
                    v_max = float(base_slice.max(skipna=True).values)
                
                print(f"  Min/max: {v_min:.2f} to {v_max:.2f} {unit_str}")
            
            # Store in cache after computation
            _ecmwf_minmax_cache[cache_key] = {
                'v_min': v_min,
                'v_max': v_max,
                'units': unit_str,
                'long_name': long_name
            }
            print(f"Cached min/max for {var_name} [{start_idx}:{end_idx}]")

        # Update global metadata
        ecmwf_meta["var_name"] = var_name
        ecmwf_meta["v_min"] = v_min
        ecmwf_meta["v_max"] = v_max
        ecmwf_meta["range_start"] = start_idx
        ecmwf_meta["range_end"] = end_idx

        return jsonify({
            "v_min": v_min,
            "v_max": v_max,
            "range_start": start_idx,
            "range_end": end_idx,
            "frame_count": max_frame + 1,
            'units': unit_str,        
            'long_name': long_name
        })
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    
@app.route('/plot', methods=['POST'])
def get_plot_data():
    global ds
    config = request.json or {}
    if ds is None:
        return jsonify({"error": "No dataset loaded"}), 400

    start_date = config.get('start_date')
    end_date = config.get('end_date')
    if not start_date or not end_date:
        return jsonify({"error": "Start and end dates are required"}), 400

    subset = ds.sel(time=slice(start_date, end_date))
    
    response_data = {}

    # Unified shape: "variable" for a single series, but continue to
    # accept legacy "variables" list for backwards compatibility.
    variables = config.get('variables')
    if not variables:
        var_name = config.get('variable')
        variables = [var_name] if var_name else []

    station = config.get('station')

    for var in variables:
        # Graph view does not support the synthetic 'wind_3m' directly
        if var not in subset.data_vars:
            continue

        data_array = subset[var]
        if station:
            try:
                data_array = data_array.sel(station=station)
            except Exception:
                return jsonify({"error": f"Station '{station}' not found for variable '{var}'"}), 400
        
        y_values = data_array.values.flatten()
        y_clean = [float(x) if np.isfinite(x) else None for x in y_values]
        
        response_data[var] = {
            "x": pd.to_datetime(data_array.time.values).strftime('%Y-%m-%dT%H:%M:%S').tolist(),
            "y": y_clean
        }
    if not response_data:
        return jsonify({"error": "No variables available for the requested plot"}), 400
    return jsonify(response_data)

@app.route('/map_data', methods=['POST'])
def get_map_data():
    try:
        dataset = _get_or_build_map_dataset(request.json or {})
        return jsonify({
            "lats": dataset["lats"],
            "lons": dataset["lons"],
            "stations": dataset["stations"],
            "stations_meta": dataset["station_points"],
            "time_labels": dataset["time_labels"],
            "values": dataset["values"],
            "v_min": dataset["v_min"],
            "v_max": dataset["v_max"]
        })
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route('/ecmwf_contours', methods=['POST'])
def ecmwf_contours():
    """Return ECMWF point features for a given time/step index pair as GeoJSON."""
    try:
        if ecmwf_ds is None:
            raise ValueError("No ECMWF dataset loaded")

        config = request.json or {}
        # Optional var_name lets the client ensure the backend selection
        # matches the currently viewed variable (including synthetic wind).
        var_name = config.get('var_name')
        if var_name:
            ecmwf_meta["var_name"] = var_name

        time_index = int(config.get('time_index', 0))
        step_index = int(config.get('step_index', 0))
        stride = int(config.get('stride', 2)) if 'stride' in config else 2

        # Clamp indices against available counts
        time_count = int(ecmwf_meta.get("time_count", 0)) or 1
        step_count = int(ecmwf_meta.get("step_count", 0)) or 1
        safe_t = max(0, min(time_index, time_count - 1))
        safe_s = max(0, min(step_index, step_count - 1))

        geojson = _ecmwf_points_geojson(time_index=safe_t, step_index=safe_s, stride=stride)

        # Build a human-readable label using forecast time and step -> valid time
        label = f"t{safe_t} +{safe_s}h"
        try:
            run_time_val = None
            step_hours = 0
            if "time" in ecmwf_ds.coords:
                run_time_val = pd.to_datetime(ecmwf_ds["time"].values[safe_t])
            if "step" in ecmwf_ds.coords:
                raw_step = ecmwf_ds["step"].values[safe_s]
                step_hours = int(raw_step) if np.isfinite(raw_step) else 0
            if run_time_val is not None:
                valid_dt = run_time_val + pd.Timedelta(hours=step_hours)
                label = f"{valid_dt.strftime('%Y-%m-%d %H:%M')} (T={run_time_val.strftime('%H:%M')} +{step_hours}h)"
        except Exception:
            # Fall back to generic label if anything goes wrong
            pass

        return jsonify({
            "geojson": geojson,
            "time_label": label,
            "v_min": ecmwf_meta.get("v_min"),
            "v_max": ecmwf_meta.get("v_max"),
        })
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400


@app.route('/ecmwf_field', methods=['POST'])
def ecmwf_field():
    """Return a WA-subsetted ECMWF 2D field for contour plotting.

    Payload:
        {
          "var_name": str,
          "time_index": int,
          "step_index": int,
          "stride": int (optional, default 2)
        }
    """
    global ecmwf_ds, ecmwf_meta

    if ecmwf_ds is None:
        return jsonify({"error": "ECMWF dataset not loaded"}), 400

    payload = request.get_json(silent=True) or {}
    var_name = payload.get("var_name") or (ecmwf_meta or {}).get("var_name")
    if not var_name:
        return jsonify({"error": "Missing ECMWF variable name"}), 400
    # Keep backend selection in sync with requested variable if provided
    if "var_name" in payload:
        ecmwf_meta["var_name"] = payload["var_name"]

    time_index = int(payload.get("time_index", 0) or 0)
    step_index = int(payload.get("step_index", 0) or 0)
    stride = payload.get("stride", 2)

    try:
        lat_list, lon_list, z_rows = _ecmwf_wa_field(
            time_index=time_index,
            step_index=step_index,
            stride=stride,
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"Failed to build ECMWF field: {exc}"}), 500

    # Time label mirroring /ecmwf_contours behaviour
    meta_times = (ecmwf_meta or {}).get("times") or []
    time_label = None
    if meta_times and 0 <= time_index < len(meta_times):
        ts = meta_times[time_index]
        try:
            ts = pd.to_datetime(ts)
            time_label = ts.strftime("%Y-%m-%d %H:%M")
        except Exception:  # noqa: BLE001
            time_label = str(ts)
    if time_label is None:
        time_label = f"t={time_index}, step={step_index}"

    return jsonify({
        "lat": lat_list,
        "lon": lon_list,
        "z": z_rows,
        "time_label": time_label,
        "v_min": (ecmwf_meta or {}).get("v_min"),
        "v_max": (ecmwf_meta or {}).get("v_max"),
    })
    # except Exception as exc:
    #     return jsonify({"error": str(exc)}), 500


@app.route('/fill_values', methods=['POST'])
def get_fill_values():
    try:
        dataset = _get_or_build_map_dataset(request.json or {})
        if dataset["var_name"] != 'airTemperature':
            raise ValueError("Fill value painting is only supported for airTemperature")
        fill_circles = dataset["fill_circles"]
        fill_values = compute_fill_values(dataset["station_points"], fill_circles, dataset["values"])
        return jsonify({
            "fill_circles": fill_circles,
            "fill_values": _serialize_frames(fill_values),
            "v_min": dataset["v_min"],
            "v_max": dataset["v_max"]
        })
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


def preload_default_datasets():
    """Preload local DPIRD and ECMWF NetCDF files for testing.

    When the app is started with a special CLI flag, this function
    loads the default files into memory so the UI behaves as if the
    user had manually uploaded them.
    """
    global ds, ds_wa, _dpird_dataset_id, _dpird_map_cache, ecmwf_ds, _ecmwf_dataset_id

    base_dir = os.path.dirname(os.path.abspath(__file__))
    dpird_path = os.path.join(base_dir, 'uploads', 'DPIRD_final_stations_utc0.nc')
    ecmwf_path = os.path.join(base_dir, 'uploads', '02.nc')

    # DPIRD preload
    if os.path.exists(dpird_path):
        try:
            try:
                ds_local = xr.open_dataset(dpird_path, engine='h5netcdf', chunks={"time": 4096})
            except Exception:
                ds_local = xr.open_dataset(dpird_path)

            ds_wa_local = None
            if "lat" in ds_local.coords and "lon" in ds_local.coords:
                wa_lat_bounds = [-35.0, -13.0]
                wa_lon_bounds = [115.0, 129.0]
                lat_cond = (ds_local.lat >= wa_lat_bounds[0]) & (ds_local.lat <= wa_lat_bounds[1])
                lon_cond = (ds_local.lon >= wa_lon_bounds[0]) & (ds_local.lon <= wa_lon_bounds[1])
                mask = lat_cond & lon_cond
                if hasattr(mask, 'chunks'):
                    mask = mask.compute()
                ds_wa_local = ds_local.where(mask, drop=True)
                if hasattr(ds_wa_local, 'chunks'):
                    ds_wa_local = ds_wa_local.persist()

            ds = ds_local
            ds_wa = ds_wa_local
            _dpird_dataset_id = dpird_path
            _dpird_map_cache = {}
            print(f"Preloaded DPIRD dataset from {dpird_path}")
        except Exception as exc:
            print(f"Failed to preload DPIRD dataset from {dpird_path}: {exc}")
    else:
        print(f"DPIRD preload file not found at {dpird_path}")

    # ECMWF preload
    if os.path.exists(ecmwf_path):
        try:
            try:
                ds_ec = xr.open_dataset(ecmwf_path, engine='h5netcdf', chunks={})
            except Exception:
                ds_ec = xr.open_dataset(ecmwf_path)
            ecmwf_ds = ds_ec
            _init_ecmwf_metadata(ecmwf_ds)
            _ecmwf_dataset_id = ecmwf_path
            print(f"Preloaded ECMWF dataset from {ecmwf_path}")
        except Exception as exc:
            print(f"Failed to preload ECMWF dataset from {ecmwf_path}: {exc}")
    else:
        print(f"ECMWF preload file not found at {ecmwf_path}")


if __name__ == '__main__':
    # If started with a special flag, preload default datasets
    # Example: python app.py -1
    if len(sys.argv) > 1 and sys.argv[1] == '-1':
        preload_default_datasets()

    app.run(debug=True)