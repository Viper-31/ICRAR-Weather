from flask import Flask, render_template, request, jsonify
import xarray as xr
import os
import pandas as pd
import numpy as np
import math

from services.map_processing import build_spatial_overlays, compute_fill_circles, compute_fill_values
from services.acacia_get import ECMWFOperationalService, DPIRDService

app = Flask(__name__)
UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

ecmwf_op_service = ECMWFOperationalService()
dpird_service = DPIRDService()

active_datasets = {'DPIRD': None, 'ECMWF': None}  # Store loaded datasets
dataset_configs = {'DPIRD': {}, 'ECMWF': {}}  # Store metadata

ds = None  # DPIRD dataset
ds_wa = None  # DPIRD dataset restricted to WA bounds
_dpird_dataset_id = None  # identifier for current DPIRD dataset (filepath)
_dpird_map_cache = {}  # cache for build_map_dataset results
_ecmwf_dataset_id= None
_ecmwf_map_cache= {}
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
}


def _replace_nan(value):
    if isinstance(value, float) and math.isnan(value):
        return None
    return value


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


def _init_ecmwf_metadata(dataset: xr.Dataset):
    """Initialise ECMWF metadata (lat/lon/time names, candidate vars, frame labels).

    Colour-scale min/max are computed later for a user-selected
    variable and date range via /ecmwf_config.
    """
    global ecmwf_meta

    # Robust coord detection
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
        raise ValueError(f"Could not find lat/lon coords. Found: {list(dataset.coords)}")

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
        # Loose check: assume if it has the lat/lon dims, it's map-able
        if (lat_name in var.dims) and (lon_name in var.dims):
            candidate_vars.append(name)
    
    # Fallback: if strict checks fail, just list everything so UI isn't empty
    if not candidate_vars:
        candidate_vars = list(dataset.data_vars.keys())

    # Prefer a sensible default variable
    default_var = None
    for preferred in ("t2m", "airTemperature", "t", "temperature"):
        if preferred in candidate_vars:
            default_var = preferred
            break
    if default_var is None and candidate_vars:
        default_var = candidate_vars[0]

    # Determine counts and labels
    frame_count = 1
    time_labels = ["t0"]
    time_count = 0
    step_count = 0
    step_values: list[int] = []

    if time_coord is not None:
        try:
            time_vals = pd.to_datetime(time_coord.values)
            time_count = len(time_vals)
            frame_count = time_count
            time_labels = time_vals.strftime('%Y-%m-%d %H:%M').tolist()
        except Exception:
            # formatting failed, use raw
            time_labels = [str(t) for t in time_coord.values]
            time_count = len(time_labels)
            
    elif time_dim is not None:
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
        "variables": candidate_vars,
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

    data = ecmwf_ds[var_name]

    # Reduce extra dimensions to a single slice so we end up with
    # a 2D field over latitude/longitude.
    if "time" in data.dims:
        max_time = data.sizes.get("time", 1) - 1
        safe_t = max(0, min(int(time_index), max_time))
        data = data.isel(time=safe_t)
    if "step" in data.dims:
        max_step = data.sizes.get("step", 1) - 1
        safe_s = max(0, min(int(step_index), max_step))
        data = data.isel(step=safe_s)

    # Ensure the data is 2D over (lat, lon) in that order
    if (lat_name, lon_name) not in (data.dims, data.dims[::-1]):
        raise ValueError(f"Expected ECMWF variable to have latitude/longitude dims, got {data.dims}")

    if data.dims != (lat_name, lon_name):
        data = data.transpose(lat_name, lon_name)

    lat_vals = ecmwf_ds[lat_name].values
    lon_vals = ecmwf_ds[lon_name].values

    return lat_vals, lon_vals, data


def _ecmwf_points_geojson(time_index: int = 0, step_index: int = 0, stride: int = 2):
    """Compute point features for the ECMWF field at a given time index.

    Returns a GeoJSON FeatureCollection (dict) of Point features, one per
    grid cell, filtered roughly to the Western Australia region to
    reduce payload size.
    """
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

    # Apply WA mask, then thin grid using a stride (>=1) to reduce payload size
    sub_lat = lat_vals[lat_mask]
    sub_lon = lon_vals[lon_mask]
    sub_Z = Z[np.ix_(lat_mask, lon_mask)]

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

    lon_grid, lat_grid = np.meshgrid(sub_lon, sub_lat)

    flat_lat = lat_grid.ravel()
    flat_lon = lon_grid.ravel()
    flat_val = sub_Z.ravel()

    features = []
    for lat, lon, v in zip(flat_lat, flat_lon, flat_val):
        if not np.isfinite(v):
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [float(lon), float(lat)],
                },
                "properties": {
                    "value": float(v),
                },
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


def dpird_build_map_dataset(config):
    global ds
    # NOTE: We do NOT use global ds_wa here anymore to avoid pre-compute cost.
    # We apply the mask dynamically to the selected time slice.
    
    if ds is None:
        raise ValueError("No dataset loaded")

    var = config.get('variable')
    start_date = config.get('start_date')
    end_date = config.get('end_date')

    # 1. Select Time Range first (lazy)
    subset = ds.sel(time=slice(start_date, end_date))

    # 2. Apply WA Bounds Mask dynamically
    if "lat" in subset.coords and "lon" in subset.coords:
        wa_lat_bounds = [-35.0, -13.0]
        wa_lon_bounds = [115.0, 129.0]
        try:
            subset = subset.sel(
                lat=slice(wa_lat_bounds[0], wa_lat_bounds[1]),
                lon=slice(wa_lon_bounds[0], wa_lon_bounds[1])
            )
        
        except (KeyError, ValueError):
            lat_vals = subset.lat.values  
            lon_vals = subset.lon.values
            lat_mask = (lat_vals >= wa_lat_bounds[0]) & (lat_vals <= wa_lat_bounds[1])
            lon_mask = (lon_vals >= wa_lon_bounds[0]) & (lon_vals <= wa_lon_bounds[1])

            lat_indices = np.where(lat_mask)[0]
            lon_indices = np.where(lon_mask)[0]

            if len(lat_indices) > 0 and len(lon_indices) > 0:
                subset = subset.isel(
                    lat=lat_indices,
                    lon=lon_indices
                )
                
    if subset.time.size == 0 or subset.lat.size == 0:
        # Fallback if mask removed everything (e.g. data is outside WA)
        # Just use original subset so we return *something* valid rather than crashing
        subset = ds.sel(time=slice(start_date, end_date))

    if 'station' in subset.coords:
        subset = subset.sortby('station')

    times_raw = pd.to_datetime(subset.time.values)
    if len(times_raw) > 100:
        indices = np.linspace(0, len(times_raw) - 1, 100, dtype=int)
        subset = subset.isel(time=indices)

    times = pd.to_datetime(subset.time.values)
    lats = subset.lat.values.flatten().tolist()
    lons = subset.lon.values.flatten().tolist()

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

    hull_overlays = build_spatial_overlays(station_points)
    fill_circles = compute_fill_circles(hull_overlays.get("polygon", []), station_points)

    is_combined_wind = (var == 'wind_3m')
    target_var_for_scale = 'wind_3m_speed' if is_combined_wind else var

    if target_var_for_scale not in subset.data_vars:
        # Soft fallback if combined wind requested but pieces missing
        if is_combined_wind: 
             is_combined_wind = False
             var = list(subset.data_vars.keys())[0] # Pick first available
             target_var_for_scale = var
        else:
             raise ValueError(f"Variable '{var}' not available in dataset")

    v_min = float(subset[target_var_for_scale].min(skipna=True).values)
    v_max = float(subset[target_var_for_scale].max(skipna=True).values)

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

    return {
        "lats": lats,
        "lons": lons,
        "stations": station_names,
        "station_points": station_points,
        "hull": hull_overlays,
        "fill_circles": fill_circles,
        "time_labels": times.strftime('%Y-%m-%d %H:%M').tolist(),
        "values": values_over_time,
        "v_min": v_min,
        "v_max": v_max,
        "var_name": var,
        "is_combined_wind": is_combined_wind
    }

"""
Build map-compatible dataset from ECMWF grid data.
Uses generic time/step indexing (t=0, step=0) to establish grid points.
"""
def build_ecmwf_map_dataset(ds, config):
    global ecmwf_meta
    var_name = config.get('variable') or ecmwf_meta.get('var_name')
    # Just use the first available frame to get the grid structure
    lat_vals, lon_vals, _ = _ecmwf_load_field(time_index=0, step_index=0)

    stride = 5
    wa_lat_bounds = [-36.0, -10.0]
    wa_lon_bounds = [110.0, 135.0]
    # Create mask for WA
    lat_mask = (lat_vals >= wa_lat_bounds[0]) & (lat_vals <= wa_lat_bounds[1])
    lon_mask = (lon_vals >= wa_lon_bounds[0]) & (lon_vals <= wa_lon_bounds[1])

    if not np.any(lat_mask) or not np.any(lon_mask):
         sub_lat = lat_vals[::stride]
         sub_lon = lon_vals[::stride]
    else:
        sub_lat = lat_vals[lat_mask][::stride]
        sub_lon = lon_vals[lon_mask][::stride]
    
    # Create meshgrid for points
    lon_grid, lat_grid = np.meshgrid(sub_lon, sub_lat)
    lats_flat = lat_grid.flatten().tolist()
    lons_flat = lon_grid.flatten().tolist()
    
    station_names = [f"Grid_{i}" for i in range(len(lats_flat))]
    
    station_points = []
    for lat, lon, name in zip(lats_flat, lons_flat, station_names):
        station_points.append({
            "lat": lat, 
            "lon": lon, 
            "station": name
        })
    
    return {
        "lats": lats_flat,
        "lons": lons_flat,
        "stations": station_names,
        "station_points": station_points,
        "hull": { 'boundary': [], 'hullType': 'none' },
        "fill_circles": [], 
        "time_labels": ecmwf_meta.get("time_labels", []),
        "values": [], # Animation is handled via contours for ECMWF
        "v_min": ecmwf_meta.get("v_min"),
        "v_max": ecmwf_meta.get("v_max"),
        "var_name": var_name,
        "is_combined_wind": False
    }

"""
Initialise global DPIRD state (ds) and caching.
Removed ds_wa pre-computation to improve load speed.
"""
def _init_dpird_dataset(dataset, source_id):

    global ds, ds_wa, _dpird_map_cache, _dpird_dataset_id
    ds = dataset.chunk({'time': 'auto'}) # Ensure it's treated as Dask array if not already
    
    ds_wa = None 
        
    _dpird_dataset_id = source_id
    _dpird_map_cache = {}

    raw_vars = list(ds.data_vars)
    display_vars = raw_vars.copy()
    
    if 'wind_3m_speed' in raw_vars and 'wind_3m_degN' in raw_vars:
        display_vars.append('wind_3m') 
        if 'wind_3m_speed' in display_vars: display_vars.remove('wind_3m_speed')
        if 'wind_3m_degN' in display_vars: display_vars.remove('wind_3m_degN')
    
    if 'station' in ds.coords:
        stations = [str(s) for s in ds.station.values]
        stations.sort()
    else:
        stations = [f"Loc_{i}" for i in range(len(ds.lat.values.flatten()))]
    
    date_range = []
    if 'time' in ds.coords and ds.time.size > 0:
        t_min = pd.to_datetime(ds.time.values.min())
        t_max = pd.to_datetime(ds.time.values.max())
        date_range = [t_min.strftime('%Y-%m-%d'), t_max.strftime('%Y-%m-%d')]
        
    return {
        "variables": display_vars,
        "stations": stations,
        "date_range": date_range
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

#--------------------
# Cache helper functions
# -------------------
def _dpird_cache_key(config: dict) -> tuple:
    """Build a cache key for DPIRD map datasets based on dataset id and config."""
    global _dpird_dataset_id
    if _dpird_dataset_id is None:
        return (None, None, None, None)
    var = config.get("variable")
    start_date = config.get("start_date")
    end_date = config.get("end_date")
    return (_dpird_dataset_id, var, start_date, end_date)

"""Build cache key for ECMWF map datasets"""
def _ecmwf_cache_key(config: dict) -> tuple:
    global _ecmwf_dataset_id
    if _ecmwf_dataset_id is None:
        return (None, None, None, None, None, None)
    var = config.get("variable")
    start_date = config.get("start_date")
    end_date = config.get("end_date")
    time_idx = config.get("ecmwf_time_idx", 0)
    step_idx = config.get("ecmwf_step_idx", 0)
    return (_ecmwf_dataset_id, var, start_date, end_date, time_idx, step_idx)

def _get_or_build_map_dataset(config: dict) -> dict:
    """Return a cached DPIRD map dataset or build and cache it.

    Cache key is (current file, variable, start_date, end_date). If any
    element is missing, caching is skipped and build_map_dataset is called
    directly.
    """
    global _dpird_map_cache
    key = _dpird_cache_key(config)
    if None in key:
        return dpird_build_map_dataset(config)
    if key in _dpird_map_cache:
        return _dpird_map_cache[key]
    dataset = dpird_build_map_dataset(config)
    _dpird_map_cache[key] = dataset
    return dataset

"""Return cached ECMWF map dataset or build and cache it"""
def _get_or_build_ecmwf_map(config: dict) -> dict:
    global _ecmwf_map_cache
    key = _ecmwf_cache_key(config)
    if None in key:
        return build_ecmwf_map_dataset(active_datasets['ECMWF'], config)
    if key in _ecmwf_map_cache:
        return _ecmwf_map_cache[key]
    dataset = build_ecmwf_map_dataset(active_datasets['ECMWF'], config)
    _ecmwf_map_cache[key] = dataset
    return dataset

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
            ds = xr.open_dataset(filepath, chunks={"time": 4096})
        except Exception:
            ds = xr.open_dataset(filepath)
        
        meta= _init_dpird_dataset(ds,filepath)
        return jsonify(meta)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    
"""Load specific datasets from Acacia based on selection."""
@app.route('/query', methods=['POST'])
def query_datasets():
    global active_datasets, ecmwf_ds, _ecmwf_dataset_id, _ecmwf_map_cache
    
    try:
        selection = request.json.get('datasets', [])
        response_data = {
            "message": "Datasets updated", 
            "active": selection,
            "dpird_meta": None,
            "ecmwf_meta": None
        }
        
        # --- DPIRD Handling ---
        if 'DPIRD' in selection:
            # If not active or re-query needed, load from service
            if active_datasets['DPIRD'] is None:
                try:
                    dataset = dpird_service.load_dataset()
                    response_data["dpird_meta"] = _init_dpird_dataset(dataset, "acacia_dpird")
                    active_datasets['DPIRD'] = "Loaded"
                except Exception as e:
                    return jsonify({"error": f"Failed to load DPIRD: {str(e)}"}), 500
            else:
                # Already loaded, just return current metadata
                if ds is not None:
                     response_data["dpird_meta"] = _init_dpird_dataset(ds, _dpird_dataset_id)

        elif 'DPIRD' not in selection:
            active_datasets['DPIRD'] = None
            # Optional: Set global ds to None if strict unloading required
            
        # --- ECMWF Handling ---
        if 'ECMWF' in selection:
            if active_datasets['ECMWF'] is None:
                try:
                    dates = ecmwf_op_service.available_dates()
                    if not dates:
                        return jsonify({"error": "No ECMWF data found on Acacia"}), 404
                    
                    # Load latest date by default
                    selected_date = dates[-1]
                    ecmwf_ds = ecmwf_op_service.load_dataset(selected_date)
                    _init_ecmwf_metadata(ecmwf_ds)
                    
                    active_datasets['ECMWF'] = f"Loaded {selected_date}"
                    _ecmwf_dataset_id = f"ecmwf_{selected_date}"
                    _ecmwf_map_cache = {}  # Clear generic map cache
                except Exception as e:
                     return jsonify({"error": f"Failed to load ECMWF: {str(e)}"}), 500
            
            # Helper to construct metadata response for ECMWF
            response_data["ecmwf_meta"] = {
                "time_labels": ecmwf_meta["time_labels"],
                "variables": ecmwf_meta["variables"],
                "default_var": ecmwf_meta["var_name"],
                "frame_count": ecmwf_meta["frame_count"],
                "time_count": ecmwf_meta.get("time_count", 0),
                "step_count": ecmwf_meta.get("step_count", 0),
                "step_values": ecmwf_meta.get("step_values", []),
            }

        elif 'ECMWF' not in selection:
             active_datasets['ECMWF'] = None
        
        return jsonify(response_data)

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/ecmwf_upload', methods=['POST'])
def ecmwf_upload():
    """Upload and initialise an ECMWF NetCDF file.

    Stores the dataset in memory and returns metadata needed for
    contour visualisation (time labels and global min/max).
    """
    global ecmwf_ds
    try:
        file = request.files['file']
        filepath = os.path.join(UPLOAD_FOLDER, file.filename)
        file.save(filepath)

        try:
            ecmwf_ds = xr.open_dataset(filepath, chunks={})
        except Exception:
            ecmwf_ds = xr.open_dataset(filepath)
        _init_ecmwf_metadata(ecmwf_ds)

        return jsonify({
            "time_labels": ecmwf_meta["time_labels"],
            "variables": ecmwf_meta["variables"],
            "default_var": ecmwf_meta["var_name"],
            "frame_count": ecmwf_meta["frame_count"],
            "time_count": ecmwf_meta.get("time_count", 0),
            "step_count": ecmwf_meta.get("step_count", 0),
            "step_values": ecmwf_meta.get("step_values", []),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/ecmwf_config', methods=['POST'])
def ecmwf_config():
    """Configure ECMWF variable and date range, returning colour-scale limits.

    The client sends a variable name and a start/end frame index. We update
    the global ecmwf_meta selection and compute min/max values across the
    requested date range for use in a consistent colour scale.
    """
    global ecmwf_meta
    try:
        if ecmwf_ds is None:
            raise ValueError("No ECMWF dataset loaded")

        payload = request.json or {}
        var_name = payload.get('var_name')
        if not var_name:
            raise ValueError("ECMWF variable selection missing")
        if var_name not in ecmwf_ds.data_vars:
            raise ValueError(f"ECMWF variable '{var_name}' not found in dataset")

        time_dim = ecmwf_meta.get("time_dim")
        data = ecmwf_ds[var_name]

        # New unified request shape: frame_range {start, end}; fall back to legacy
        frame_range = payload.get('frame_range') or {}
        start_idx = frame_range.get('start')
        end_idx = frame_range.get('end')

        if time_dim and time_dim in data.dims:
            max_frame = int(data.sizes.get(time_dim, 1)) - 1
            if start_idx is None:
                start_idx = int(payload.get('start_index', 0))
            if end_idx is None:
                end_idx = int(payload.get('end_index', max_frame))
            start_idx = max(0, min(start_idx, max_frame))
            end_idx = max(start_idx, min(end_idx, max_frame))
            sliced = data.isel({time_dim: slice(start_idx, end_idx + 1)})
        else:
            max_frame = 0
            start_idx = 0
            end_idx = 0
            sliced = data

        v_min = float(sliced.min(skipna=True).values)
        v_max = float(sliced.max(skipna=True).values)

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
            "hull": dataset["hull"],
            "fill_circles": dataset["fill_circles"],
            "time_labels": dataset["time_labels"],
            # values are already JSON-normalised inside build_map_dataset
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
    if "var_name" in payload and payload["var_name"] in ecmwf_ds.data_vars:
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

if __name__ == '__main__':
    app.run(debug=True)