"""
This script visualizes ECMWF temperature data on a map. It includes functionality to save grid coordinates to a CSV file.
"""

import xarray as xr
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import matplotlib.dates as mdates
from datetime import timedelta


# ---------------------------------------------------------
# FUNCTION 1 — Save ECMWF grid to CSV
# ---------------------------------------------------------
def save_ecmwf_grid_to_csv(nc_path, outfile="ecmwf_grid_coords.csv"):
    ds = xr.open_dataset(nc_path, engine="h5netcdf")
    lat = ds["latitude"].values
    lon = ds["longitude"].values
    LON, LAT = np.meshgrid(lon, lat)
    flat_lat = LAT.ravel()
    flat_lon = LON.ravel()
    df = pd.DataFrame({
        "name": ["" for _ in range(len(flat_lat))],
        "lat": flat_lat,
        "lon": flat_lon
    })
    df.to_csv(outfile, index=False)
    print(f"Saved {len(df)} grid points → {outfile}")
    return df

# ---------------------------------------------------------
# FUNCTION 2 — Plot grid or variable timestep interactively
# ---------------------------------------------------------
def interactive_plot(nc_path, varname="t2m"):
    ds = xr.open_dataset(nc_path, engine="h5netcdf")
    var = ds[varname]  # e.g., t2m, u10, etc.
    current = 0

    fig, ax = plt.subplots(figsize=(10,8), subplot_kw={'projection': ccrs.PlateCarree()})
    img = ax.pcolormesh(
        ds['longitude'], ds['latitude'], var.isel(valid_time=current),
        cmap='coolwarm', shading='auto'
    )
    ax.set_title(str(ds.valid_time[current].values))
    ax.coastlines()
    plt.colorbar(img, ax=ax, label=varname)
    plt.ion()
    plt.show()

    def on_key(event):
        nonlocal current, img
        if event.key == 'right':
            current = min(current + 1, len(ds.valid_time)-1)
        elif event.key == 'left':
            current = max(current - 1, 0)
        else:
            return
        # Update pcolormesh data
        img.set_array(var.isel(valid_time=current).values.ravel())
        ax.set_title(str(ds.valid_time[current].values))
        fig.canvas.draw_idle()

    fig.canvas.mpl_connect('key_press_event', on_key)
    plt.show(block=True)

# ---------------------------------------------------------
# FUNCTION 3 — Plot stations/grid points from CSV
# ---------------------------------------------------------
def plot_points_from_csv(csv_path):
    df = pd.read_csv(csv_path)
    plt.figure(figsize=(10, 8))
    ax = plt.axes(projection=ccrs.PlateCarree())
    ax.add_feature(cfeature.COASTLINE)
    ax.add_feature(cfeature.BORDERS, linestyle=":")
    ax.add_feature(cfeature.LAND, edgecolor='black', alpha=0.3)
    ax.add_feature(cfeature.OCEAN)
    ax.set_extent([112, 130, -38, -13])  # WA region
    ax.scatter(df["lon"], df["lat"], color='red', s=20, transform=ccrs.PlateCarree())
    plt.title("ECMWF Grid Points / Stations")
    plt.show()

# ---------------------------------------------------------
# MAIN
# ---------------------------------------------------------
if __name__ == "__main__":
    nc_file = "../../1_ECMWF/12/single_data_stream-oper_stepType-instant.nc"

    # Save grid points to CSV
    df_grid = save_ecmwf_grid_to_csv(nc_file, "ecmwf_grid_coords.csv")

    # # Plot grid points on map
    # plot_points_from_csv("ecmwf_grid_coords.csv")

    # # Interactive variable plot (arrow keys)
    # interactive_plot(nc_file, varname="t2m")

    # Print Edges of all points
    print("Lat min/max:", df_grid["lat"].min(), df_grid["lat"].max())
    print("Lon min/max:", df_grid["lon"].min(), df_grid["lon"].max())

