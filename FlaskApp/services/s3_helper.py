import s3fs
import yaml
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent 
config_path = BASE_DIR / "app_config.yaml"    

def load_yaml(path):
    with open(path, "r") as f:
        return yaml.safe_load(f)

config= load_yaml(config_path)   
s3_key= config.get('key',{}).get('ACCESS-KEY')
s3_secret= config.get('key',{}).get('SECRET-KEY')
S3_endpoint= "https://projects.pawsey.org.au"
bucket= "weather"

def get_filesystem():
    return s3fs.S3FileSystem(
        key=s3_key,
        secret=s3_secret,
        client_kwargs={"endpoint_url": S3_endpoint}
    )

