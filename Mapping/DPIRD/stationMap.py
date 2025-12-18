from geopy.geocoders import Nominatim
from pathlib import Path
import pandas as pd
import cartopy.crs as ccrs
import cartopy.feature as cfeature
import matplotlib.pyplot as plt
from ipywidgets import interact, fixed
import time
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import sys

def names():
    data = """
    ✔ Allanooka: -29.0450975, 115.1002434
    ✔ Amelup: -34.2237086, 118.2203895
    ✔ Babakin: -32.1244393, 118.0219657
    ✔ Badgingarra: -30.3903774, 115.5021644
    ✔ Balingup: -33.7860758, 115.9831595
    ✔ Beacon: -30.4493589, 117.8669328
    ✔ Belka East: -31.7246139, 118.2069046
    ✔ Bencubbin: -30.8112399, 117.8604874
    ✔ Bindi Bindi: -30.630796, 116.3653902
    ✔ Bindoo: -28.49762, 115.24787
    ✔ Bindoon: -31.3854374, 116.096872
    ✔ Binnu West: -27.9770591, 114.3993195
    ✔ Binnu: -28.0420169, 114.6743098
    ✔ Bonnie Rock: -30.536348, 118.3618452
    ✔ Boyanup: -33.4843551, 115.7289103
    ✔ Boyatup: -33.6640687, 123.1057158
    ✔ Bremer Bay: -34.3933927, 119.3766032
    ✔ Brookton: -32.3554555, 117.0484617
    Not found: Broome (Skuthorpe)
    ✔ Buntine West: -29.9860321, 116.5706311
    ✔ Burakin: -30.5261772, 117.1735522
    ✔ Burracoppin South: -31.570636, 118.6202382
    ✔ Canna East: -28.8622654, 115.864988
    ✔ Capel: -33.5192668, 115.6064648
    Not found: Carnamah East
    ✔ Carnarvon 1: -24.883847, 113.6570703
    ✔ Cascade NE: -33.4141125, 121.0206831
    ✔ Cascade NW: -33.4141125, 121.0206831
    ✔ Cascade: -33.4141125, 121.0206831
    ✔ Chapman: -28.2723475, 115.1168412
    ✔ Condingup: -33.7495895, 122.5331776
    ✔ Coomalbidgup: -33.703801, 121.2626955
    ✔ Coorow: -29.9797936, 115.6188032
    ✔ Cordering: -33.4978554, 116.6583236
    Not found: Corrigin East
    ✔ Corrigin: -32.3330288, 117.8760602
    ✔ Cowalellup: -34.074997, 118.5902489
    Not found: Dandaragan East
    ✔ Dardanup 2: -33.4001716, 115.7539647
    ✔ Darkan: -33.3362568, 116.7401489
    ✔ Denmark: -34.9604365, 117.3551157
    ✔ Dinninup: -33.8130173, 116.5474176
    ✔ Donnybrook: -33.5773757, 115.8251293
    ✔ Dragon Rocks: -32.7867762, 119.0072434
    ✔ Dudawa: -29.4087995, 115.683533
    Not found: Dumbleyung GRDC
    ✔ Dumbleyung: -33.218003, 117.9579719
    Error geocoding East Beverley: Service timed out
    ✔ Ejanding: -31.0152205, 117.1127183
    ✔ Eneabba: -29.8184486, 115.27246
    ✔ Eradu 2: -28.6678645, 115.058206
    Not found: Erangy Springs
    ✔ Esperance Downs: -33.6052265, 121.7826878
    ✔ Floreat Park: -31.9367549, 115.7911175
    ✔ Fouracres: -34.2930202, 115.5337456
    ✔ Frankland North: -34.6644887, 116.6863879
    ✔ Frankland: -34.3607322, 117.0801807
    ✔ Gairdner: -34.2242555, 119.0090598
    ✔ Gingin West: -31.3441233, 115.9076557
    ✔ Glen Eagle: -32.2891337, 116.1914463
    Not found: Gnowangerup GRDC
    ✔ Goodlands: -30.0137005, 117.2597566
    ✔ Grass Patch: -33.2278148, 121.7158352
    ✔ Gutha West: -29.0476037, 115.7766806
    ✔ Highbury East: -33.0497898, 117.2875288
    ✔ Holt Rock: -32.67722, 119.41
    ✔ Hyden: -32.4487288, 118.864003
    ✔ Jarrahdale 2: -32.3088174, 116.0066689
    ✔ Jarrahdale: -32.3393559, 116.066177
    ✔ Jerdacuttup: -33.758975, 120.4565998
    ✔ Jerramungup: -34.063153, 119.0758084
    ✔ Jingalup: -33.9846895, 117.0437608
    ✔ Jurien Bay: -30.3040478, 115.0406027
    ✔ Kalannie: -30.3637144, 117.1181239
    ✔ Karridale: -34.2009995, 115.0998491
    Not found: Katanning GRDC
    Not found: Katanning NG In
    Not found: Katanning NG Out
    ✔ Katanning: -33.6908682, 117.5551858
    ✔ Kellerberrin North: -31.4584965, 117.7028113
    ✔ Kellerberrin: -31.6330922, 117.723327
    ✔ Kendenup West: -34.4854224, 117.6228893
    ✔ Kings Park: -31.962203, 115.8326007
    ✔ Kojaneerup South: -34.507242, 118.4235498
    ✔ Kondinin: -32.483992, 119.0247317
    ✔ Koorda: -30.599394, 117.4245204
    ✔ Kulin: -32.766108, 118.2315927
    ✔ Kumarl: -32.7879525, 121.5533369
    ✔ Kununurra: -15.7730916, 128.738839
    ✔ Kweda: -32.322082, 117.3870388
    ✔ Lake King: -33.0870239, 119.6887676
    Not found: Lancelin East
    ✔ Latham: -29.7567707, 116.4460505
    ✔ Lort River: -33.4184472, 121.3688354
    ✔ Magenta: -33.385386, 119.2640435
    Not found: Manjimup HRS
    ✔ Manypeaks: -34.8381265, 118.1708636
    ✔ Margaret River: -33.9531776, 115.0769369
    ✔ Marradong: -32.8629966, 116.4483723
    Not found: Mayanup South
    ✔ McAlinden: -33.6090785, 116.3177108
    ✔ Meckering North: -31.6276745, 116.9921425
    Not found: Merredin NG In
    Not found: Merredin NG Out
    ✔ Merredin: -31.4813329, 118.2779117
    ✔ Milyeannup: -34.1598868, 115.6385869
    ✔ Mingenew NW: -29.19061, 115.4425872
    ✔ Mingenew: -29.143437, 115.4690526
    ✔ Moora NW: -30.6416311, 116.0076376
    ✔ Moora: -30.6416311, 116.0076376
    ✔ Moorine Rock: -31.31267, 119.1268959
    ✔ Morawa: -29.0333305, 116.0267293
    Error geocoding Mount Barker South: Service timed out
    ✔ Mount Barker: -34.6220807, 117.6641727
    ✔ Mount Buraminya: -33.22622, 123.12313
    ✔ Mount Burdett: -33.45763, 122.1435
    Not found: Mount Howick
    Not found: Mount Madden East
    ✔ Mount Ney: -33.3579245, 122.3148642
    ✔ Mount Walker: -32.084641, 118.7537546
    ✔ Mukinbudin: -30.6361807, 118.2949197
    ✔ Mullewa: -28.5390992, 115.514115
    ✔ Munglinup: -33.7045947, 120.8595042
    Not found: Muntadgin East
    ✔ Muresk: -31.7540175, 116.6733056
    ✔ Myalup: -33.1029958, 115.6963151
    Not found: Nannup 2 (Carlotta)
    ✔ Nannup: -33.9784295, 115.7637655
    ✔ Narembeen: -32.0633415, 118.3947639
    ✔ Narrikup: -34.7736521, 117.7014699
    ✔ Narrogin: -32.9341978, 117.1778676
    ✔ New Norcia: -30.9706028, 116.2146638
    ✔ Newdegate: -33.0937156, 119.0221927
    ✔ Newlands: -33.6680536, 115.8765346
    ✔ Northam: -31.6535192, 116.6726927
    ✔ Northampton West: -27.7113895, 114.1647412
    ✔ Northcliffe: -34.6331785, 116.1243645
    Not found: Nyabing GRDC
    ✔ Nyabing: -33.5411971, 118.1486592
    Not found: Ongerup GRDC
    Not found: Ongerup North
    ✔ Pemberton: -34.4441275, 116.0346584
    ✔ Perenjori: -29.378861, 116.4734448
    ✔ Pindar South: -26.9081933, 116.6160804
    ✔ Pingaring: -32.753211, 118.6267362
    ✔ Pingelly West: -32.5575455, 116.9879333
    Not found: Pingrup East
    ✔ Pinjarra: -32.6318966, 115.869247
    ✔ Popanyinning: -32.6602115, 117.1208807
    ✔ Quairading: -32.0057498, 117.4029874
    ✔ Qualeup: -33.8589245, 116.8247854
    Error geocoding Quinninup: Service timed out
    ✔ Ravensthorpe: -33.5813455, 120.0473501
    ✔ Regans Ford: -30.9831524, 115.7013788
    ✔ Ridley North: -33.2206826, 121.8542741
    ✔ Rosa Brook: -33.93881, 115.1943
    Not found: Salmon Gums Quarry Dam
    ✔ Salmon Gums: -32.9815167, 121.6440785
    ✔ Scaddan: -33.4412046, 121.7243116
    ✔ Scott River: -34.2812789, 115.334562
    ✔ Shackleton: -31.9316993, 117.8368271
    ✔ South Perth: -31.9809661, 115.8639433
    ✔ Stirlings North: -34.184567, 118.0309216
    Not found: Stirlings South
    ✔ Tammin: -31.6035545, 117.4776581
    ✔ Three Springs: -29.4913105, 115.6356876
    ✔ Tincurrin: -32.9753958, 117.7729192
    Not found: Tone Bridge
    ✔ Trayning West: -31.1134868, 117.7915799
    ✔ Tunney West: -33.9629525, 122.8132231
    ✔ Vasse: -33.7182754, 115.3602927
    ✔ Wagin: -33.3076055, 117.3453388
    ✔ Wanneroo: -31.6520862, 115.7392787
    Not found: Warradarge East
    ✔ Watheroo: -30.2983438, 116.0611026
    ✔ Wattleup: -32.1677339, 115.8155558
    ✔ Wellstead: -34.4952102, 118.6041245
    ✔ West River: -33.5508245, 119.6327952
    ✔ Westonia: -30.87629, 118.7181366
    ✔ Wickepin East: -32.777604, 117.7131113
    ✔ Wickepin North: -32.674679, 117.4876539
    ✔ Williams: -33.0510365, 116.7865042
    ✔ Wilyabrup: -33.79548, 115.0462
    ✔ Wongan Hills: -30.8916507, 116.718912
    ✔ Wongoondy: -28.840788, 115.4979828
    ✔ Woodanilling: -33.519916, 117.3109567
    ✔ Yanmah: -34.1813875, 116.0066379
    ✔ Yilgarn: -30.9092045, 119.4801889
    ✔ York East: -15.50903, 125.51631
    ✔ Yuna NE: -28.2403505, 115.049205
    Not found: Yuna North
    ✔ Yuna: -28.2403505, 115.049205
    """
    stations = []

    for line in data.splitlines():
        line = line.strip()
        if line.startswith("✔"):
            try:
                check, rest = line.split(" ", 1)
                name, coords = rest.split(":", 1)
                lat, lon = coords.split(",")
                stations.append((name.strip(), lat.strip(), lon.strip()))
            except:
                continue

    # Print in requested format
    for name, lat, lon in stations:
        print(f"({name}) {lat} {lon}")

    # Save to text file
    output_path = "station_coords.txt"

    with open(output_path, "w") as f:
        for name, lat, lon in stations:
            f.write(f"({name}) {lat} {lon}\n")

    print(f"\nSaved {len(stations)} stations to {output_path}")
    
def geocode_dpird_stations(base_dir="../../dataset_DPIRD_utc0/202501/"):
    """
    Reads CSV filenames, extracts station names, geocodes them,
    returns a DataFrame with station, lat, lon.
    """
    not_found = []
    base_dir = Path(base_dir)
    geolocator = Nominatim(user_agent="weather_project")

    if not base_dir.exists():
        raise FileNotFoundError(f"Directory not found: {base_dir}")

    stations = []

    print("Geocoding stations...\n")

    for p in sorted(base_dir.glob("*.csv")):
        name = p.stem  # filename without extension

        query = f"{name}, Western Australia"
        try:
            loc = geolocator.geocode(query)
            time.sleep(1)  # respect API rate limits
        except Exception as e:
            print(f"Error geocoding {name}: {e}")
            not_found.append(name)
            continue

        if loc is None:
            print(f"Not found: {name}")
            not_found.append(name)
            continue

        print(f"✔ {name}: {loc.latitude}, {loc.longitude}")

        stations.append({
            "station": name,
            "lat": loc.latitude,
            "lon": loc.longitude
        })

    df = pd.DataFrame(stations)
    return df, not_found

def plot_station_map(df):
    """
    Takes DataFrame with station, lat, lon and plots them on a map.
    """
    plt.figure(figsize=(10, 8))
    ax = plt.axes(projection=ccrs.PlateCarree())

    # Add features
    ax.add_feature(cfeature.COASTLINE)
    ax.add_feature(cfeature.BORDERS, linestyle=":")
    ax.add_feature(cfeature.LAND, edgecolor='black', alpha=0.3)
    ax.add_feature(cfeature.OCEAN)

    # You may need to change these depending on WA slice
    ax.set_extent([112, 130, -38, -13])

    # Plot the stations
    ax.scatter(
        df["lon"], df["lat"],
        color='red', s=40, transform=ccrs.PlateCarree(),
        label="DPIRD Stations"
    )

    # Add labels
    for _, row in df.iterrows():
        ax.text(
            row["lon"] + 0.1, row["lat"] + 0.1,
            "", 
            fontsize=6,
            transform=ccrs.PlateCarree()
        )

    plt.title("DPIRD Weather Station Locations (Geocoded)")
    plt.legend()
    plt.show()

# --- Constants ---
FILE_PATH = '../../dataset_DPIRD_utc0/202501/Mount Barker.csv'
TEMP_COLUMN = 'airTemperature'

class DailyTempViewer:
    """
    Manages the data, Matplotlib figure, and key press events 
    for navigating daily temperature plots..0
    """
    def __init__(self, file_path, temp_col):
        
        # 1. Load Data
        self.df, self.dates = self._load_and_prepare_data(file_path)
        if self.df is None:
            # Cannot proceed if data loading failed
            sys.exit(1)
            
        self.temp_col = temp_col
        self.date_index = 0 # Start with the first day
        
        # 2. Setup Figure
        self.fig, self.ax = self._setup_plot()
        
        # 3. Initial Plot
        self.line = self._initial_plot()
        
        # 4. Connect Events: Bind the 'key_press_event' to the handler method
        self.fig.canvas.mpl_connect('key_press_event', self.on_key_press)
        
    def _load_and_prepare_data(self, file_path):
        """Loads and prepares data."""
        try:
            df = pd.read_csv(file_path)
            df['time'] = pd.to_datetime(df['time'])
            df.set_index('time', inplace=True)
            df.index = df.index - pd.Timedelta(hours=8)  # Convert UTC to AWST
            # FIX: Correctly extracts unique dates from the numpy array
            dates = sorted(list(set(df.index.date))) 
            return df, dates
        except Exception as e:
            print(f"Error loading data: {e}")
            return None, None

    def _setup_plot(self):
        """Creates the initial Matplotlib figure and axis."""
        fig, ax = plt.subplots(figsize=(12, 6))
        plt.xlabel('Time of Day', fontsize=12)
        plt.ylabel('Air Temperature (°C)', fontsize=12)
        ax.grid(True, linestyle='--', alpha=0.6)
        
        # Set up time formatting once
        formatter = mdates.DateFormatter('%H:%M')
        ax.xaxis.set_major_formatter(formatter)
        
        return fig, ax

    def _initial_plot(self):
        """Creates the plot object for the first day."""
        current_date = self.dates[self.date_index]
        data_for_day = self.df[self.df.index.date == current_date]
        
        line, = self.ax.plot(data_for_day.index, data_for_day[self.temp_col], 
                             color='indianred', marker='o', markersize=3, 
                             linestyle='-', label='Air Temperature')
        self.ax.legend(loc='best')
        self.ax.set_title(f'Air Temperature Diurnal Cycle: {current_date}')
        return line

    def update_plot(self):
        """Updates the plot data based on the current date_index."""
        if not self.dates:
            return
            
        current_date = self.dates[self.date_index]
        data_for_day = self.df[self.df.index.date == current_date]
        
        # Update the existing line data
        self.line.set_data(data_for_day.index, data_for_day[self.temp_col])

        # Auto-scale Y-axis for the new data
        self.ax.relim()
        self.ax.autoscale_view()

        # Update title for current date
        self.ax.set_title(f'Air Temperature Diurnal Cycle: {current_date}')
        
        # Redraw the canvas to show the changes
        self.fig.canvas.draw_idle()

    def on_key_press(self, event):
        """Handles key press events for navigation."""
        if event.key == 'right':
            # Move to the next day, wrapping around to the start if needed
            self.date_index = (self.date_index + 1) % len(self.dates)
            self.update_plot()
        elif event.key == 'left':
            # Move to the previous day, wrapping around to the end if needed
            self.date_index = (self.date_index - 1) % len(self.dates)
            self.update_plot()
        
        print(f"Navigated to: {self.dates[self.date_index]}")
        
    def show(self):
        """Starts the interactive Matplotlib window."""
        # This function starts the Matplotlib event loop
        plt.show()

# --- Main Execution Block ---

if __name__ == "__main__":
    
    # 1. Initialize the viewer object
    viewer = DailyTempViewer(FILE_PATH, TEMP_COLUMN)
    
    # 2. Start the interactive plot
    # NOTE: Run this in a Jupyter Notebook/Lab environment or a Python shell 
    # with a GUI backend (like TkAgg) for the arrow keys to work.
    print("Interactive viewer ready. Click on the plot and use the LEFT/RIGHT arrow keys to navigate.")
    viewer.show()

# if __name__ == "__main__":
#     # names()

#     # 1. Load or geocode
#     # df, not_found = geocode_dpird_stations()

#     # print(not_found)

#     # # Optional: save for reuse
#     # df.to_csv("dpird_station_coords.csv", index=False)
#     # print("\nSaved to dpird_station_coords.csv")



#     # 2. Plot on map
#     # # Load your CSV (update the filename as needed)
#     # df = pd.read_csv("dpird_station_coords.csv")

#     # # Ensure correct column names
#     # df.columns = ["station", "lat", "lon"]

#     # # Convert lat/lon to float just in case
#     # df["lat"] = df["lat"].astype(float)
#     # df["lon"] = df["lon"].astype(float)
#     # plot_station_map(df)



#     #3. Plot single file from DPIRD
#     df_prepared, dates_list = load_and_prepare_data("../../dataset_DPIRD_utc0/202501/Kings Park.csv")
    
#     if df_prepared is not None:
#         run_interactive_viewer(df_prepared, dates_list, "airTemperature")


#okay now lets make a new script for just the dpird stations. 
#now from the filtered csv, go to the original file, extract and append all temperature
#








# from geopy.geocoders import Nominatim
# from pathlib import Path
# import sys


# def list_files():
#     geolocator = Nominatim(user_agent="weather_project")
#     base_dir = Path("../dataset_DPIRD_utc0/202501/")
#     if not base_dir.exists():
#         print(f"Directory not found: {base_dir}")
#         return 1
#     if not base_dir.is_dir():
#         print(f"Not a directory: {base_dir}")
#         return 1

#     files = sorted(base_dir.iterdir())
#     if not files:
#         print(f"No files in {base_dir}")
#         return 0

#     for p in files:
#         name = p.name.strip('.csv')
#         loc = geolocator.geocode(f"{name}, Western Australia")
#         try:
#             if loc is None:
#                 print(f"Location not found for {name}")
#                 continue
#         except Exception as e:
#             print(f"Error geocoding {name}: {e}")
#             continue
#         print(f"{name}: {loc.latitude}, {loc.longitude}")
#     return 0


# if __name__ == '__main__':
#     list_files()
#     print()



