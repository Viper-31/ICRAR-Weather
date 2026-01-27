import argparse
import xarray as xr
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from loading_module_custom import get_dataset_path
from anomaly_detection import (
    detect_anomalies,
    classify_with_solar
)

# ---------------- CLI ----------------
parser = argparse.ArgumentParser()
parser.add_argument(
    "--mode",
    type=int,
    choices=[0, 1],
    default=0,
    help="0 = show all anomalies | 1 = show only explained anomalies"
)
args = parser.parse_args()

# ---------------- LOAD DATA ----------------
input_file = get_dataset_path("preprocessed")
ds = xr.open_dataset(input_file)

var = "airTemperature"
solar_var = "solarExposure"

station_idx = 0
station_name = ds.station.values[station_idx]

temp = ds[var].isel(station=station_idx).values
solar = ds[solar_var].isel(station=station_idx).values
times = pd.to_datetime(ds.time.values)

# ---------------- DETECT & CLASSIFY ANOMALIES ----------------
anomalies = detect_anomalies(temp, times)
explained, unexplained = classify_with_solar(times, solar, anomalies)

if args.mode == 0:
    display_anomalies = anomalies
else:
    display_anomalies = explained

print(f"Mode {args.mode}: showing {len(display_anomalies)} anomalies")

# ---------------- INTERACTIVE PLOT ----------------
plt.ion()
current_idx = [0]

if args.mode == 1:
    fig, (ax_temp, ax_solar) = plt.subplots(
        2, 1, figsize=(15, 8), sharex=True
    )
else:
    fig, ax_temp = plt.subplots(figsize=(15, 5))
    ax_solar = None


def plot_anomaly(idx):
    anomaly_idx = display_anomalies[idx]
    anomaly_time = times[anomaly_idx]

    day_mask = times.date == anomaly_time.date()
    day_times = times[day_mask]

    day_temp = temp[day_mask]
    day_solar = solar[day_mask]

    # ---- TEMPERATURE ----
    ax_temp.clear()
    ax_temp.plot(day_times, day_temp, marker="o", label="Temperature")
    ax_temp.plot(
        anomaly_time,
        temp[anomaly_idx],
        "ro",
        markersize=10,
        label="Anomaly"
    )
    ax_temp.set_ylabel("Temperature")
    ax_temp.legend()
    ax_temp.grid(True)

    # ---- SOLAR (only if explained mode) ----
    if ax_solar is not None:
        ax_solar.clear()
        ax_solar.plot(day_times, day_solar, marker="o", label="Solar Exposure")
        ax_solar.axvline(
            anomaly_time, color="red", linestyle="--", label="Anomaly Time"
        )
        ax_solar.set_ylabel("Solar Exposure")
        ax_solar.legend()
        ax_solar.grid(True)

    fig.suptitle(
        f"{station_name} | {anomaly_time} "
        f"({idx+1}/{len(display_anomalies)})"
    )

    fig.autofmt_xdate()
    plt.draw()


def on_key(event):
    if event.key == "right" and current_idx[0] < len(display_anomalies) - 1:
        current_idx[0] += 1
        plot_anomaly(current_idx[0])
    elif event.key == "left" and current_idx[0] > 0:
        current_idx[0] -= 1
        plot_anomaly(current_idx[0])


fig.canvas.mpl_connect("key_press_event", on_key)

# Initial plot
plot_anomaly(0)
plt.show(block=True)
# ---------------------------------------------------------