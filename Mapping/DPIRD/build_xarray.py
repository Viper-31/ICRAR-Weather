"""
This script builds an xarray dataset from station CSV files. It reads station metadata and combines data into a structured xarray format for further analysis.
"""

import pandas as pd
import xarray as xr
from pathlib import Path

def build_xarray_from_stations(final_dir, station_metadata):
    """
    final_dir        -> Path to Final_stations_combined directory
    station_metadata -> dict: { "Station Name": {"lat": ..., "lon": ...} }
    """
    final_dir = Path(final_dir)

    datasets = []

    for csv_file in final_dir.glob("*.csv"):
        station_name = csv_file.stem

        print(f"Loading station: {station_name}")

        df = pd.read_csv(csv_file, parse_dates=["time"])
        # If the time column is tz-aware
        if df["time"].dt.tz is not None:
            df["time"] = df["time"].dt.tz_convert(None)  # remove tz info for xarray

        df = df.sort_values("time")
        ds = xr.Dataset.from_dataframe(df.set_index("time"))

        # Add station dimension
        ds = ds.expand_dims(station=[station_name])

        # Add station metadata attributes
        if station_name in station_metadata:
            for key, val in station_metadata[station_name].items():
                ds.attrs[key] = val

        datasets.append(ds)

    # Merge all into one big dataset
    final_ds = xr.concat(datasets, dim="station")

    return final_ds


if __name__ == "__main__":
    final_dir = "../../2_DPIRD_dup/Final_stations_combined_final/"

    # Read station coordinates CSV
    # Expected format: name,lat,lon
    coords_csv = Path("dpird_station_coords.csv")
    coords_df = pd.read_csv(coords_csv)

    # Build metadata dictionary
    station_metadata = {}
    for _, row in coords_df.iterrows():
        station_metadata[row['station']] = {
            'lat': row['lat'],
            'lon': row['lon']
        }

    # Build xarray dataset
    ds = build_xarray_from_stations(final_dir, station_metadata)

    # Save to NetCDF
    output_path = Path(final_dir) / "DPIRD_stations_combined.nc"
    ds.to_netcdf(output_path)

    print(f"Combined xarray dataset saved to {output_path}")