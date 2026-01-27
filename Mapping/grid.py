# import numpy as np
# import matplotlib.pyplot as plt
# import cartopy.crs as ccrs
# from shapely.geometry import Polygon
# import geopandas as gpd

# # --- 1. Define Study Area and Resolution ---
# # Bounding Box for a large part of WA (Example values)
# LAT_MIN, LAT_MAX = -36.0, -12.556618  # South to North
# LON_MIN, LON_MAX =111.5, 129.144934  # West to East

# GRID_SIZE_KM = 11.0 # Target side length of each square
# KM_PER_DEGREE = 111.132 # Approximate distance of 1 degree latitude (km)

# # --- 2. Calculate Latitude Step (Constant) ---
# # The Latitude step is fixed since lines of latitude are parallel.
# DELTA_LAT = GRID_SIZE_KM / KM_PER_DEGREE
# LAT_CENTERS = np.arange(LAT_MIN + DELTA_LAT/2, LAT_MAX, DELTA_LAT)

# # --- 3. Generate Dynamic Grid Boundaries ---
# grid_cells = []

# # Loop through each latitude band
# for lat_center in LAT_CENTERS:
#     # 3A. Calculate the unique Longitude Step for this latitude
#     # Longitude distance shrinks by cos(latitude)
#     lat_rad = np.deg2rad(lat_center)
#     lon_dist_per_deg = KM_PER_DEGREE * np.cos(lat_rad)
    
#     # Calculate the required step size in degrees for an 11 km width
#     DELTA_LON_I = GRID_SIZE_KM / lon_dist_per_deg
    
#     # Define the longitude centers for this latitude row
#     lon_centers = np.arange(LON_MIN + DELTA_LON_I/2, LON_MAX, DELTA_LON_I)
    
#     # 3B. Create Polygon Boundaries for each square in this row
#     for lon_center in lon_centers:
#         # Calculate the 4 corners (Lat/Lon) of the grid cell
#         lat_bnds = [lat_center - DELTA_LAT/2, lat_center + DELTA_LAT/2]
#         lon_bnds = [lon_center - DELTA_LON_I/2, lon_center + DELTA_LON_I/2]
        
#         # Create a Shapely Polygon from the four corners
#         # Corners: SW, SE, NE, NW, SW (closing the loop)
#         polygon = Polygon([
#             (lon_bnds[0], lat_bnds[0]), 
#             (lon_bnds[1], lat_bnds[0]), 
#             (lon_bnds[1], lat_bnds[1]), 
#             (lon_bnds[0], lat_bnds[1]),
#             (lon_bnds[0], lat_bnds[0])
#         ])
#         grid_cells.append(polygon)

# # --- 4. Create GeoDataFrame and Plot ---
# # Convert the list of polygons into a GeoDataFrame for easy plotting
# grid_gdf = gpd.GeoDataFrame({'geometry': grid_cells}, crs="EPSG:4326")

# # Setup the plot using Cartopy
# fig = plt.figure(figsize=(10, 12))
# # Use PlateCarree for plotting non-uniform Lat/Lon grids
# ax = fig.add_subplot(1, 1, 1, projection=ccrs.PlateCarree()) 

# # Restrict the plot extent to the WA area
# ax.set_extent([LON_MIN-1, LON_MAX+1, LAT_MIN-1, LAT_MAX+1], crs=ccrs.PlateCarree())

# # Draw the map features
# ax.coastlines(resolution='50m', color='black', linewidth=1.5)
# ax.stock_img() # Add a background image (e.g., land/ocean)
# ax.gridlines(draw_labels=True, dms=True, x_inline=False, y_inline=False, color='gray', linestyle='--')

# # Plot the calculated grid cells
# grid_gdf.plot(ax=ax, facecolor='none', edgecolor='red', linewidth=0.5, alpha=0.6)

# plt.title(f'Dynamic {GRID_SIZE_KM} km Grid over Western Australia (Non-Uniform Lon Step)')
# plt.show()

# print(f"Total number of grid cells (Polygons): {len(grid_gdf)}")













import numpy as np
import matplotlib.pyplot as plt
import cartopy.crs as ccrs
from shapely.geometry import Polygon
import geopandas as gpd
import pandas as pd # <-- New Import

# --- 1. Define Study Area and Resolution ---
# Bounding Box for a large part of WA (Example values)
LAT_MIN, LAT_MAX = -36.0, -12.556618  # South to North
LON_MIN, LON_MAX = 111.5, 129.144934  # West to East

GRID_SIZE_KM = 11.0 # Target side length of each square
KM_PER_DEGREE = 111.132 # Approximate distance of 1 degree latitude (km)

# --- 2. Calculate Latitude Step (Constant) ---
# The Latitude step is fixed since lines of latitude are parallel.
DELTA_LAT = GRID_SIZE_KM / KM_PER_DEGREE
LAT_CENTERS = np.arange(LAT_MIN + DELTA_LAT/2, LAT_MAX, DELTA_LAT)

# --- 3. Generate Dynamic Grid Boundaries ---
grid_cells = []

# Loop through each latitude band
for lat_center in LAT_CENTERS:
    # 3A. Calculate the unique Longitude Step for this latitude
    # Longitude distance shrinks by cos(latitude)
    lat_rad = np.deg2rad(lat_center)
    lon_dist_per_deg = KM_PER_DEGREE * np.cos(lat_rad)
    
    # Calculate the required step size in degrees for an 11 km width
    DELTA_LON_I = GRID_SIZE_KM / lon_dist_per_deg
    
    # Define the longitude centers for this latitude row
    lon_centers = np.arange(LON_MIN + DELTA_LON_I/2, LON_MAX, DELTA_LON_I)
    
    # 3B. Create Polygon Boundaries for each square in this row
    for lon_center in lon_centers:
        # Calculate the 4 corners (Lat/Lon) of the grid cell
        lat_bnds = [lat_center - DELTA_LAT/2, lat_center + DELTA_LAT/2]
        lon_bnds = [lon_center - DELTA_LON_I/2, lon_center + DELTA_LON_I/2]
        
        # Create a Shapely Polygon from the four corners
        # Corners: SW, SE, NE, NW, SW (closing the loop)
        polygon = Polygon([
            (lon_bnds[0], lat_bnds[0]), 
            (lon_bnds[1], lat_bnds[0]), 
            (lon_bnds[1], lat_bnds[1]), 
            (lon_bnds[0], lat_bnds[1]),
            (lon_bnds[0], lat_bnds[0])
        ])
        grid_cells.append(polygon)

# --- 4. Create GeoDataFrame and Plot ---
# Convert the list of polygons into a GeoDataFrame for easy plotting
grid_gdf = gpd.GeoDataFrame({'geometry': grid_cells}, crs="EPSG:4326")

# --- 5. Read Data Extent from CSV and Prepare Plotting ---
file_path = 'ECMWF/ecmwf_grid_coords.csv'

try:
    # Read the data
    df = pd.read_csv(file_path)
    
    # Assume 'lon' and 'lat' are the column names
    # Adjust these column names if your CSV uses different names!
    DATA_LON_MIN = df['lon'].min() 
    DATA_LON_MAX = df['lon'].max()
    DATA_LAT_MIN = df['lat'].min()
    DATA_LAT_MAX = df['lat'].max()
    
except Exception as e:
    print(f"Error reading data or calculating min/max. Using placeholder extent. Error: {e}")
    # --- PLACEHOLDER EXTENT (for plotting logic demonstration) ---
    DATA_LON_MIN, DATA_LON_MAX = 115.0, 125.0
    DATA_LAT_MIN, DATA_LAT_MAX = -30.0, -15.0
    # -------------------------------------------------------------

# Create a Shapely Polygon for the data extent bounding box
data_extent_polygon = Polygon([
    (DATA_LON_MIN, DATA_LAT_MIN), 
    (DATA_LON_MAX, DATA_LAT_MIN), 
    (DATA_LON_MAX, DATA_LAT_MAX), 
    (DATA_LON_MIN, DATA_LAT_MAX),
    (DATA_LON_MIN, DATA_LAT_MIN)
])

# Create a GeoDataFrame for the data extent
extent_gdf = gpd.GeoDataFrame({'geometry': [data_extent_polygon]}, crs="EPSG:4326")

# Setup the plot using Cartopy
fig = plt.figure(figsize=(10, 12))
# Use PlateCarree for plotting non-uniform Lat/Lon grids
ax = fig.add_subplot(1, 1, 1, projection=ccrs.PlateCarree()) 

# Restrict the plot extent to the WA area
ax.set_extent([LON_MIN-1, LON_MAX+1, LAT_MIN-1, LAT_MAX+1], crs=ccrs.PlateCarree())

# Draw the map features
ax.coastlines(resolution='50m', color='black', linewidth=1.5)
ax.stock_img() # Add a background image (e.g., land/ocean)
ax.gridlines(draw_labels=True, dms=True, x_inline=False, y_inline=False, color='gray', linestyle='--')

# Plot the calculated grid cells
grid_gdf.plot(ax=ax, facecolor='none', edgecolor='red', linewidth=0.5, alpha=0.6, label=f'{GRID_SIZE_KM} km Grid')

# Plot the data extent in blue
extent_gdf.plot(ax=ax, facecolor='none', edgecolor='blue', linewidth=2.0, alpha=1.0, linestyle='-', label='Data Extent') # <-- Plotting the extent in blue

# Add a legend
ax.legend(loc='lower left')

plt.title(f'Dynamic {GRID_SIZE_KM} km Grid and Data Extent over Western Australia')

# Use savefig instead of show for non-interactive environments
plt.savefig('dynamic_grid_with_data_extent.png')

print(f"Total number of grid cells (Polygons): {len(grid_gdf)}")
print("Plot saved as 'dynamic_grid_with_data_extent.png'")