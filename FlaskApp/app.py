from flask import Flask, render_template, request, jsonify
import xarray as xr
import os
import pandas as pd
import numpy as np

app = Flask(__name__)
UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

ds = None

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
        variables = [v for v in ds.data_vars]
        
        # Extract and sort station names alphabetically
        if 'station' in ds.coords:
            stations = [str(s) for s in ds.station.values]
            stations.sort()
        else:
            stations = [f"Loc_{i}" for i in range(len(ds.lat.values.flatten()))]
        
        time_vals = pd.to_datetime(ds.time.values)
        date_range = [time_vals.min().strftime('%Y-%m-%d'), time_vals.max().strftime('%Y-%m-%d')]

        return jsonify({
            "variables": variables, 
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
    global ds
    if ds is None:
        return jsonify({"error": "No dataset loaded"}), 400
        
    config = request.json
    var = config['variable']
    
# 1. Use slice to handle date ranges safely
    subset = ds.sel(time=slice(config['start_date'], config['end_date']))

    # --- ADD THIS NEW SNIPPET HERE ---
    # Define the bounding box for Western Australia
    wa_lat_bounds = [-35.0, -13.0]
    wa_lon_bounds = [115.0, 129.0]

    # Filter the subset to only include WA coordinates
    subset = subset.where(
        (subset.lat >= wa_lat_bounds[0]) & (subset.lat <= wa_lat_bounds[1]) &
        (subset.lon >= wa_lon_bounds[0]) & (subset.lon <= wa_lon_bounds[1]),
        drop=True
    )
    # ---------------------------------

    if subset.time.size == 0 or subset.lat.size == 0:
        return jsonify({"error": "No data found for Western Australia in this range"}), 400

    # 2. MANDATORY ALIGNMENT: Sort first, outside the loop
    if 'station' in subset.coords:
        subset = subset.sortby('station')

    # 3. DOWNSAMPLE FIRST: Reduce time steps before looping
    times_raw = pd.to_datetime(subset.time.values)
    if len(times_raw) > 100:
        indices = np.linspace(0, len(times_raw) - 1, 100, dtype=int)
        subset = subset.isel(time=indices)
    
    # Refresh times list after downsampling
    times = pd.to_datetime(subset.time.values)

    # 4. Extract Fixed Coordinates (Only once!)
    lats = subset.lat.values.flatten().tolist()
    lons = subset.lon.values.flatten().tolist()
    
    if 'station' in subset.coords:
        station_names = [str(s) for s in subset.station.values.flatten()]
    else:
        station_names = [f"Loc_{i}" for i in range(len(lats))]

    # 5. Get global bounds for the color scale
    v_min = float(subset[var].min(skipna=True).values)
    v_max = float(subset[var].max(skipna=True).values)

    # 6. Extract values per frame (Optimized Loop)
    clean_values_over_time = []
    for t in subset.time:
        frame_data = subset[var].sel(time=t).values.flatten()
        # Ensure finite numbers for Plotly WebGL rendering
        clean_frame = [float(x) if np.isfinite(x) else 0.0 for x in frame_data]
        clean_values_over_time.append(clean_frame)

    return jsonify({
        "lats": lats,
        "lons": lons,
        "stations": station_names,
        "time_labels": times.strftime('%Y-%m-%d %H:%M').tolist(),
        "values": clean_values_over_time,
        "v_min": v_min,
        "v_max": v_max
    })


if __name__ == '__main__':
    app.run(debug=True)