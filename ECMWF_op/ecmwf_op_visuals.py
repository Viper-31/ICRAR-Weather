'''
Cartopy ECMWF operational visualisation
date_widget for file selection. Limited to 2025/01 & 2025/02
'''
# %%
import re
from pathlib import Path
import xarray as xr
import numpy as np
import pandas as pd
import cartopy.crs as ccrs
import matplotlib.pyplot as plt
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
import matplotlib.colors as mcolors
import tkinter as tk
from tkinter import ttk

DATA_ROOT = Path("dataset_ecmwf_op_clean") 

#Cache for optimisation
ds_cache={}
MAX_CACHE_SIZE=2

def available_dates():
    
    files = sorted(list(DATA_ROOT.rglob("forecast.nc")))
    dates=[]

    for f in files:
        try:
            yyyy= f.parts[-4]
            mm= f.parts[-3]
            dd= f.parts[-2]
            dates.append(f"{yyyy}-{mm}-{dd}")
            
        except IndexError:
            continue

    return sorted(list(set(dates)))   

def path_from_date_str(date_str):
    yyyy,mm,dd= date_str.split("-")
    return DATA_ROOT/ yyyy / mm / dd / "forecast.nc"

def load_ds(date_str):
    if date_str in ds_cache:
        return ds_cache[date_str]
    
    if len(ds_cache)>= MAX_CACHE_SIZE:
        oldest_key=next(iter(ds_cache))
        ds_cache[oldest_key].close()
        del ds_cache[oldest_key]
    
    path= path_from_date_str(date_str)
    ds= xr.open_dataset(path, engine="netcdf4", chunks={})
    ds_cache[date_str]=ds
    return ds

def truncated_cmap(minval, maxval= 0.75, name="Greys", n=256):
    base= plt.get_cmap(name,n)
    return mcolors.LinearSegmentedColormap.from_list(
        f"{name}_trunc",base(np.linspace(minval,maxval,n))
    )

#Colourmaps
VAR_CMAPS = {
    "t2m": "coolwarm",
    "d2m": "coolwarm",
    "msl": "Spectral_r",
    "sh2":"GnBu",
    "swvl1":"YlGnBu",
    "cp": "Purples",
    "tp": "Blues",
    "lsp":"GnBu",
    "i10fg": "Reds"
}

PREFIX_CMAPS={
    "z": "copper",
    "t": "coolwarm",
    "r": "YlGnBu",
    "q": "GnBu",
    "w": "RdBu_r",
}

CLOUD_CMAP= truncated_cmap(0, 0.75, "Greys")

def cmap_for(var: str) -> str:
    if var in VAR_CMAPS:
        return VAR_CMAPS[var]
    
    
    for prefix,cmap in PREFIX_CMAPS.items():
        if var.startswith(prefix):
            return cmap
    
    return "viridis"

# Wind grouping helper
def get_display_vars(ds,merge_var=True):
    raw_vars= [v for v in ds.data_vars if "latitude" in ds[v].dims and "longitude" in ds[v].dims]
    if not merge_var:
        return raw_vars
    
    display_list=[]
    processed_vs=set()

    u_vars= [v for v in raw_vars if v.startswith('u')]
    for u in u_vars:
        suffix= u[1:]
        v= 'v'+suffix
        if v in raw_vars:
            display_list.append(f"wind{suffix}")
            processed_vs.add(v)
        else:
            display_list.append(u)

    for v in raw_vars:
        if not v.startswith('u') and v not in processed_vs:
            display_list.append(v)

    return display_list

# ---------------------
# Tkinter App
# ---------------------
class ECMWFViewer(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("ECMWF Cartopy Viewer")
        self.geometry("1400x1000")
        self.cbar = None
        self.is_playing= False

        # --- Top Controls ---
        top_control = ttk.Frame(self)
        top_control.pack(side=tk.TOP, fill=tk.X, padx=5, pady=5)

        label = "Date forecast comes in: "
        ttk.Label(top_control, text=label).pack(side=tk.LEFT)
        self.date_var= tk.StringVar()
        dates= available_dates()
        self.date_cb = ttk.Combobox(
            top_control,
            textvariable=self.date_var,
            values=dates,
            width=12,
            state="readonly"
        )
        self.date_cb.pack(side=tk.LEFT, padx=5)
        self.date_cb.bind("<<ComboboxSelected>>", self.on_date_change)

        # Variable selection
        ttk.Label(top_control, text="Variable").pack(side=tk.LEFT)
        self.var_var = tk.StringVar()
        self.var_cb = ttk.Combobox(top_control, textvariable=self.var_var, width=20)
        self.var_cb.pack(side=tk.LEFT, padx=5)
        self.var_cb.bind("<<ComboboxSelected>>", self.on_var_change)

        # Time slider
        ttk.Label(top_control, text="Forecast reference time:").pack(side=tk.LEFT, padx=(10,0))
        self.time_slider = ttk.Scale(
            top_control, from_=0, to=0, orient=tk.HORIZONTAL, length=150, 
            command=lambda e: self.update_plot()
        )
        self.time_slider.pack(side=tk.LEFT, padx=5)
        self.time_label= ttk.Label(top_control,text= "T=0", width=6)
        self.time_label.pack(side=tk.LEFT)

        # Forecast step slider
        ttk.Label(top_control, text="Forecast step period (+hr): ").pack(side=tk.LEFT,padx=(10,0))
        self.step_slider= ttk.Scale(
            top_control, from_= 0, to=0, orient=tk.HORIZONTAL, length=150,
            command= lambda e:self.update_plot() 
        )
        self.step_slider.pack(side=tk.LEFT, padx=5)
        self.step_label= ttk.Label(top_control,text="S=0", width=8)
        self.step_label.pack(side=tk.LEFT)

        # --- Bottom Controls (Playback)'
        bottom_control = ttk.Frame(self)
        bottom_control.pack(side=tk.BOTTOM, fill=tk.X, padx=10, pady=10)

        # Play Button on the centre of the bottom bar
        self.play_btn = ttk.Button(bottom_control, text="▶ Play", command=self.toggle_play, width=10)
        self.play_btn.pack(side=tk.LEFT, padx=10)

        # --- Figure
        self.fig = plt.Figure(figsize=(12, 9),dpi=100)
        self.ax = self.fig.add_subplot(111, projection=ccrs.PlateCarree())
        self.canvas = FigureCanvasTkAgg(self.fig, master=self)
        self.canvas.get_tk_widget().pack(fill=tk.BOTH, expand=True)

        # Init
        if dates:
            self.date_var.set(dates[0])
            self.on_date_change()
        # Bind keyboard arrows for step navigation    
        self.bind("<Left>", lambda e: self.change_step(-1))
        self.bind("<Right>", lambda e: self.change_step(1))

    # Play button behaviour
    def toggle_play(self):
        self.is_playing = not self.is_playing
        self.play_btn.config(text="■ Stop" if self.is_playing else "▶ Play")
        if self.is_playing:
            self.play_sequence()

    def play_sequence(self):
        if not self.is_playing: 
            return
        curr = float(self.step_slider.get())
        max_val = float(self.step_slider.cget("to"))
        if curr >= max_val:
            self.step_slider.set(0) # Loop back or stop
        else:
            self.step_slider.set(curr + 1)
        
        self.update_plot()
        self.after(350, self.play_sequence) # ~300ms delay for smoothness. Adjust as needed.
    
    #Calculates min/max for current variable across whole file
    def update_limits(self):
        date_str= self.date_var.get()
        var= self.var_var.get()
        if not date_str or not var:return

        ds= load_ds(date_str)

        if var.startswith("wind"):
            suffix= var[4:]
            try:
                u = ds[f"u{suffix}"]
                v= ds[f"v{suffix}"]
                self.vmax= float(np.sqrt(u**2+v**2).max().compute())
                self.vmin=0

            except KeyError:
                self.vmin, self.vmax= 0, 200

        elif var in {"tcc", "lcc", "mcc", "hcc"}:
            self.vmin, self.vmax= 0.0,1.0
        
        else:
            da=ds[var]
            self.vmin=float(da.min().compute())
            self.vmax=float(da.max().compute())

            if self.vmin== self.vmax:
                self.vmax += 1.0
                
    #On var change
    def on_var_change(self, event=None):
        self.update_limits()
        self.update_plot()

    # Date change behaviour
    def on_date_change(self, event=None):
        date_str= self.date_var.get()
        if not date_str: 
            return
        
        try:
            ds = load_ds(date_str)
        except FileNotFoundError:
            print(f"File not found for : {date_str}")
            return

        #Update variable list
        vars_list= get_display_vars(ds)
        self.var_cb["values"] = vars_list

        current_var= self.var_var.get()
        if current_var not in vars_list:
            self.var_var.set("t2m" if "t2m" in vars_list else (vars_list[0] if vars_list else ""))

        #Update sliders
        n_times= ds.sizes.get("time",1)
        self.time_slider.configure(to=n_times-1, value=0)
        
        n_steps= ds.sizes.get("step",1)
        self.step_slider.configure(to=n_steps-1,value=0)
        self.update_limits()
        self.update_plot()

    # Arrow key controls
    def change_step(self, delta):
        current= float(self.step_slider.get())
        max_val= float(self.step_slider.cget("to"))
        new_val= max(0, min(max_val, current+delta))
        self.step_slider.set(new_val)
        self.update_plot()


    # Updating behaviour
    def update_plot(self):
        if self.cbar is not None:
            self.cbar.remove()
            self.cbar= None
        self.ax.clear()

        date_str = self.date_var.get()
        var = self.var_var.get()
        if not date_str or not var: return

        ds = load_ds(date_str)

        #Get valid_time
        t_index= int(round(float(self.time_slider.get())))
        s_index= int(round(float(self.step_slider.get())))

        t_index= min(t_index,ds.sizes["time"]-1)
        s_index= min(s_index,ds.sizes["step"]-1)

        run_time_val = pd.to_datetime(ds.time.values[t_index])
        self.time_label.config(text=f"{run_time_val.hour:02d}Z")

        step_hours= int(ds.step.values[s_index])
        self.step_label.config(text=f"+{step_hours}h")
        try:
            valid_dt= pd.to_datetime(ds.valid_time.isel(time=t_index,step=s_index).values)
        except:
            valid_dt = run_time_val + pd.Timedelta(hours=step_hours)

        '''
        Special case: Wind using quiver. If variable starts with 'u' try finding matching 'v'
        '''
        u_name, v_name = None, None

        if var.startswith("wind"):
            suffix= var[4:]
            u_name, v_name= f"u{suffix}", f"v{suffix}"
        elif var.startswith("u") and not self.merge_var.get():
            potential_v= "v"+var[1:]
            if potential_v in ds:
                u_name, v_name= var, potential_v
       
        if u_name and v_name:
            u = ds[u_name].isel(time=t_index,step=s_index)
            v = ds[v_name].isel(time=t_index,step=s_index)

            unit_str= u.attrs.get("units","GRIB_units")
            speed = np.sqrt(u.values**2 + v.values**2)

            # decimate grid for readability
            step = max(1, u.shape[0] // 30)
            norm= mcolors.Normalize(vmin=self.vmin,vmax=self.vmax)

            q = self.ax.quiver(
            u.longitude[::step],
            u.latitude[::step],
            u.values[::step, ::step],
            v.values[::step, ::step],
            speed[::step, ::step],  # color by speed
            transform=ccrs.PlateCarree(),
            scale=1000,  # adjust as needed for visual sizing
            cmap="plasma",
            pivot="middle",
            norm=norm
            )
            
            self.cbar = self.fig.colorbar(q, ax=self.ax, orientation="vertical", shrink=0.8, pad=0.05)
            self.cbar.set_label(f"Wind speed ({unit_str})",  labelpad=20)
            self.ax.set_title(f"Wind vectors ({u_name}/{v_name})\nForecast reference time: {run_time_val} | Proper time: {valid_dt} (+{step_hours}h)")
            self.ax.coastlines()
            self.canvas.draw_idle()
            return       

        #Scalar var case    
        da= ds[var].isel(time=t_index,step=s_index)
        long_name= da.attrs.get("long_name", var)
        unit_str= da.attrs.get("units","GRIB_units")

        levels= np.linspace(self.vmin,self.vmax,21)
        plot_kwargs = {
            "ax": self.ax,
            "transform": ccrs.PlateCarree(),
            "cmap": cmap_for(var),
            "add_colorbar": False,
            "vmin": self.vmin,
            "vmax":self.vmax,
            "levels": levels,
            "extend": "both"
        }

        # Cloud fraction: fixed range 0–1
        if var in {"tcc", "lcc", "mcc", "hcc"}:
            plot_kwargs["cmap"]= CLOUD_CMAP

        # Plot
        mappable = da.plot.contourf(**plot_kwargs)

        # Add colorbar
        self.cbar = self.fig.colorbar(
            mappable,
            ax=self.ax,
            orientation="vertical",
            shrink=0.8,
            pad=0.05
        )
        self.cbar.set_label(f"{long_name} ({unit_str})", labelpad=20)

        # Styling
        self.ax.coastlines()
        self.ax.set_title(f"{long_name}\nForecast reference time: {run_time_val} | Proper time: {valid_dt} (+{step_hours}h)")
        self.fig.subplots_adjust(left=0.05, right=0.88, top=0.92, bottom=0.05)
        self.canvas.draw_idle()

# ---------------------
# Run
# ---------------------
if __name__ == "__main__":
    app = ECMWFViewer()
    app.mainloop()


# %%
