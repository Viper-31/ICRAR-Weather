"""
This script checks for duplicate entries in station CSV files and removes them, ensuring data consistency.
"""

import pandas as pd
from pathlib import Path

# Folder containing final station CSVs
final_dir = Path("../../2_DPIRD_dup/Final_stations_combined_final/")

# Iterate through each CSV
for csv_file in final_dir.glob("*.csv"):
    df = pd.read_csv(csv_file, parse_dates=["time"])
    
    # Detect duplicates and keep only the first occurrence
    before_count = len(df)
    df_cleaned = df.drop_duplicates(subset=["time"], keep="first")
    after_count = len(df_cleaned)
    
    if before_count != after_count:
        print(f"Removed {before_count - after_count} duplicate rows from {csv_file.name}")
        # Overwrite CSV with cleaned data
        df_cleaned.to_csv(csv_file, index=False)
