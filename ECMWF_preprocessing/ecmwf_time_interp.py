# ---------------------
# PCHIP method applied to the following: 
# t2m, d2m (temps) smooth transition
# sp (surface pressure)
# q* (specific humidity), r* (relative humidity) 
# The monotonicity (increasing or decreasing trend) of the data is preserved, ensuring no overshoots between data points
# Ref: https://matthodges.com/posts/2024-08-08-spline-pchip/

# Linear method on:
# u10, v10 wind components
# Humidity should not suddenly curve without physical context. PCHIP might cause unintended vector rotation for wind
# 
# The following variables will have forward fill applied (preserve 1hr time interval):
# tcc, lcc, mcc, hcc (cloud covers)
# # w* (Vertical velocity)
#
# Precipitation will have uniform redistribution
# tp, cp, lsp (precipitation)
# 15_min_precip= hourly_precip/4
# ---------------------
import xarray as xr
import numpy as np
import pandas as pd
import yaml, sys
from pathlib import Path
from scipy.interpolate import PchipInterpolator


"""
Ignore metadata like expver, number
"""
def drop_unimportant_coords(ds):
    return ds.drop_vars(
        ["expver","number"],
        errors="ignore"
    )

"""
File processing over YYYY/YYYYMM.nc files 
"""
def process_month(current_file, next_file, cfg):
#Process single monthly file using a buffer from next month
    input_base= Path(cfg["input_base"])
    output_base= Path(cfg["output_base"])
    pchip_vars= cfg.get("PCHIP_VARS",[])
    linear_vars= cfg.get("LINEAR_VARS",[])
    precip_vars= cfg.get("PRECIP_VARS",[])
    time_dim= "valid_time"

    try:
        rel_path = current_file.relative_to(input_base)
    except ValueError:
        rel_path= current_file.name
    outfile = output_base / rel_path

    if outfile.exists():
        print(f"Skipping existing {rel_path}")

    print(f"Interpolating {rel_path}")

    #Load whole month and first step of next month
    ds_curr = drop_unimportant_coords(xr.open_dataset(current_file).load())
    
    if next_file:
        ds_next = drop_unimportant_coords(xr.open_dataset(next_file).isel({time_dim: [0]}).load())
        ds = xr.concat([ds_curr, ds_next], dim=time_dim)
    else:
        ds = ds_curr

    #Define 15-min grid for this month only. Hourly data ends at 23:00. 
    t_start = pd.to_datetime(ds_curr[time_dim].values[0])
    t_end = pd.to_datetime(ds_curr[time_dim].values[-1]) + pd.Timedelta(minutes=45)
    new_time = pd.date_range(start=t_start, end=t_end, freq="15min")

    out_vars={}
    old_time_f = ds[time_dim].values.astype("datetime64[s]").astype(float)
    new_time_f = new_time.values.astype("datetime64[s]").astype(float)

    for var in ds.data_vars:
        original_attrs= ds_curr[var].attrs

        if var in pchip_vars:
            f= PchipInterpolator(old_time_f,ds[var].values,axis=0) #axis=0 should interp over valid_time at index 0
            interp_data= f(new_time_f)
            da= xr.DataArray(
                interp_data.astype(ds[var].dtype),
                dims=(time_dim,'latitude','longitude'),
                attrs= original_attrs
            ) #Manual [var].attrs needs to be done, not handled by keep_attrs=True
            
            out_vars[var]=da
        
        elif var in linear_vars:
            out_vars[var]= ds[var].interp({time_dim:new_time},method="linear")
        
        elif var in precip_vars:
            precip_div= ds[var]/4.0
            out_vars[var]= precip_div.reindex({time_dim:new_time},method="ffill")

        #Else ffill re-index from 1hr to 15mins
        else:
            out_vars[var]= ds[var].reindex({time_dim:new_time}, method="ffill")
        
    #Saving ouput
    ds_out= xr.Dataset(
        data_vars=out_vars,
        coords={
            time_dim: new_time,
            'latitude': ds_curr.latitude,
            'longitude': ds_curr.longitude
        },
        attrs= ds_curr.attrs
    )

    outfile.parent.mkdir(parents=True,exist_ok=True)
    ds_out.to_netcdf(outfile, engine="netcdf4")

    print(f"Sucessfully saved to {outfile}")

    ds_curr.close() 
    if next_file: ds_next.close()
"""
Main
"""
def main():
    if len(sys.argv) < 2:
        print("Usage: python ecmwf_time_interp.py <config.yaml> [YEAR]")
        sys.exit(1)

    with open(sys.argv[1], "r") as f:
        cfg = yaml.safe_load(f)

    input_base = Path(cfg["input_base"])
    # Sort monthly .nc files them to ensure "next month" logic works
    all_files = sorted(list(input_base.rglob("*.nc")))
    
    if len(sys.argv) == 3:
        target_year = sys.argv[2]
        print(f"Filtering for year: {target_year}")
        # Filter files for the target year, but keep one file before/after for buffers
        process_list = [f for f in all_files if target_year in f.parent.name or target_year in f.name]
    else:
        process_list = all_files

    print(f"Found {len(all_files)} files. Starting interpolation...")

    xr.set_options(keep_attrs=True)
    for current_file in process_list:
        # Determine if there is a next file to use as a buffer, even if in next YYYY folder
        try:
            idx = all_files.index(current_file)
            next_file = all_files[idx+1] if (idx + 1) < len(all_files) else None
            process_month(current_file, next_file, cfg)
        except Exception as e:
            print(f"Error processing {current_file.name}: {e}")

    print("\nInterpolation Complete.")

if __name__ == "__main__":
    main()