import numpy as np
import pandas as pd

# ================= CONFIG =================
DT_HOURS = 0.25          # 15-minute data
ROLLING_WINDOW = 5       # ~75 minutes
MEDIAN_Z = 3.0
SLOPE_Z = 4.0
MIN_SLOPE = 0.2          # °C/hour
SOLAR_Z = 2.5
SOLAR_WINDOW = 4
# =========================================


def assign_temp_zones(times):
    """
    Define expected temperature behaviour zones:
    +1 = rising
    -1 = falling
     0 = flat / weak expectation
    """
    hours = times.hour + times.minute / 60
    zones = np.zeros(len(times), dtype=int)

    zones[(hours >= 6) & (hours < 12)] = 1
    zones[(hours >= 16) & (hours < 21)] = -1
    zones[(hours >= 12) & (hours < 16)] = 0
    zones[(hours >= 21) | (hours < 6)] = 0

    return zones


def detect_anomalies(values, times):
    """
    Hybrid temperature anomaly detector using:
    - rolling median deviation
    - slope acceleration
    - diurnal physics zones
    """

    series = pd.Series(values)

    # ---------- Rolling median deviation ----------
    rolling_med = series.rolling(
        ROLLING_WINDOW, center=True
    ).median()

    dev = np.abs(series - rolling_med)
    dev = dev.dropna()   # <-- ADD THIS

    if len(dev) == 0:
        return np.array([])

    med_thresh = dev.mean() + MEDIAN_Z * dev.std()

    median_anoms = np.where(dev > med_thresh)[0]

    # ---------- Slope acceleration ----------
    slope = np.diff(values) / DT_HOURS
    slope_change = np.abs(np.diff(slope))

    slope_thresh = (
        slope_change.mean() + SLOPE_Z * slope_change.std()
    )
    slope_anoms = np.where(slope_change > slope_thresh)[0] + 1

    # ---------- Diurnal zone check ----------
    zones = assign_temp_zones(times)
    zone_anoms = []

    for i in range(1, len(values)):
        if zones[i] == 0:
            continue

        if abs(slope[i - 1]) < MIN_SLOPE:
            continue

        if np.sign(slope[i - 1]) != zones[i]:
            zone_anoms.append(i)

    anomalies = np.unique(
        np.concatenate([median_anoms, slope_anoms, zone_anoms])
    )

    return anomalies


def classify_with_solar(times, solar_values, anomalies):
    explained = []
    unexplained = []

    solar_series = pd.Series(solar_values)

    for idx in anomalies:
        start = max(0, idx - SOLAR_WINDOW)
        end = min(len(solar_series), idx + SOLAR_WINDOW + 1)

        local = solar_series.iloc[start:end].dropna()

        if len(local) < 3:
            unexplained.append(idx)
            continue

        baseline = local.median()
        deviation = abs(solar_series.iloc[idx] - baseline)

        std = local.std()
        if std == 0 or np.isnan(std):
            unexplained.append(idx)
            continue

        threshold = SOLAR_Z * std

        if deviation > threshold:
            explained.append(idx)
        else:
            unexplained.append(idx)

    return np.array(explained), np.array(unexplained)
