#!/usr/bin/env python3
"""
preprocess_ecmwf_clean.py

Clean ECMWF Operational (Forecast) preprocessing:
 - loads datasets from YYYY/MM/DD structure
 - converts 'step' (timedelta) from ns to h
 - flattens pressure-level vars ['t','z','q','w','u',v']
 - merges pressure and single level files per forecast run
 - converts units based on groups defined in config
 - saves INDIVIDUAL forecast runs preserving YYYY/MM/DD structure
 - configurable variable selection via YAML

"""

import os, sys, yaml, re
from pathlib import Path
import numpy as np
import xarray as xr
from concurrent.futures import ProcessPoolExecutor

# ----------------------------
# Load config
# ----------------------------
def load_yaml(path):
    with open(path, "r") as f:
        return yaml.safe_load(f)

"""
Returns list of Path objects for DD(week) directories containing data.
Expects structure base_dir/YYYY/MM/DD
"""
def find_forecast_folders(base_dir):
    base = Path(base_dir)
    folders = []
    for year_dir in sorted(base.glob("[0-9][0-9][0-9][0-9]")):
        if not year_dir.is_dir(): continue
        for month_dir in sorted(year_dir.glob("[0-1][0-9]")):
            if not month_dir.is_dir(): continue
            for day_dir in sorted(month_dir.glob("[0-3][0-9]")):
                if day_dir.is_dir():
                    folders.append(day_dir)
    return folders

"""
    Flatten pressure-level variables into single-level variables.

    Example:
      t(time, step, isobaricInhPa, latitude, longitude ->
      t1000(time, step, lat, lon), t850(...), t500(...), t250
"""
def extract_pressure_levels(ds): 
    if "isobaricInhPa" not in ds.dims:
        return xr.Dataset()
    
    level_targets= ds["isobaricInhPa"].values.astype(int)
    pressure_vars= [v for v in ds.data_vars if "isobaricInhPa" in ds[v].dims]

    if not pressure_vars:
        return xr.Dataset()
    
    new_vars={}
    for var in pressure_vars:
        for target in level_targets:
            name= f"{var}{target}"
            new_vars[name]= (
                ds[var].sel(isobaricInhPa=target)
                .drop_vars("isobaricInhPa",errors='ignore')
                .reset_coords(drop=True)
            )
            
    return xr.Dataset(new_vars)

"""
Convert step (timedelta) ns to hours
"""
def convert_step_to_hours(ds):
    if 'step' in ds.coords:
        ds['step'] = ds['step'].astype('timedelta64[ns]').astype(float) / 3600e9
    return ds

"""
Drop un-necessary coords
"""
def drop_unimportant_coords(ds, to_drop= ["expver","surface", "depthBelowLandLayer"]):
    return ds.drop_vars(to_drop,errors="ignore")

"""
Unit conversion based on YAML config
"""
def apply_unit_conversions(ds,config):
    ds = ds.copy()
    conv_cfg=config.get("unit_conversions",{})

    def is_target(name,var_list):
        if name in var_list: return True
        for base in var_list:
            if re.match(f"^{base}\d+$",name):
                return True
        return False
    
    #Conversion mapping
    conversions=[
        ("temp_vars",lambda x: x - 273.15, "C"),
        ("pressure_vars",lambda x: x / 100.0, "hPa"),
        ("wind_vars",lambda x: x * 3.6, "km/h"),
        ("precip_vars",lambda x: x * 1000.0, "mm")
    ]
    
    for cfg_key, math_op, unit_str in conversions:
        targets= conv_cfg.get(cfg_key,[])
        for var in ds.data_vars:
            if is_target(var,targets):
                ds[var]=math_op(ds[var])
                ds[var].attrs["units"]= unit_str
                ds[var].attrs["GRIB_units"]= unit_str

    return ds

"""
Select variables present in var_list from ds.
Warn if requested variable missing.
"""
def select_variables(ds, var_list):
    present = [v for v in var_list if v in ds]
    missing = [v for v in var_list if v not in ds]
    
    if missing:
        print(f"  Missing vars skipped {missing}")
    if not present:
        raise ValueError("No requested variables are present in dataset after merge.")
    return ds[present]
     
"""
Replace GRIB missing values (e.g 3.4e38) with np.nan for all variables
"""
def replace_grib_missing_with_nan(ds,file_label='file'):
    ds = ds.copy()
    total_replaced = 0

    for var in ds.data_vars:
        da = ds[var]

        if "GRIB_missingValue" in da.attrs:
            mv = da.attrs["GRIB_missingValue"]

            # Boolean mask of missing values
            mask = np.isclose(da, mv)
            n_bad = int(mask.sum())

            if n_bad > 0:
                ds[var] = da.where(~mask)
                total_replaced+= n_bad

    if total_replaced>0:
        print(f" [{file_label}] Replaced {total_replaced} GRIB missing values with NaN.")
    return ds

def save_forecast_nc(ds,original_dd_folder,config):
    day= original_dd_folder.name
    month= original_dd_folder.parent.name
    year= original_dd_folder.parent.parent.name

    out_base= Path(config["processed_data_dir"]) / config["destination_folder"]
    out_dir= out_base / year / month / day
    out_dir.mkdir(parents=True,exist_ok=True)

    outfile= out_dir/"forecast.nc"
    encoding= {var: {'zlib':True, 'complevel': 4} for var in ds.data_vars} #Compression at level 4 sweet-spot
    ds.to_netcdf(outfile, engine='netcdf4', encoding=encoding)


"""
Merges pressure and single GRIB datasets
Returning 1 single merged dataset with matching coords (time,step,latitude,longitude)
"""
def process_forecast_folder(dd_folder,config):
    dd_folder= Path(dd_folder)
    print(f" \n Processing Run:{dd_folder}")

    path_label= "/".join(dd_folder.parts[-3:])
    files=list(dd_folder.glob("*.grib"))

    pressure_file= next((f for f in files if "pressure" in f.name.lower()), None)
    single_file= next((f for f in files if "single" in f.name.lower()), None)

    if not pressure_file or not single_file:
        print(f"Skipped {path_label}: Missing files")
        return
    
    try:
        with xr.open_dataset(pressure_file,engine='cfgrib',backend_kwargs={'indexpath': ''}) as ds_raw_pres:
            ds_pres= replace_grib_missing_with_nan(ds_raw_pres,file_label=f"{path_label}/pressure.grib")
            ds_pl= extract_pressure_levels(ds_pres)
            ds_pl.load()

        with xr.open_dataset(single_file,engine="cfgrib",backend_kwargs={'indexpath': ''}) as ds_raw_sing:
            ds_sing= replace_grib_missing_with_nan(ds_raw_sing,file_label=f"{path_label}/single.grib")
            ds_sing.load()        

        ds_sing, ds_pl= xr.align(ds_sing, ds_pl, join='inner')
        ds= xr.merge([ds_sing,ds_pl],compat='override')

        ds= convert_step_to_hours(ds)
        ds= apply_unit_conversions(ds, config)

        ds= drop_unimportant_coords(ds)

        ecmwf_cfg= config["sources"]["ecmwf"]
        present_vars= [v for v in ecmwf_cfg["vars"] if v in ds]
        ds= ds[present_vars]

        save_forecast_nc(ds,dd_folder,config)

        del ds,ds_pl,ds_sing
        return f"Completed: {path_label}"

    except Exception as e:
        print(f"Error in {path_label}: {e}")
        return

# ----------------------------
# Main
# ----------------------------
def main():
    if len(sys.argv)<2:
        print("Usage: python ecmwf_op_clean.py <config_ecmwf_op_clean.yaml>")
        sys.exit(1)

    config = load_yaml(sys.argv[1])
    if not config.get("preprocess", False):
        print("Preprocess set to false in config.")
        return

    base_dir= config["untar_ecmwf_dir"]
    forecast_folders= find_forecast_folders(base_dir)

    if not forecast_folders:
        print(f"No YYYY/MM/DD folders found under {base_dir}")
        return
    
    print(f"Found {len(forecast_folders)} forecast runs. Starting parallel processing ...")

    workers = config.get("max_workers")

    with ProcessPoolExecutor(max_workers=workers) as executor:
        results = list(executor.map(process_forecast_folder, forecast_folders, [config]*len(forecast_folders)))
    
    for result in results:
        print(result)

    print("\n ECMWF Operational preprocessing complete")
# ----------------------------
# CLI
# ----------------------------
if __name__ == "__main__":
    main()

   