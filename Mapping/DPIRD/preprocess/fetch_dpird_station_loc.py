"""
This script fetches station locations from the DPIRD API and saves them to a CSV file. It uses an API key for authentication.
"""

import requests
import csv

API_KEY = ""
STATION_FILE = "dpird_stations.txt"
OUTPUT_CSV = "dpird_station_locations.csv"

# Endpoint to fetch all stations
ALL_STATIONS_URL = "https://api.agric.wa.gov.au/v2/weather/stations"  # check DPIRD docs if different

headers = {
    "api-key": API_KEY,
    "Accept": "application/json"
}

def read_station_names(filename):
    """Read station names from file."""
    with open(filename, "r") as f:
        return [line.strip().lower() for line in f if line.strip()]

def fetch_all_stations():
    """Fetch all DPIRD stations from API."""
    response = requests.get(ALL_STATIONS_URL, headers=headers)
    if response.status_code == 200:
        return response.json().get("data", [])
    else:
        print(f"❌ Failed to fetch all stations: HTTP {response.status_code}")
        return []

def match_stations(names_list, all_stations):
    """Match station names to API stations."""
    matched = []
    for name in names_list:
        for station in all_stations:
            if station.get("stationName", "").lower() == name:
                matched.append(station)
                break
        else:
            print(f"⚠️ Station '{name}' not found in API list")
    return matched

def save_to_csv(station_data_list):
    if not station_data_list:
        print("❌ No stations matched to write.")
        return
    fieldnames = sorted(station_data_list[0].keys())
    with open(OUTPUT_CSV, "w", newline="") as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(station_data_list)
    print(f"✅ Saved matched stations to {OUTPUT_CSV}")

def main():
    names = read_station_names(STATION_FILE)
    all_stations = fetch_all_stations()
    matched_stations = match_stations(names, all_stations)
    save_to_csv(matched_stations)

if __name__ == "__main__":
    main()
