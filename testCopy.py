import s3fs
import xarray as xr

fs = s3fs.S3FileSystem(
    key="",
    secret="",
    client_kwargs={
        "endpoint_url": "https://projects.pawsey.org.au"
    }
)

# Replace 'weather' with your actual bucket name
bucket = "weather/tmp_ecmwf_clean/2024/12/"
all_files = fs.ls(bucket)
print("Files / prefixes in bucket:")
for f in all_files:
    print(f)



local_path = "/Users/arnavdangmali/MainFolder/University/Projects/ICRAR-Weather-Forcasting/testCopy/20241231.nc"
remote_path = "weather/tmp_ecmwf_clean/2024/12/20241231.nc"

with fs.open(remote_path, "rb") as f:
    print("Downloading file...")
    with open(local_path, "wb") as g:
        g.write(f.read())

print("Done.")



############ just for printing dataset info ############
# import s3fs
# import xarray as xr

# fs = s3fs.S3FileSystem(
#     key="",
#     secret="",
#     client_kwargs={
#         "endpoint_url": "https://projects.pawsey.org.au"
#     }
# )

# remote_path = "weather/tmp_ecmwf_clean/2024/12/20241231.nc"

# # Open the file directly from Acacia
# with fs.open(remote_path, "rb") as f:
#     print("tf")
#     ds = xr.open_dataset(f)

# # Print basic info
# print("==== Dataset Info ====")
# print(ds)

# # Print all variable names
# print("\nVariables:")
# for var in ds.data_vars:
#     print(f"- {var}")


# # Print time range if there is a time coordinate
# if "time" in ds.coords:
#     times = ds.time.values
#     print("\nTime range:")
#     print(times.min(), "to", times.max())
