"""
This script preprocesses DPIRD station data by organizing, cleaning, and converting it into a consistent format for analysis.
"""

from pathlib import Path
import os
import gzip
import pandas as pd
import pytz
from loading_module_custom.utils import get_dataset_path, get_timezone, get_year_range, get_file_extension

# ------------------ preprocess functions ------------------ #
def get_file_names(dir, resolution='m', file_extension='.csv'):
    file_dirs = []

    if(resolution == 'm'):
        # go thru each sub dir and get all files
        for sub_dir in dir.iterdir():
            if sub_dir.is_dir():
                file_dirs.extend(list(sub_dir.glob(f"*{file_extension}")))

    elif(resolution == 'o'):
        file_dirs = list(dir.glob(f"*{file_extension}"))
        
    return file_dirs

def filter_non_DPIRD(station_list, dpird_stations, final_dir, file_extension):
    #open DPIRD stations file
    coords_df = pd.read_csv(dpird_stations)

    #delete non-DPIRD stations
    for station in station_list:
        if station not in coords_df['name'].values:
            print("checking if station file exists to delete:", station)
            print(f"Will delete {station}{file_extension} file")
            # a = input("Press Enter to continue...")
            #delete station file
            os.remove(f"{final_dir}/{station}{file_extension}")

def uncompress_file(folder_path):
    # if file extension is .gz, uncompress it
    for file in os.listdir(folder_path):
        if file.endswith('.gz'):
            file_path = os.path.join(folder_path, file)
            with gzip.open(file_path, 'rb') as f_in:
                with open(file_path[:-3], 'wb') as f_out:
                    f_out.write(f_in.read())
            print(f"Uncompressed: {file_path[:-3]}")
            print(f"will remove the {file_path} file now")
            a = input("Press Enter to continue...")

            os.remove(file_path)  # remove the .gz file after uncompressing

    return True

def check_and_remove_duplicates():
    for csv_file in Path(FINAL_DIR).glob("*.csv"):
        df = pd.read_csv(csv_file, parse_dates=["time"])
    
        # Detect duplicates and keep only the first occurrence
        before_count = len(df)
        df_cleaned = df.drop_duplicates(subset=["time"], keep="first")
        after_count = len(df_cleaned)
        
        if before_count != after_count:
            print(f"Removed {before_count - after_count} duplicate rows from {csv_file.name}")
            # Overwrite CSV with cleaned data
            df_cleaned.to_csv(csv_file, index=False)


# ------------------ Main processing and cleaning ------------------ #
def consolidate_monthly_data(month_dirs, year):
    output_dir = Path(BASE_DIR) / f"{year}_combined"
    output_dir.mkdir(exist_ok=True)

    # collect all station file names
    station_names = set()
    for month in month_dirs:
        for file in month.glob("*.csv"):
            station_names.add(file.name)

    print(f"Found {len(station_names)} stations for {year}.")

    for station_file in sorted(station_names):
        print(f"Combining {station_file}...")

        combined_df = None
        first = True

        for month in month_dirs:
            file_path = month / station_file
            if not file_path.exists():
                continue

            try:
                if first:
                    # FIRST file → read normally
                    df = pd.read_csv(file_path, low_memory=False)
                    combined_df = df
                    first = False

                else:
                    # REST → skip header row manually
                    df = pd.read_csv(file_path, low_memory=False, skiprows=1, header=None)

                    # Set proper column names (same as first file)
                    df.columns = combined_df.columns

                    combined_df = pd.concat([combined_df, df], ignore_index=True)

            except Exception as e:
                print(f"  ❌ Error reading {file_path}: {e}")

        if combined_df is not None:
            out_path = output_dir / station_file
            combined_df.to_csv(out_path, index=False)
            print(f"  ✔ Saved: {out_path}")

    print(f"\n✔ Finished combining all stations for {year}.")

def get_monthly_dirs(base_path, year):
    """
    Identifies and returns sorted paths for monthly folders.
    """
    # Use glob to find all directories that match '2021' followed by two digits
    monthly_dirs = sorted([
        p for p in base_path.glob(f"{year}[0-1][0-9]") if p.is_dir()
    ])

    return monthly_dirs

def combine_all_years_to_final(base_dir):
    # Where final combined files will go
    final_dir = base_dir / "Final_stations_combined_final"
    final_dir.mkdir(exist_ok=True)

    # detect all YEAR_combined folders
    year_dirs = sorted([d for d in base_dir.iterdir() if d.is_dir() and d.name.endswith("_combined")])
    print("Found yearly directories:", year_dirs)

    # Collect all station filenames across years
    station_files = {}
    for ydir in year_dirs:
        for csv in ydir.glob("*.csv"):
            station_files.setdefault(csv.name, []).append(csv)

    # Combine each station’s files
    for station_name, file_list in station_files.items():
        print(f"Combining {station_name} from {len(file_list)} yearly files...")
        
        # Sort by year to keep chronological order (2021 → 2024)
        file_list = sorted(file_list, key=lambda p: int(p.parent.name.split("_")[0]))

        frames = []
        for i, file_path in enumerate(file_list):
            try:
                if i == 0:
                    df = pd.read_csv(file_path)         # keep header for first file
                else:
                    df = pd.read_csv(file_path, header=0)  # read normally, but we drop header manually
                frames.append(df)
            except Exception as e:
                print(f"❌ Failed reading {file_path}: {e}")

        # Merge
        combined = pd.concat(frames, ignore_index=True)

        # Save
        out_path = final_dir / station_name
        combined.to_csv(out_path, index=False)

    print("\n🎉 FINAL STATION COMBINATION COMPLETE!")
    print(f"Output saved to: {final_dir}")

def shift_time_and_convert(final_dir, perth_tz):
    csv_files = list(final_dir.glob("*.csv"))
    print(f"Found {len(csv_files)} station files.")

    for csv_file in csv_files:
        print(f"Processing {csv_file.name}...")

        try:
            # Read CSV
            df = pd.read_csv(csv_file, low_memory=False)

            if "time" not in df.columns:
                print(f"⚠ No 'time' column in {csv_file.name}, skipping.")
                continue

            # Parse with timezone awareness
            df["time"] = pd.to_datetime(df["time"], utc=True)

            # Convert timezone to Perth (UTC+08)
            df["time"] = df["time"].dt.tz_convert(perth_tz)

            # Shift timestamps +16 hours
            df["time"] = df["time"] + pd.Timedelta(hours=16)

            # Save back
            df.to_csv(csv_file, index=False)

        except Exception as e:
            print(f"❌ Error processing {csv_file.name}: {e}")

    print("\n✔ All timestamps shifted +8 hours and converted to Australia/Perth timezone.")

if __name__ == "__main__":
    # ------------------ Load Config ------------------ #
    base_dir = get_dataset_path("base")
    final_dir = get_dataset_path("final")
    perth_tz = get_timezone()
    years = get_year_range()
    dpird_stations = get_dataset_path("dpird_station_list")
    file_extension = get_file_extension()
    print("Loading dataset from:", base_dir)


    # ------------------ Uncompress any .gz files ----------------- #
    print("Starting uncompression of .gz files if any...")
    year = Path(base_dir) / "202112/"
    print(f"Uncompressing files in {year}...")
    a = input()
    uncompress_file(year)  
    print("Uncompression complete.\n")

    # ------------------ Consolidate monthly data into yearly data ----------------- #
    print("Starting consolidation of monthly data for years...")
    years = range(2021, 2025)
    for year in years:
        print(f"\nProcessing year: {year}")
        month_dirs = get_monthly_dirs(base_dir, year)
        print(month_dirs)
        consolidate_monthly_data(month_dirs, year)

    # # ------------------ Consolidate yearly data into final data ----------------- #
    print("Starting consolidation of yearly data into final data...")
    combine_all_years_to_final(base_dir)

    # ------------------ Get list of station files ------------------ #
    print("Getting list of station files in test directory...")
    print(final_dir)
    a = input("Press Enter to continue...")
    station_list = sorted(get_file_names(final_dir, resolution='o', file_extension=file_extension))

    # ------------------ Cleaning DPIRD stations ------------------ #
    print("Starting filtering of non-DPIRD stations...")
    for i in range(len(station_list)):
        # print(str(station_list[i]).split('/')[-1].split(file_extension)[0])
        station_list[i] = str(station_list[i]).split('/')[-1].split(file_extension)[0]
    # print(station_list)

    filtered = filter_non_DPIRD(station_list, dpird_stations, final_dir, file_extension)
    print("Filtered non-DPIRD stations.")
    print()

    # ------------------ Shift Time ----------------- #
    print("Starting time shifting and timezone conversion...")
    shift_time_and_convert(final_dir, perth_tz)

    # ------------------ Check Duplicates ----------------- #
    print("Starting duplicate entry check and removal...")
    check_and_remove_duplicates()

    print("Duplicate check and removal complete.")

    # ------------------ All Done ----------------- #
    print("\n************************ ALL PREPROCESSING COMPLETE *************************")
    print("\nAll preprocessing complete!")
    print(f"Cleaned data available at: {final_dir}")
    print("Head over to 'build_xarray.py' to create xarray dataset from cleaned station CSV files.")