import xarray as xr
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
    
    #Cache for loading ds
    @lru_cache(maxsize=3)
    def load_dataset(self,date_str):
        yyyy, mm, dd= date_str.split('-')
        path= f"{self.bucket}/{self.root_path}/{yyyy}/{mm}/{dd}.nc"
        
        return xr.open_dataset(
            self.fs.open(path,'rb'), 
            engine='h5netcdf',
            chunks='auto'
            )

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
        self.file_path = "clean_DPIRD/DPIRD_final_stations.nc"
    
    def load_dataset(self):
        path = f"{self.bucket}/{self.file_path}"
        return xr.open_dataset(self.fs.open(path, 'rb'), engine='h5netcdf', chunks='auto')
        
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





