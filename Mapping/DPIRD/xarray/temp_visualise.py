"""
This script visualizes temperature data from DPIRD stations using xarray and matplotlib. It provides interactive plots for analysis.
"""

import xarray as xr
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.widgets import Slider
from datetime import datetime, timedelta
import calendar
import numpy as np
import matplotlib.dates as mdates

# ---------------- CONFIG ----------------
nc_file = "DPIRD_stations_combined_refined.nc"
station_name = "Allanooka"
var_name = "airTemperature"
window_hours = 24
# ---------------------------------------

# Load data
ds = xr.open_dataset(nc_file)
da = ds[var_name].sel(station=station_name)
ts = da.to_series().dropna().resample("H").mean()

# Extract available years
years = sorted(ts.index.year.unique())
min_year, max_year = years[0], years[-1]

# Initial state
current_year = min_year
current_month = 1
current_day = 1
timezone_offset = 0  # hours

# ----------- PLOT SETUP -----------
fig, ax = plt.subplots(figsize=(12,6))
plt.subplots_adjust(bottom=0.35)

# Initial plot (offset applied later)
line, = ax.plot(ts.index, ts.values, marker='o')

ax.set_ylabel("Temperature (°C)")
ax.set_title(f"Hourly Air Temperature – {station_name}")
ax.grid(True)

ax.xaxis.set_major_formatter(mdates.DateFormatter("%H:%M\n%d %b %Y"))

# ----------- SLIDERS -----------
ax_year  = plt.axes([0.15, 0.25, 0.7, 0.03])
ax_month = plt.axes([0.15, 0.20, 0.7, 0.03])
ax_day   = plt.axes([0.15, 0.15, 0.7, 0.03])
ax_tz    = plt.axes([0.15, 0.10, 0.7, 0.03])

year_slider  = Slider(ax_year,  "Year",  min_year, max_year, valinit=current_year, valstep=1)
month_slider = Slider(ax_month, "Month", 1, 12, valinit=current_month, valstep=1)
day_slider   = Slider(ax_day,   "Day",   1, 31, valinit=current_day, valstep=1)
tz_slider    = Slider(ax_tz, "Timezone Offset (hrs)", -12, 16, valinit=0, valstep=1)

annotations = []  # Store annotation references

# ----------- UPDATE FUNCTION -----------
def update(val):
    year = int(year_slider.val)
    month = int(month_slider.val)
    offset_hours = int(tz_slider.val)

    # Clamp day
    max_day = calendar.monthrange(year, month)[1]
    day = min(int(day_slider.val), max_day)

    if day_slider.val != day:
        day_slider.set_val(day)

    # Base (data) time
    base_start = datetime(year, month, day)
    base_end = base_start + timedelta(hours=window_hours)

    # Apply timezone offset for display
    display_start = base_start + timedelta(hours=offset_hours)
    display_end = base_end + timedelta(hours=offset_hours)

    # Shift x-data (only for display)
    shifted_index = ts.index + timedelta(hours=offset_hours)
    line.set_xdata(shifted_index)

    ax.set_xlim(display_start, display_end)
    
    # --- NEW: ADD ANNOTATIONS ---
    global annotations
    # Remove old annotations
    for ann in annotations:
        ann.remove()
    annotations.clear()

    # Filter data to only what is currently visible to keep it fast
    visible_mask = (shifted_index >= display_start) & (shifted_index <= display_end)
    visible_times = shifted_index[visible_mask]
    visible_values = ts.values[visible_mask]

    for x, y in zip(visible_times, visible_values):
        if not np.isnan(y): # Ensure we don't annotate NaNs
            ann = ax.annotate(
                f'{y:.1f}', 
                (x, y),
                textcoords="offset points", 
                xytext=(0, 10), # 10 points above the dot
                ha='center', 
                fontsize=8,
                color='darkred',
                fontweight='bold'
            )
            annotations.append(ann)
    # ----------------------------

    ax.set_title(f"Hourly Air Temperature – {station_name} (UTC{offset_hours:+d})")
    fig.canvas.draw_idle()

# Connect sliders
year_slider.on_changed(update)
month_slider.on_changed(update)
day_slider.on_changed(update)
tz_slider.on_changed(update)

# Initial draw
update(None)

# ----------- SCROLL HANDLER -----------
def scroll_event(event):
    # Steps
    hours_step = 1
    y_step = 0.5  # °C

    # Get current limits (floats!)
    x_left, x_right = ax.get_xlim()
    y_bottom, y_top = ax.get_ylim()

    # Convert hours → matplotlib date units
    time_step = hours_step / 24.0  # days

    if event.key == 'shift':
        # Vertical scroll (temperature)
        if event.button == 'up':
            ax.set_ylim(y_bottom + y_step, y_top + y_step)
        else:
            ax.set_ylim(y_bottom - y_step, y_top - y_step)
    else:
        # Horizontal scroll (time)
        if event.button == 'up':
            ax.set_xlim(x_left + time_step, x_right + time_step)
        else:
            ax.set_xlim(x_left - time_step, x_right - time_step)

    update(None) 
    fig.canvas.draw_idle()

fig.canvas.mpl_connect('scroll_event', scroll_event)

plt.show()
