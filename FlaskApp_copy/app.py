from flask import Flask, render_template, request, jsonify
from pathlib import Path
import xarray as xr
import os
import pandas as pd
import numpy as np
import math

from services.map_processing import build_spatial_overlays, compute_fill_circles, compute_fill_values
from services.acacia_get import ECMWFOperationalService, DPIRDService

app = Flask(__name__)

#--------------------
# Dataset services
# -------------------
ecmwf_op_service = ECMWFOperationalService()
dpird_service = DPIRDService()

active_datasets = {'DPIRD': None, 'ECMWF': None}  # Store loaded datasets
dataset_configs = {'DPIRD': {}, 'ECMWF': {}}  # Store metadata

#--------------------
# DPIRD helper func
# -------------------
ds = None


def _replace_nan(value):
    if isinstance(value, float) and math.isnan(value):
        return None
    return value

def _serialize_frames(frames):
    cleaned = []
    for frame in frames:
        serialized_frame = []
        for item in frame:
            if isinstance(item, list):
                serialized_frame.append([_replace_nan(v) for v in item])
            else:
                serialized_frame.append(_replace_nan(item))
        cleaned.append(serialized_frame)
    return cleaned


def build_map_dataset(config):
    global ds
    if ds is None:
        raise ValueError("No dataset loaded")

    if not isinstance(config, dict):
        raise ValueError("Invalid configuration payload")

    var = config.get('variable')
    if not var:
        raise ValueError("Variable selection missing")

    start_date = config.get('start_date')
    end_date = config.get('end_date')
    subset = ds.sel(time=slice(start_date, end_date))

    wa_lat_bounds = [-35.0, -13.0]
    wa_lon_bounds = [115.0, 129.0]
    subset = subset.where(
        (subset.lat >= wa_lat_bounds[0]) & (subset.lat <= wa_lat_bounds[1]) &
        (subset.lon >= wa_lon_bounds[0]) & (subset.lon <= wa_lon_bounds[1]),
        drop=True
    )

    if subset.time.size == 0 or subset.lat.size == 0:
        raise ValueError("No data found for Western Australia in this range")

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
            frame = [float(x) if np.isfinite(x) else np.nan for x in frame_data]
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

#--------------------
# ECMWF helper func
# -------------------
ecmwf_op_service = ECMWFOperationalService()
EMPTY_HULL_STATE = { 'boundary': [], 'interior': [], 'polygon': [], 'hullType': 'none' }

def build_combined_dataset(config):
    """Combines data from active datasets based on config"""
    var = config.get('variable')
    start_date = config.get('start_date')
    end_date = config.get('end_date')
    
    combined_data = {
        'lats': [], 'lons': [], 'stations': [], 'station_points': [],
        'time_labels': [], 'values': [], 'v_min': None, 'v_max': None,
        'hull': EMPTY_HULL_STATE, 'fill_circles': [], 'var_name': var,
        'is_combined_wind': False
    }
    
    # Process DPIRD if active
    if active_datasets['DPIRD'] is not None:
        dpird_data = build_dpird_map_dataset(active_datasets['DPIRD'], config)
        _merge_dataset(combined_data, dpird_data)
    
    # Process ECMWF if active
    if active_datasets['ECMWF'] is not None:
        ecmwf_data = build_ecmwf_map_dataset(active_datasets['ECMWF'], config)
        _merge_dataset(combined_data, ecmwf_data)
    
    # Compute spatial overlays after combining all points
    if combined_data['station_points']:
        hull_overlays = build_spatial_overlays(combined_data['station_points'])
        combined_data['hull'] = hull_overlays
        combined_data['fill_circles'] = compute_fill_circles(
            hull_overlays.get("polygon", []), 
            combined_data['station_points']
        )
    
    return combined_data

def build_dpird_map_dataset(ds, config):
    """Build map dataset from DPIRD stations (1D time: 'time')"""
    var = config.get('variable')
    start_date = config.get('start_date')
    end_date = config.get('end_date')
    
    # DPIRD uses simple 1D time coordinate
    subset = ds.sel(time=slice(start_date, end_date))
    
    wa_lat_bounds = [-35.0, -13.0]
    wa_lon_bounds = [115.0, 129.0]
    subset = subset.where(
        (subset.lat >= wa_lat_bounds[0]) & (subset.lat <= wa_lat_bounds[1]) &
        (subset.lon >= wa_lon_bounds[0]) & (subset.lon <= wa_lon_bounds[1]),
        drop=True
    )

    if subset.time.size == 0 or subset.lat.size == 0:
        raise ValueError("No DPIRD data found for Western Australia in this range")

    if 'station' in subset.coords:
        subset = subset.sortby('station')

    # Time sampling for performance
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
        station_names = [f"DPIRD_{i}" for i in range(len(lats))]

    station_points = []
    for lat, lon, name in zip(lats, lons, station_names):
        station_points.append({
            "lat": float(lat) if np.isfinite(lat) else None,
            "lon": float(lon) if np.isfinite(lon) else None,
            "station": name
        })

    # Handle wind variables (DPIRD: degN is wind FROM direction)
    is_combined_wind = (var == 'wind_3m')
    target_var_for_scale = 'wind_3m_speed' if is_combined_wind else var

    if target_var_for_scale not in subset.data_vars:
        raise ValueError(f"Variable '{var}' not available in DPIRD dataset")

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
                # DPIRD wind is FROM direction, convert to TO direction for display
                a_val = (float(a) + 180) % 360 if np.isfinite(a) else 0.0
                frame.append([s_val, a_val])
        else:
            frame_data = subset[var].sel(time=t).values.flatten()
            frame = [float(x) if np.isfinite(x) else np.nan for x in frame_data]
        values_over_time.append(frame)

    return {
        "lats": lats,
        "lons": lons,
        "stations": station_names,
        "station_points": station_points,
        "hull": EMPTY_HULL_STATE,
        "fill_circles": [],
        "time_labels": times.strftime('%Y-%m-%d %H:%M').tolist(),
        "values": values_over_time,
        "v_min": v_min,
        "v_max": v_max,
        "var_name": var,
        "is_combined_wind": is_combined_wind
    }

def build_ecmwf_map_dataset(ds, config):
    """
    Build map dataset from ECMWF grid data
    ECMWF has 2D time structure:
    - 'time': Forecast reference time (when forecast was run)
    - 'step': Forecast step period (+hours from reference time)
    - 'valid_time': Proper time (time + step, the actual forecast timestamp)
    """
    var = config.get('variable')
    start_date = config.get('start_date')
    end_date = config.get('end_date')
    
    # ECMWF config: select specific forecast reference time and step
    forecast_ref_time_idx = config.get('ecmwf_time_idx', 0)  # Default to first time
    forecast_step_idx = config.get('ecmwf_step_idx', 0)      # Default to 0-hour forecast
    
    # Select time range using valid_time (the "proper time")
    subset = ds.sel(valid_time=slice(start_date, end_date))
    
    # WA bounds
    wa_lat_bounds = [-35.0, -13.0]
    wa_lon_bounds = [115.0, 129.0]
    subset = subset.where(
        (subset.latitude >= wa_lat_bounds[0]) & (subset.latitude <= wa_lat_bounds[1]) &
        (subset.longitude >= wa_lon_bounds[0]) & (subset.longitude <= wa_lon_bounds[1]),
        drop=True
    )
    
    # Sub-sample grid for performance (every 5th point)
    subset = subset.isel(latitude=slice(None, None, 5), longitude=slice(None, None, 5))
    
    # Time sampling (use valid_time for timeline)
    times_raw = pd.to_datetime(subset.valid_time.values.flatten())
    if len(times_raw) > 100:
        indices = np.linspace(0, len(times_raw) - 1, 100, dtype=int)
        # Reshape indices to match 2D time structure
        valid_time_shape = subset.valid_time.shape
        time_indices = [idx // valid_time_shape[1] for idx in indices]
        step_indices = [idx % valid_time_shape[1] for idx in indices]
        subset = subset.isel(time=time_indices, step=step_indices)
    
    times = pd.to_datetime(subset.valid_time.values.flatten())
    
    # Flatten grid to points
    lats = subset.latitude.values
    lons = subset.longitude.values
    lat_grid, lon_grid = np.meshgrid(lats, lons, indexing='ij')
    lats_flat = lat_grid.flatten().tolist()
    lons_flat = lon_grid.flatten().tolist()
    
    station_points = []
    for i, (lat, lon) in enumerate(zip(lats_flat, lons_flat)):
        station_points.append({
            "lat": float(lat),
            "lon": float(lon),
            "station": f"ECMWF_Grid_{i}"
        })
    
    # Handle wind variables (ECMWF: u/v are wind TO direction)
    is_combined_wind = var.startswith('wind')
    if is_combined_wind:
        # Extract height/pressure level (e.g., 'wind10' -> '10')
        suffix = var.replace('wind', '')
        u_var = f'u{suffix}'
        v_var = f'v{suffix}'
        
        if u_var not in subset.data_vars or v_var not in subset.data_vars:
            raise ValueError(f"Wind components {u_var}/{v_var} not found in ECMWF dataset")
        
        # Convert u,v to speed and direction (wind TO direction)
        values_over_time = []
        for t_idx in range(subset.sizes['time']):
            for s_idx in range(subset.sizes['step']):
                u_vals = subset[u_var].isel(time=t_idx, step=s_idx).values.flatten()
                v_vals = subset[v_var].isel(time=t_idx, step=s_idx).values.flatten()
                
                speeds = np.sqrt(u_vals**2 + v_vals**2)
                # atan2(u, v) gives wind TO direction (meteorological convention)
                angles = (np.arctan2(u_vals, v_vals) * 180 / np.pi) % 360
                
                frame = [[float(s), float(a)] for s, a in zip(speeds, angles)]
                values_over_time.append(frame)
        
        v_min = float(np.nanmin([np.nanmin([f[0] for f in frame]) for frame in values_over_time]))
        v_max = float(np.nanmax([np.nanmax([f[0] for f in frame]) for frame in values_over_time]))
    else:
        if var not in subset.data_vars:
            raise ValueError(f"Variable '{var}' not available in ECMWF dataset")
        
        values_over_time = []
        for t_idx in range(subset.sizes['time']):
            for s_idx in range(subset.sizes['step']):
                frame_data = subset[var].isel(time=t_idx, step=s_idx).values.flatten()
                frame = [float(x) if np.isfinite(x) else np.nan for x in frame_data]
                values_over_time.append(frame)
        
        v_min = float(subset[var].min(skipna=True).values)
        v_max = float(subset[var].max(skipna=True).values)
    
    return {
        "lats": lats_flat,
        "lons": lons_flat,
        "stations": [p["station"] for p in station_points],
        "station_points": station_points,
        "hull": EMPTY_HULL_STATE,
        "fill_circles": [],
        "time_labels": times.strftime('%Y-%m-%d %H:%M').tolist(),
        "values": values_over_time,
        "v_min": v_min,
        "v_max": v_max,
        "var_name": var,
        "is_combined_wind": is_combined_wind
    }

def _merge_dataset(target, source):
    """Merge source dataset into target"""
    target['lats'].extend(source['lats'])
    target['lons'].extend(source['lons'])
    target['stations'].extend(source['stations'])
    target['station_points'].extend(source['station_points'])
    
    # Merge values (align time steps - use shortest timeline)
    if not target['values']:
        target['values'] = source['values']
        target['time_labels'] = source['time_labels']
    else:
        min_len = min(len(target['values']), len(source['values']))
        # Truncate to shortest timeline
        target['values'] = target['values'][:min_len]
        target['time_labels'] = target['time_labels'][:min_len]
        # Append station values to each time step
        for i in range(min_len):
            target['values'][i].extend(source['values'][i])
    
    # Update min/max
    if target['v_min'] is None:
        target['v_min'] = source['v_min']
        target['v_max'] = source['v_max']
    else:
        target['v_min'] = min(target['v_min'], source['v_min'])
        target['v_max'] = max(target['v_max'], source['v_max'])

#-------------------
#Flask app
#-------------------
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/switch_dataset', methods=['POST'])
def switch_dataset():
    """Load/unload datasets based on selection"""
    global active_datasets
    
    try:
        selection = request.json.get('datasets', [])
        
        # Load DPIRD
        if 'DPIRD' in selection and active_datasets['DPIRD'] is None:
            active_datasets['DPIRD'] = dpird_service.load_dataset()
        elif 'DPIRD' not in selection:
            active_datasets['DPIRD'] = None
        
        # Load ECMWF (use most recent date)
        if 'ECMWF' in selection and active_datasets['ECMWF'] is None:
            dates = ecmwf_op_service.available_dates()
            if not dates:
                return jsonify({"error": "No ECMWF data files found"}), 404
            active_datasets['ECMWF'] = ecmwf_op_service.load_dataset(dates[-1])
        elif 'ECMWF' not in selection:
            active_datasets['ECMWF'] = None
        
        return jsonify({"message": "Datasets updated", "active": selection})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    
@app.route('/plot', methods=['POST'])
def get_plot_data():
    """Get time series data for graph view (DPIRD only for now)"""
    try:
        config = request.json
        variables = config.get('variables', [])
        station = config.get('station')
        start_date = config.get('start_date')
        end_date = config.get('end_date')
        
        # Parse variable (e.g., "DPIRD:wind_3m_speed")
        if not variables:
            return jsonify({"error": "No variables specified"}), 400
        
        var_full = variables[0]
        dataset, var = var_full.split(':') if ':' in var_full else ('', var_full)
        
        # Only DPIRD supports station-based time series for now
        if dataset != 'DPIRD' or active_datasets['DPIRD'] is None:
            return jsonify({"error": "Graph view only supports DPIRD station data"}), 400
        
        ds = active_datasets['DPIRD']
        subset = ds.sel(time=slice(start_date, end_date))
        
        response_data = {}
        if var not in subset.data_vars:
            return jsonify({"error": f"Variable '{var}' not found in dataset"}), 400
            
        data_array = subset[var]
        if station:
            data_array = data_array.sel(station=station)
        
        y_values = data_array.values.flatten()
        y_clean = [float(x) if np.isfinite(x) else None for x in y_values]
        
        response_data[var] = {
            "x": pd.to_datetime(data_array.time.values).strftime('%Y-%m-%dT%H:%M:%S').tolist(),
            "y": y_clean
        }
        return jsonify(response_data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/init_data', methods=['GET'])
def init_data():
    """Initialize UI with available variables and metadata"""
    try:
        all_vars = []
        all_stations = []
        date_ranges = []
        ecmwf_time_info = None
        
        if active_datasets['DPIRD'] is not None:
            ds = active_datasets['DPIRD']
            dpird_vars = dpird_service.get_display_vars(ds)
            all_vars.extend([{"id": f"DPIRD:{v}", "label": f"📍 {v}", "source": "DPIRD"} for v in dpird_vars])
            
            if 'station' in ds.coords:
                stations = [str(s) for s in ds.station.values]
                all_stations.extend(stations)
            
            time_vals = pd.to_datetime(ds.time.values)
            date_ranges.append([time_vals.min(), time_vals.max()])
        
        if active_datasets['ECMWF'] is not None:
            ds = active_datasets['ECMWF']
            ecmwf_vars = ecmwf_op_service.get_display_vars(ds)
            all_vars.extend([{"id": f"ECMWF:{v}", "label": f"🌐 {v}", "source": "ECMWF"} for v in ecmwf_vars])
            
            # ECMWF time metadata
            ref_times = pd.to_datetime(ds.time.values)
            step_hours = ds.step.values.astype('timedelta64[h]').astype(int).tolist()
            
            ecmwf_time_info = {
                "forecast_ref_times": ref_times.strftime('%Y-%m-%d %H:%M').tolist(),
                "forecast_steps": step_hours,
                "n_ref_times": len(ref_times),
                "n_steps": len(step_hours)
            }
            
            time_vals = pd.to_datetime(ds.valid_time.values.flatten())
            date_ranges.append([time_vals.min(), time_vals.max()])
        
        if not all_vars:
            return jsonify({"error": "No datasets loaded"}), 400
        
        # Find overlapping date range
        if date_ranges:
            min_date = max(dr[0] for dr in date_ranges)
            max_date = min(dr[1] for dr in date_ranges)
        else:
            min_date = max_date = pd.Timestamp.now()
        
        return jsonify({
            "variables": all_vars,
            "stations": sorted(set(all_stations)),
            "date_range": [min_date.strftime('%Y-%m-%d'), max_date.strftime('%Y-%m-%d')],
            "ecmwf_time_info": ecmwf_time_info
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/map_data', methods=['POST'])
def get_map_data():
    try:
        dataset = build_combined_dataset(request.json)
        return jsonify({
            "lats": dataset["lats"],
            "lons": dataset["lons"],
            "stations": dataset["stations"],
            "stations_meta": dataset["station_points"],
            "hull": dataset["hull"],
            "fill_circles": dataset["fill_circles"],
            "time_labels": dataset["time_labels"],
            "values": _serialize_frames(dataset["values"]),
            "v_min": dataset["v_min"],
            "v_max": dataset["v_max"]
        })
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route('/fill_values', methods=['POST'])
def get_fill_values():
    try:
        config = request.json
        
        # Parse dataset prefix
        var = config.get('variable')
        dataset = config.get('dataset')
        
        # Only DPIRD airTemperature supports fill values
        if dataset != 'DPIRD' or var != 'airTemperature':
            return jsonify({"error": "Fill values only supported for DPIRD airTemperature"}), 400
        
        if active_datasets['DPIRD'] is None:
            return jsonify({"error": "DPIRD dataset not loaded"}), 400
        
        dataset = build_dpird_map_dataset(active_datasets['DPIRD'], config)
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