import xarray as xr
import matplotlib.pyplot as plt
import cartopy.crs as ccrs

# Open dataset
ds = xr.open_dataset("2024/12/single_data_stream-oper_stepType-accum.nc", engine="h5netcdf")
print(ds)
print("-"*160)

# Open dataset
ds = xr.open_dataset("2024/12/single_data_stream-oper_stepType-instant.nc", engine="h5netcdf")
tcc = ds['tcc']  # (valid_time, lat, lon)

print(ds)
print("-"*160)
print(ds['tcc'].min(), ds['tcc'].max())
print("-"*160)
print(ds.isnull().sum())


# Start at first timestep
current = 0

# Create figure and axis
fig, ax = plt.subplots(figsize=(8,6), subplot_kw={'projection': ccrs.PlateCarree()})

# Plot first timestep with pcolormesh
img = ax.pcolormesh(
    ds['longitude'], ds['latitude'], tcc.isel(valid_time=current),
    cmap='coolwarm', shading='auto'
)
ax.set_title(str(ds.valid_time[current].values))
ax.coastlines()
plt.colorbar(img, ax=ax, label='Total Cloud Cover')
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
    img.set_array(tcc.isel(valid_time=current).values.ravel())
    ax.set_title(str(ds.valid_time[current].values))
    fig.canvas.draw_idle()  # redraw the figure

# Connect key press
fig.canvas.mpl_connect('key_press_event', on_key)

plt.show(block=True)