import yaml
from pathlib import Path

def load_config():
    """
    Load YAML config relative to project root (where utils.py lives).
    """
    config_path = Path(__file__).parent / "../config.yaml"
    with open(config_path, "r") as f:
        return yaml.safe_load(f)

def get_dataset_path(key="base"):
    """
    Returns the resolved path for a dataset type.
    key: 'base', 'combined', or 'processed'
    """
    config = load_config()
    if key not in config["datasets"]:
        raise ValueError(f"Dataset key '{key}' not found in config.")
    path = Path(config["datasets"][key]).resolve()
    return path

def get_timezone():
    """
    Returns the timezone string from config.
    """
    config = load_config()
    return config.get("timezone")

def get_year_range():
    """
    Returns the year range from config.
    """
    config = load_config()
    return range(config.get("range")[0], config.get("range")[1])

def get_file_extension():
    """
    Returns the file extension from config.
    """
    config = load_config()
    return config.get("file_extension")