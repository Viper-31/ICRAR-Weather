#!/usr/bin/env python3
import zipfile, yaml, shutil
from pathlib import Path

"""
Unzip files inplace on data/ecmwf_untar
Deletes the single.nc which is a .zip

"""
def load_yaml(path):
    with open(path, "r") as f:
        return yaml.safe_load(f)
    
def find_year_month_folders(base_dir):
    """
    Returns list of Path objects for year/month directories containing data.
    Expects structure base_dir/YYYY/MM/
    """
    base = Path(base_dir)
    folders = []
    for year_dir in sorted(base.glob("[0-9][0-9][0-9][0-9]")):
        for month_dir in sorted(year_dir.glob("[0-1][0-9]")):
            if month_dir.is_dir():
                folders.append(month_dir)
    return folders

def handle_file(nc_path, outdir):
    """
    Extract zip_path into outdir.
    Returns list of extracted .nc files.
    """
    file_path = Path(nc_path)
    outdir.mkdir(parents=True, exist_ok=True)

    if zipfile.is_zipfile(file_path):
        print(f" Unzip: {file_path.name}")
        with zipfile.ZipFile(file_path,"r") as z:
            z.extractall(outdir)

    else: 
        dest_path= outdir/file_path.name
        if not dest_path.exists():
            print(f" Copying: {file_path.name}")
            shutil.copy2(file_path,dest_path)
        
        else:
            print(f" Skip {file_path.name} already exists in destination")

def main():
    config = load_yaml("config_ecmwf_unzip.yaml")

    for src in config["sources"]:
        name= src["name"]
        zip_root= Path(src["zip_dir"])
        untar_root= Path(src["out_dir"])
        
        print(f"\n=== Processing source: {name} ===")
        
        folders = find_year_month_folders(zip_root)

        for folder in folders:
            year= folder.parent.name
            month= folder.name
            outdir= untar_root / year / month
            marker= outdir / ".unzipped"

            if marker.exists():
                continue

            all_files= list(folder.glob("*"))

            for file in all_files:
                if file.is_file():
                    handle_file(file,outdir)
            
            marker.touch()

        print("\n All done!")

if __name__ == "__main__":
    main()