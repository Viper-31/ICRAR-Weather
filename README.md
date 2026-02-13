## ICRAR Weather Visualisation Web App

This repository contains a Flask-based web application for exploring near-surface weather observations from DPIRD stations and gridded forecasts from ECMWF over Western Australia. The core of the app lives in the `FlaskApp` directory.

The UI lets you:
- Load DPIRD station data and ECMWF operational forecast data (either from Acacia services or local NetCDF files).
- Visualise DPIRD variables on an interactive Leaflet map with a time slider.
- Plot DPIRD time-series graphs for a selected station.
- Visualise ECMWF scalar and wind fields over WA as either a heatmap or point/arrow layer.
- Overlay DPIRD and ECMWF in a unified "Both (Overlay)" mode with shared date configuration and colourbars.

---


## Running the app

1. Create and activate a Python environment (recommended):

	```bash
	python -m venv .venv
	source .venv/bin/activate  # on macOS/Linux
	```

2. Install dependencies (from the repository root, which contains `requirements.txt`):

	```bash
	pip install -r requirements.txt
	```

3. Start the Flask app from the `FlaskApp` directory:

	```bash
	cd FlaskApp
 	cd services

	# Just create a new file called app_config.yaml either via nano or via a GUI
 
 	nano app_config.yaml # on macOS/Linux

 	```
	Enter the following text in the file: (required for accessing dataset from Acacia)

	```
	 key:
	  ACCESS-KEY: ""
	  SECRET-KEY: ""
 	```

	Run the app!
	```
	python app.py
	```

5. Open the app in a browser:

	- Navigate to http://127.0.0.1:5000/ (or the host/port shown in the terminal).

### Optional: start with preloaded datasets

If suitable test NetCDF files are present under `FlaskApp/uploads/` (for example
`DPIRD_final_stations_utc0.nc` for DPIRD and `02.nc` for ECMWF), you can start
the app with preloaded data so the UI is ready to use immediately:

```bash
cd FlaskApp
python app.py -1
```

When started with `-1`, the backend loads those files at startup and the
front-end initialises its controls from `/initial_state` without any manual
upload or Acacia query.

---

## Typical workflow

Once the app is running:

1. **Load data**
	- Either use the Acacia query controls to load DPIRD and/or ECMWF for a date range, or
	- Upload local DPIRD and ECMWF NetCDF files via the respective upload panels.

2. **Choose a mode** using the "Active Control Panel" switch:
	- **DPIRD** – configure variable, date range, and optionally station; view map or graph.
	- **ECMWF** – choose ECMWF variable, date group, and time/step; view the forecast field over WA.
	- **Both (Overlay)** – use shared date configuration and select DPIRD + ECMWF variables to overlay.

3. **Render**
	- Click the relevant render button (e.g. *Render DPIRD*, *Render ECMWF*, or *Render Both Layers*).
	- Use the DPIRD timeline slider and playback control to scrub through time.
	- In ECMWF and Dual modes, use the ECMWF time/step sliders (and opacity control in Dual) to explore the forecast field.

---

## Notes

- The app focuses on Western Australia by applying spatial masks in the backend.
- For ECMWF wind variables, the backend derives wind speed and direction from u/v components and exposes them as synthetic `windXX` variables.
- DPIRD combined wind (`wind_3m`) is supported in map mode and split into speed/direction components for graph mode.
- The dual overlay mode can use a shared colourbar when DPIRD and ECMWF variables are compatible (e.g. air temperature vs 2 m temperature).
