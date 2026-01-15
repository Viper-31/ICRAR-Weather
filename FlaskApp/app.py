from flask import Flask, render_template, request, jsonify
import xarray as xr
import os
import pandas as pd
import numpy as np
import math

from services.map_processing import build_spatial_overlays, compute_fill_circles, compute_fill_values

app = Flask(__name__)
UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

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

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_file():
    global ds
    try:
        file = request.files['file']
        filepath = os.path.join(UPLOAD_FOLDER, file.filename)
        file.save(filepath)
        
        ds = xr.open_dataset(filepath)
        raw_vars = [v for v in ds.data_vars]
        
        # Filtered list to send to UI
        display_vars = raw_vars.copy()
        
        if 'wind_3m_speed' in raw_vars and 'wind_3m_degN' in raw_vars:
            # We use 'wind_3m' as the ID but we can label it in frontend if needed
            # For now, let's keep the ID consistent with your frontend logic
            display_vars.append('wind_3m') 
            
            # Remove the individual components so they don't show in the UI
            if 'wind_3m_speed' in display_vars: display_vars.remove('wind_3m_speed')
            if 'wind_3m_degN' in display_vars: display_vars.remove('wind_3m_degN')
        
        if 'station' in ds.coords:
            stations = [str(s) for s in ds.station.values]
            stations.sort()
        else:
            stations = [f"Loc_{i}" for i in range(len(ds.lat.values.flatten()))]
        
        time_vals = pd.to_datetime(ds.time.values)
        date_range = [time_vals.min().strftime('%Y-%m-%d'), time_vals.max().strftime('%Y-%m-%d')]

        return jsonify({
            "variables": display_vars, 
            "stations": stations, 
            "date_range": date_range
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    
@app.route('/plot', methods=['POST'])
def get_plot_data():
    global ds
    config = request.json
    subset = ds.sel(time=slice(config['start_date'], config['end_date']))
    
    response_data = {}
    for var in config['variables']:
        # Graph view likely doesn't support 'wind_3m', so we skip if not in ds
        if var not in subset.data_vars: continue 
            
        data_array = subset[var]
        if config.get('station'):
            data_array = data_array.sel(station=config['station'])
        
        y_values = data_array.values.flatten()
        y_clean = [float(x) if np.isfinite(x) else None for x in y_values]
        
        response_data[var] = {
            "x": pd.to_datetime(data_array.time.values).strftime('%Y-%m-%dT%H:%M:%S').tolist(),
            "y": y_clean
        }
    return jsonify(response_data)

@app.route('/map_data', methods=['POST'])
def get_map_data():
    try:
        dataset = build_map_dataset(request.json)
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
        dataset = build_map_dataset(request.json)
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