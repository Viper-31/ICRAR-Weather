import xarray as xr
import matplotlib.pyplot as plt
import cartopy.crs as ccrs

# Open dataset
ds = xr.open_dataset("2024/12/data_stream-oper_stepType-instant.nc", engine="h5netcdf")
t2m = ds['t2m']  # (valid_time, lat, lon)

# Start at first timestep
current = 0

# Create figure and axis
fig, ax = plt.subplots(figsize=(8,6), subplot_kw={'projection': ccrs.PlateCarree()})

# Plot first timestep with pcolormesh
img = ax.pcolormesh(
    ds['longitude'], ds['latitude'], t2m.isel(valid_time=current),
    cmap='coolwarm', shading='auto'
)
ax.set_title(str(ds.valid_time[current].values))
ax.coastlines()
plt.colorbar(img, ax=ax, label='Temperature (K)')
plt.ion()
plt.show()

# Key press handler
def on_key(event):
    global current, img
    if event.key == 'right':
        current = min(current + 1, len(ds.valid_time)-1)
    elif event.key == 'left':
        current = max(current - 1, 0)
    else:
        return

    # Update the existing image data
    img.set_array(t2m.isel(valid_time=current).values.ravel())
    ax.set_title(str(ds.valid_time[current].values))
    fig.canvas.draw_idle()  # redraw the figure

# Connect key press
fig.canvas.mpl_connect('key_press_event', on_key)

plt.show(block=True)