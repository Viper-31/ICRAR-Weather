import xarray as xr
import numpy as np
import pandas as pd
import tkinter as tk
from tkinter import ttk

import matplotlib
matplotlib.use("TkAgg")

import matplotlib.pyplot as plt
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg

import cartopy.crs as ccrs
import cartopy.feature as cfeature
from loading_module_custom import get_dataset_path

# ---------------- CONFIG ----------------
input_file = get_dataset_path("preprocessed")
print(f"Input file: {input_file}")
# ----------------------------------------

# =========================
# LOAD DATA
# =========================
ds = xr.open_dataset(input_file)

# Extract time info safely
time_values = ds.time.values
dates = sorted(np.unique(pd.to_datetime(time_values).date))
hours = np.arange(24)

variables = list(ds.data_vars)

lats = ds.lat.values
lons = ds.lon.values

# =========================
# PRECOMPUTE VAR MIN/MAX FOR COLOR SCALE (NEW)
# This ensures consistent and realistic colors
# =========================
var_minmax = {}
for var in variables:
    all_values = ds[var].values
    var_minmax[var] = (np.nanmin(all_values), np.nanmax(all_values))

# =========================
# TKINTER WINDOW
# =========================
root = tk.Tk()
root.title("WA Station Viewer")

# =========================
# STATE VARIABLES
# =========================
selected_var = tk.StringVar(value=variables[0])
selected_date = tk.StringVar(value=str(dates[0]))
selected_hour = tk.IntVar(value=12)

# =========================
# CONTROLS (VERTICAL STACK)
# =========================
controls = ttk.Frame(root)
controls.pack(side=tk.TOP, fill=tk.X, padx=10, pady=10)

# Variable dropdown
ttk.Label(controls, text="Variable").pack(anchor="w")
var_menu = ttk.OptionMenu(
    controls,
    selected_var,
    variables[0],
    *variables
)
var_menu.pack(fill=tk.X, pady=5)

# Date dropdown
ttk.Label(controls, text="Date").pack(anchor="w")
date_menu = ttk.OptionMenu(
    controls,
    selected_date,
    str(dates[0]),
    *[str(d) for d in dates]
)
date_menu.pack(fill=tk.X, pady=5)

# Hour slider
ttk.Label(controls, text="Hour").pack(anchor="w")
hour_slider = ttk.Scale(
    controls,
    from_=0,
    to=23,
    orient="horizontal",
    variable=selected_hour
)
hour_slider.pack(fill=tk.X, pady=5)

# =========================
# MATPLOTLIB FIGURE
# =========================
fig = plt.Figure(figsize=(9, 7))
ax = fig.add_subplot(111, projection=ccrs.PlateCarree())

# =========================
# DRAW MAP ONCE
# =========================
# Compute bounds
lon_min, lon_max = lons.min(), lons.max()
lat_min, lat_max = lats.min(), lats.max()

# Add a small buffer (e.g., 1% of range)
lon_buffer = (lon_max - lon_min) * 0.01
from matplotlib.patches import Rectangle

rect = Rectangle(
    (lon_min, lat_min),
    lon_max - lon_min,
    lat_max - lat_min,
    linewidth=1,
    edgecolor='red',
    facecolor='none',
    transform=ccrs.PlateCarree()
)
ax.add_patch(rect)
lat_buffer = (lat_max - lat_min) * 0.01



ax.set_extent([
    lon_min - lon_buffer,
    lon_max + lon_buffer,
    lat_min - lat_buffer,
    lat_max + lat_buffer
])

ax.add_feature(cfeature.COASTLINE)
ax.add_feature(cfeature.STATES)
ax.add_feature(cfeature.BORDERS, linestyle=":")

canvas = FigureCanvasTkAgg(fig, master=root)
canvas.get_tk_widget().pack(fill=tk.BOTH, expand=True)

# =========================
# INITIAL SCATTER & COLORBAR (NEW)
# =========================
# Add a dictionary for colormaps
var_cmaps = {
    "airTemperature": "coolwarm",
    "apparentAirTemperature": "coolwarm",
    "relativeHumidity": "YlGnBu",
    "dewPoint": "coolwarm",
    "panEvaporation": "YlOrBr",
    "evapotranspiration_shortCrop": "YlOrBr",
    "evapotranspiration_tallCrop": "YlOrBr",
    "richardsonUnits": "viridis",
    "solarExposure": "Oranges",
    "rainfall": "Blues",
    "deltaT": "coolwarm",
    "wetBulb": "coolwarm",
    "frostCondition": "coolwarm",
    "heatCondition": "coolwarm",
    "wind_3m_speed": "plasma",
    "wind_3m_degN": "twilight",
    "wind_10m_speed": "plasma",
    "wind_10m_degN": "twilight"
}

scatter = ax.scatter(
    lons,
    lats,
    c=np.zeros_like(lons),
    cmap=var_cmaps[variables[0]],
    s=30,
    transform=ccrs.PlateCarree()
)
colorbar = fig.colorbar(scatter, ax=ax, shrink=0.75)
colorbar.set_label(variables[0])

# =========================
# UPDATE FUNCTION
# =========================
def update_plot(*args):
    global scatter, colorbar

    var = selected_var.get()
    date = pd.to_datetime(selected_date.get()).date()
    hour = int(selected_hour.get())

    # Find matching time index
    times = pd.to_datetime(ds.time.values)
    mask = (times.date == date) & (times.hour == hour)
    idx = np.where(mask)[0]
    if len(idx) == 0:
        return

    values = ds[var].isel(time=idx[0]).values

    # =========================
    # UPDATE SCATTER DATA & COLORS (NEW)
    # Avoid remove() and ax.clear(), fixes crashes and map flicker
    # =========================
    scatter.set_array(values)

    # Rescale colors
    vmin, vmax = var_minmax[var]  # consistent per variable
    scatter.set_clim(vmin=vmin, vmax=vmax)
    scatter.set_cmap(var_cmaps.get(var, "viridis"))
    # Update colorbar
    colorbar.update_normal(scatter)
    colorbar.set_label(var)

    ax.set_title(f"{var} | {date} @ {hour:02d}:00")
    canvas.draw_idle()

# =========================
# CALLBACKS
# =========================
selected_var.trace_add("write", update_plot)
selected_date.trace_add("write", update_plot)
selected_hour.trace_add("write", update_plot)

# =========================
# INITIAL DRAW
# =========================
update_plot()

root.mainloop()