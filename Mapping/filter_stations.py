import pandas as pd
import matplotlib.pyplot as plt
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from matplotlib.patches import Rectangle

# Load CSVs
ecmwf_df = pd.read_csv("ECMWF/ecmwf_grid_coords.csv")   # columns: name, lat, lon
dpird_df = pd.read_csv("DPIRD/dpird_station_coords.csv")      # columns: name, lat, lon

# Compute bounding box of ECMWF grid
lat_min, lat_max = ecmwf_df["lat"].min(), ecmwf_df["lat"].max()
lon_min, lon_max = ecmwf_df["lon"].min(), ecmwf_df["lon"].max()

# Filter DPIRD points inside ECMWF bounding box
dpird_filtered = dpird_df[
    (dpird_df["lat"] >= lat_min) & (dpird_df["lat"] <= lat_max) &
    (dpird_df["lon"] >= lon_min) & (dpird_df["lon"] <= lon_max)
]

print(f"Total DPIRD stations: {len(dpird_df)}")
print(f"DPIRD stations inside ECMWF grid: {len(dpird_filtered)}")

# --- Plot side by side ---
fig, axs = plt.subplots(1, 2, figsize=(15, 7), subplot_kw={'projection': ccrs.PlateCarree()})

for ax, data, title in zip(
    axs, 
    [dpird_df, dpird_filtered], 
    ["All DPIRD Stations", "DPIRD Stations inside ECMWF Grid"]
):
    ax.add_feature(cfeature.COASTLINE)
    ax.add_feature(cfeature.BORDERS, linestyle=":")
    ax.add_feature(cfeature.LAND, edgecolor='black', alpha=0.3)
    ax.add_feature(cfeature.OCEAN)
    ax.set_extent([112, 130, -38, -13])
    ax.scatter(data["lon"], data["lat"], color='red', s=30, transform=ccrs.PlateCarree())
    ax.set_title(title)

# Draw ECMWF bounding box on the "All DPIRD Stations" plot
rect = Rectangle(
    (lon_min, lat_min),  # bottom-left corner
    lon_max - lon_min,   # width
    lat_max - lat_min,   # height
    linewidth=2, edgecolor='blue', facecolor='none',
    transform=ccrs.PlateCarree()
)
axs[0].add_patch(rect)

plt.show()
# Save filtered DPIRD stations to a new CSV
dpird_filtered.to_csv("dpird_stations_filtered.csv", index=False)
print("Filtered DPIRD stations saved to 'dpird_stations_filtered.csv'")
