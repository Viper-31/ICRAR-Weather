"""
This script combines station data from multiple year folders into a single dataset. It processes and organizes data for final analysis.
"""

import pandas as pd
from pathlib import Path
import os
import sys
import glob

# --- Constants ---
# Base directory where combined year folders are located.
BASE_DIR = '../../2_DPIRD_dup/' 
# Expected number of station files in each monthly folder.
# EXPECTED_STATION_COUNT = 192 
# The year range you want to process
# YEARS_TO_PROCESS = range(2022, 2025) # Processes 2021, 2022, 2023, 2024

# Target directory for the final combined files.
final_dir_name = 'final' 

BASE_DIR = Path("../../2_DPIRD_dup")
YEAR_FOLDERS = ["2021_combined", "2022_combined", "2023_combined", "2024_combined"]

OUTPUT_DIR = BASE_DIR / "all_years_combined"
OUTPUT_DIR.mkdir(exist_ok=True)

def get_year_combined_dirs(base_path):
    """
    Identifies and returns sorted paths for the 'yyyy_combined' folders 
    within the specified year range.
    """
    valid_dirs = []
    
    for year in YEARS_TO_PROCESS:
        dir_name = f"{year}_combined"
        p = base_path / dir_name
        if p.is_dir():
            valid_dirs.append(p)
            
    print(f"Found year combined directories: {[d.name for d in valid_dirs]}")
    return valid_dirs

def consolidate_yearly_data(year_dirs, output_path):
    """
    Combines data from all station files across the yearly combined directories.
    FIX: Uses skiprows=1 for all files after the first one to correctly ignore the header.
    """
    if not year_dirs:
        print("No valid year combined directories found. Exiting.")
        return

    # 1. Map all station names to their list of file paths (across all years)
    station_files_map = {}
    
    for year_dir in year_dirs:
        station_files = sorted(list(year_dir.glob("*.csv")))
        
        print(f"--- Including {year_dir.name} ({len(station_files)} files). ---")
        
        for file_path in station_files:
            station_name = file_path.stem
            if station_name not in station_files_map:
                station_files_map[station_name] = []
            station_files_map[station_name].append(file_path)

    # 2. Process and combine files for each unique station
    output_path.mkdir(parents=True, exist_ok=True)
    total_stations_processed = 0
    
    print("\nStarting consolidation per station...")

    for station_name, file_paths in station_files_map.items():
        
        # Ensure file paths are sorted chronologically by parent directory name (year)
        file_paths.sort(key=lambda p: p.parent.name) 
        
        station_data_list = []
        
        for i, file_path in enumerate(file_paths):
            
            # --- FIX: Dynamic skiprows and header parameters ---
            if i == 0:
                # First file: Read header from the first row (row 0)
                header_param = 0
                skiprows_param = 0 # No rows skipped
            else:
                # Subsequent files: Skip the header row (row 0), and set no header (header=None)
                header_param = None
                skiprows_param = 1 
            
            try:
                # Read the CSV using the dynamic parameters
                df = pd.read_csv(
                    file_path, 
                    header=header_param, 
                    skiprows=skiprows_param,  # <--- This is the key change
                    low_memory=False
                )
                
                # If skipping the header (i>0), we must manually assign columns
                if i > 0 and station_data_list:
                    # Use columns from the very first file loaded
                    df.columns = station_data_list[0].columns
                elif i > 0 and not station_data_list:
                    # Safety check: If the chronologically first file failed, we can't determine columns.
                    print(f"Warning: Cannot determine columns for {station_name} in {file_path.name}. Skipping file.")
                    continue
                
                station_data_list.append(df)
                
            except Exception as e:
                print(f"Error reading file {file_path.name} for station {station_name}: {e}. Skipping.")
                continue

        if station_data_list:
            # Concatenate all data for this station
            combined_df = pd.concat(station_data_list, ignore_index=True)
            
            # Save the final consolidated file
            output_file = output_path / f"{station_name}.csv"
            combined_df.to_csv(output_file, index=False)
            
            total_stations_processed += 1
            print(f"✔ Saved {station_name} data to {output_file}. Rows: {len(combined_df)}")

    print(f"\n--- Consolidation Complete ---")
    print(f"Successfully processed and saved {total_stations_processed} unique stations.")


def get_2024_monthly_dirs(base_path):
    """
    Identifies and returns sorted paths for 2024 monthly folders (202401-202412).
    """
    # Use glob to find all directories that match '2024' followed by two digits
    print(list(base_path.glob(f"202[1-4]_combined")))
    monthly_dirs = sorted([
        p for p in base_path.glob(f"202[1-4]_combined") if p.is_dir()
    ])
    print(monthly_dirs)

    return monthly_dirs

def consolidate_monthly_data(monthly_dirs, output_path):
    """
    Combines data from all station files across the 2024 monthly directories.
    """
    if not monthly_dirs:
        print("No valid 2024 monthly directories found. Exiting.")
        return

    # 1. Map all station names to their list of file paths (across all months)
    # { 'Kings Park': [Path(202401/Kings Park.csv), Path(202402/Kings Park.csv), ...] }
    station_files_map = {}
    
    for month_dir in monthly_dirs:
        # Check if the folder meets the 192 station requirement
        station_files = sorted(list(month_dir.glob("*.csv")))
        
        # if len(station_files) != EXPECTED_STATION_COUNT:
        #     print(f"--- IGNORING {month_dir.name}: Found {len(station_files)} files, expected {EXPECTED_STATION_COUNT}. ---")
        #     continue
        
        print(f"--- Including {month_dir.name} ({len(station_files)} files). ---")
        
        for file_path in station_files:
            station_name = file_path.stem
            if station_name not in station_files_map:
                station_files_map[station_name] = []
            station_files_map[station_name].append(file_path)

    # 2. Process and combine files for each unique station
    
    # Create the output directory if it doesn't exist
    output_path.mkdir(parents=True, exist_ok=True)
    
    total_stations_processed = 0
    
    print("\nStarting consolidation per station...")

    for station_name, file_paths in station_files_map.items():
        # Ensure files are in chronological order (guaranteed by sorted() earlier)
        
        # List to hold monthly dataframes for the current station
        station_data_list = []
        
        for i, file_path in enumerate(file_paths):
            # i=0 is the first file, which should include the header
            skip_header = False if i == 0 else True 
            
            try:
                # Read the CSV. The header is only read from the first file (i=0).
                df = pd.read_csv(file_path, header=0 if not skip_header else None)
                
                # If skipping the header, we need to re-assign column names 
                # based on the assumption that all files have the same columns.
                if skip_header and station_data_list:
                    # Use columns from the first file loaded
                    df.columns = station_data_list[0].columns
                elif skip_header and not station_data_list:
                    # Edge case: If the very first file for this station was skipped due to an error,
                    # but subsequent files are loaded, we can't reliably assign columns.
                    # We'll skip this file to maintain data integrity.
                    print(f"Warning: Cannot determine columns for {station_name} in {file_path.name}. Skipping file.")
                    continue
                
                station_data_list.append(df)
                
            except Exception as e:
                print(f"Error reading file {file_path.name} for station {station_name}: {e}. Skipping.")
                continue

        if station_data_list:
            # Concatenate all monthly data for this station
            combined_df = pd.concat(station_data_list, ignore_index=True)
            
            # Save the final consolidated file
            output_file = output_path / f"{station_name}.csv"
            combined_df.to_csv(output_file, index=False)
            
            total_stations_processed += 1
            print(f"✔ Saved {station_name} data to {output_file}. Rows: {len(combined_df)}")

    print(f"\n--- Consolidation Complete ---")
    print(f"Successfully processed and saved {total_stations_processed} unique stations.")



# def get_station_names(final_dir_path):
#     """
#     Retrieves a sorted list of unique station names from the CSV files 
#     in the specified base directory.
#     """
#     station_names = []
    
#     for csv_file in final_dir_path.glob("*.csv"):
#         station_names.append(csv_file)
        
#     return sorted(station_names)

# def consolidate_final_data(final_dirs, output_path):
    """
    Combines data from all station files across the 2024 monthly directories.
    """
    if not final_dirs:
        print("No valid 2024 monthly directories found. Exiting.")
        return

    # 1. Map all station names to their list of file paths (across all months)
    # { 'Kings Park': [Path(202401/Kings Park.csv), Path(202402/Kings Park.csv), ...] }
    print(len(final_dirs))
    station_files_map = {}
    
    for name in final_dirs:
        station_files = sorted(list(name.glob("*.csv")))
        
        print(f"--- Including {name.name} ({len(station_files)} files). ---")
        
        for file_path in station_files:
            station_name = file_path.stem
            if station_name not in station_files_map:
                station_files_map[station_name] = []
            station_files_map[station_name].append(file_path)
    print(len(station_files_map))

def final_combine(final_dir, output_path):
    print(final_dir)
    station_files = sorted(list(final_dir.glob("*.csv")))
    # print(station_files)
    warning_files = []

    for i in range(len(station_files)):
        skip_header = False if i == 0 else True 
        try:
            # Read the CSV. The header is only read from the first file (i=0).
            df = pd.read_csv(station_files[i], header=0 if not skip_header else None)
        except Warning as w:
            warning_files.append(station_files[i].name)
            print(f"Warning reading file {station_files[i].name}: {w}")
            continue

        print(station_files[i].stem, len(df))

def remove_unnecessary(dir, station_list):
    for file in dir.glob("*.csv"):
        if file.stem not in station_list:
            os.remove(file)
            print(f"Removed {file.name}")

def combine_across_years():

    # --- Step 1: Collect all station names ---
    station_files = set()

    for year in YEAR_FOLDERS:
        year_path = BASE_DIR / year
        year_stations = [f.name for f in year_path.glob("*.csv")]
        station_files.update(year_stations)

    print(f"Found {len(station_files)} stations across all years.")

    # --- Step 2: Combine each station across years ---
    for station_file in sorted(station_files):
        dfs = []

        for year in YEAR_FOLDERS:
            file_path = BASE_DIR / year / station_file

            if file_path.exists():
                try:
                    df = pd.read_csv(file_path, low_memory=False)
                    df["year"] = year.replace("_combined", "")  # optional
                    dfs.append(df)
                except Exception as e:
                    print(f"Failed reading {file_path}: {e}")

        if dfs:
            combined_df = pd.concat(dfs, ignore_index=True)

            out_path = OUTPUT_DIR / station_file
            combined_df.to_csv(out_path, index=False)

            print(f"✔ Combined: {station_file} → {out_path}")

    print("\nAll stations combined across years.")


if __name__ == "__main__":
    
    base_path = Path(BASE_DIR)
    output_path = base_path / final_dir_name


    if not base_path.is_dir():
        print(f"Fatal Error: Base directory '{BASE_DIR}' not found or is not a directory.")
        sys.exit(1)
        
    # 1. Find and consolidate all relevant 2024 folders
    # monthly_dirs = get_2024_monthly_dirs(base_path)
    # consolidate_monthly_data(monthly_dirs, output_path)

    # 2. Find and consolidate all yearly combined folders
    # print("Processing yearly combined directories...")
    # year_dirs = get_year_combined_dirs(base_path)
    # consolidate_yearly_data(year_dirs, output_path)

    # 3. Offset timezone from UTC+0 to UTC+8


    # 3. Find and consolidate all combined folders in the final DIR
    # final_combine(output_path, output_path)
    # names = get_station_names(output_path)
    # print(names)

    # consolidate_final_data(names, "")
    # print("Removing unnecessary stations...")
    # print(output_path)
    # remove_unnecessary(output_path, "DPIRD_stations_only.txt")

    combine_across_years()
