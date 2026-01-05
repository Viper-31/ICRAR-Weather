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
        datasets.append(ds)

    # Merge all into one big dataset
    final_ds = xr.concat(datasets, dim="station")

    stations = final_ds.station.values

    final_ds = final_ds.assign_coords(
        lat=("station", [station_metadata[s]["lat"] for s in stations]),
        lon=("station", [station_metadata[s]["lon"] for s in stations]),
        code=("station", [station_metadata[s]["code"] for s in stations]),
    )

    final_ds.attrs.update({
        "time_zone": "UTC+08:00",
        "time_standard": "local_time",
        "comment": (
            "All timestamps are local time in UTC+08:00 (Australia/Perth). "
            "Timezone offset was removed from datetime values for NetCDF compatibility."
        ),
    })

    return final_ds


if __name__ == "__main__":
    final_dir = "../../../2_DPIRD_dup/Final_stations_combined_final/"
    # Read station coordinates CSV
    # Expected format: name,lat,lon
    coords_csv = Path("all_station_coordinates.csv")
    coords_df = pd.read_csv(coords_csv)

    # Build metadata dictionary
    station_metadata = {
        row["name"]: {
            "lat": row["lat"],
            "lon": row["lon"],
            "code": row["code"],
        }
        for _, row in coords_df.iterrows()
    }

    # Build xarray dataset
    ds = build_xarray_from_stations(final_dir, station_metadata)

    # Save to NetCDF
    output_path = Path(final_dir) / "DPIRD_stations_combined.nc"
    ds.to_netcdf(output_path)

    print(f"Combined xarray dataset saved to {output_path}")