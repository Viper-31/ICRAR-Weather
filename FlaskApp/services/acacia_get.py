import xarray as xr
import pandas as pd
import numpy as np
from functools import lru_cache
from .s3_helper import get_filesystem, bucket

"""ECMWF data getter from acacia"""
class ECMWFOperationalService:
    def __init__(self):
        self.fs= get_filesystem()
        self.bucket=bucket
        self.root_path= "ecmwf_op_clean"
        self.cache={}
    
    #Scan bucket for YYYY/MM/DD.nc files
    @lru_cache(maxsize=10)
    def available_dates(self):
        files= self.fs.glob(f"{self.bucket}/{self.root_path}/*/*/*.nc")
        dates =[]
        for f in files:
            parts= f.split('/')
            try:
                yyyy= parts[-3]
                mm= parts[-2]
                dd_nc= parts[-1]
                dd= dd_nc.replace('.nc','')
                dates.append(f"{yyyy}-{mm}-{dd}")
            except IndexError:
                continue
        return sorted(set(dates))
    
    def load_dataset(self,date_str):
        yyyy, mm, dd= date_str.split('-')
        path= f"{self.bucket}/{self.root_path}/{yyyy}/{mm}/{dd}.nc"
        
        return xr.open_dataset(
            self.fs.open(path,'rb'), 
            engine='h5netcdf',
            chunks={"time": 7}
            )

    """Load and concatenate ECMWF datasets for a date range."""
    def load_date_range(self, start_date_str, end_date_str):
        start_date = pd.to_datetime(start_date_str)
        end_date = pd.to_datetime(end_date_str)
        
        available = self.available_dates()
        if not available:
            raise ValueError("No ECMWF data available on Acacia")
        
        datasets_to_merge = []
        loaded_dates = []
        
        for date_str in available:
            file_date = pd.to_datetime(date_str)
            file_end_date = file_date + pd.Timedelta(days=7)

            if file_date <= end_date and file_end_date >= start_date:
                try:
                    ds_day = self.load_dataset(date_str)
                    datasets_to_merge.append(ds_day)
                    loaded_dates.append(date_str)
                except Exception as e:
                    print(f"Warning: Could not load ECMWF data for {date_str}: {e}")
                    continue
        
        if not datasets_to_merge:
            raise ValueError(
                f"No ECMWF data found for date range {start_date_str} to {end_date_str}. "
                f"Available dates: {', '.join(available[:5])}" +
                ("..." if len(available) > 5 else "")
            )
        
        merged_ds = xr.concat(
            datasets_to_merge, 
            dim='time',
            coords='minimal',    
            compat='no_conflicts',  # Allow overlapping times, keep first occurrence
            combine_attrs='override'  # Merge global attrs
        )
        merged_ds = merged_ds.sortby('time')
        _, unique_indices = np.unique(merged_ds['time'].values, return_index=True)
        merged_ds = merged_ds.isel(time=sorted(unique_indices))

        try:
            merged_ds = merged_ds.sel(time=slice(start_date_str, end_date_str))
        except Exception:
            pass

        # Log summary
        print(f"✓ Loaded {len(loaded_dates)} file(s) covering {start_date_str} to {end_date_str}")
        print(f"  └─ Files: {', '.join(loaded_dates)}")
        print(f"  └─ Result: {len(merged_ds.time)} forecast times × {len(merged_ds.step)} steps")
        
        return merged_ds

    #Group wind var (u*,v*) for ecmwf_display vars    
    def get_display_vars(self,ds,merge_wind=True):
        raw_vars= [v for v in ds.data_vars 
                   if "latitude" in ds[v].dims and "longitude" in ds[v].dims]
        
        if not merge_wind:
            return raw_vars
        
        display_list=[]
        processed= set()

        u_vars= [v for v in raw_vars if v.startswith('u')]
        for u in u_vars:
            suffix = u[1:]
            v = 'v' + suffix
            if v in raw_vars:
                display_list.append(f"wind{suffix}")
                processed.update([u, v])

        for v in raw_vars:
            if not v.startswith('u') and v not in processed:
                display_list.append(v)

        return display_list

"""DPIRD data getter"""
class DPIRDService:
    def __init__(self):
        self.fs = get_filesystem()
        self.bucket = bucket
        self.file_path = "FINAL_DPIRD/DPIRD_final_stations.nc"
    
    def load_dataset(self):
        path = f"{self.bucket}/{self.file_path}"
        return xr.open_dataset(
            self.fs.open(path, 'rb'), 
            engine='h5netcdf', 
            chunks={"time": 4096},
            decode_times=False,  
            decode_cf=False
        )
        
    # Get display variables, merging wind components
    def get_display_vars(self, ds):
        raw_vars = [v for v in ds.data_vars]
        display_list = []
        
        # Handle wind_3m as combined variable
        if 'wind_3m_speed' in raw_vars and 'wind_3m_degN' in raw_vars:
            display_list.append('wind_3m')
        
        # Add other variables except wind components
        for v in raw_vars:
            if v not in ['wind_3m_speed', 'wind_3m_degN']:
                display_list.append(v)
        
        return display_list





