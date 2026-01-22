import math
from typing import Dict, Iterable, List, Tuple

from pyproj import Transformer
from shapely.geometry import Point, Polygon

HULL_EXCLUDE_STATIONS = {"Broome (Skuthorpe)", "Kununurra"}

_TO_METERS = Transformer.from_crs("EPSG:4326", "EPSG:3577", always_xy=True)
_TO_LATLON = Transformer.from_crs("EPSG:3577", "EPSG:4326", always_xy=True)


def _is_valid_point(point: Dict[str, float]) -> bool:
    lat = point.get("lat")
    lon = point.get("lon")
    return isinstance(lat, (float, int)) and isinstance(lon, (float, int))


def _monotone_chain(points: List[Dict[str, float]]) -> List[Dict[str, float]]:
    if len(points) < 2:
        return points.copy()

    sorted_points = sorted(points, key=lambda p: (p["lon"], p["lat"]))

    def cross(o: Dict[str, float], a: Dict[str, float], b: Dict[str, float]) -> float:
        return (a["lon"] - o["lon"]) * (b["lat"] - o["lat"]) - (a["lat"] - o["lat"]) * (b["lon"] - o["lon"])

    lower: List[Dict[str, float]] = []
    for point in sorted_points:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)

    upper: List[Dict[str, float]] = []
    for point in reversed(sorted_points):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)

    lower.pop()
    upper.pop()
    return lower + upper


def build_spatial_overlays(points: List[Dict[str, float]]) -> Dict[str, object]:
    valid_points = [p for p in points if _is_valid_point(p)]
    considered = [p for p in valid_points if p.get("station") not in HULL_EXCLUDE_STATIONS]

    if len(considered) < 2:
        return {
            "boundary": [],
            "interior": [],
            "polygon": [],
            "hullType": "none",
        }

    hull_points = _monotone_chain(considered)
    if len(hull_points) < 2:
        return {
            "boundary": [],
            "interior": [],
            "polygon": [],
            "hullType": "none",
        }

    hull_station_names = {p.get("station") for p in hull_points if p.get("station")}
    interior_points = [p for p in considered if p.get("station") and p.get("station") not in hull_station_names]

    polygon_coords: List[Tuple[float, float]] = [(p["lat"], p["lon"]) for p in hull_points]
    hull_type = "polyline" if len(hull_points) == 2 else "polygon"

    return {
        "boundary": hull_points,
        "interior": interior_points,
        "polygon": polygon_coords,
        "hullType": hull_type,
    }


def _iter_polygons(geometry: Polygon) -> Iterable[Polygon]:
    if geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        return [geometry]
    if geometry.geom_type == "MultiPolygon":
        return list(geometry.geoms)
    return []


def _to_xy(lat: float, lon: float) -> Tuple[float, float]:
    return _TO_METERS.transform(lon, lat)


def _to_latlon(x: float, y: float) -> Tuple[float, float]:
    lon, lat = _TO_LATLON.transform(x, y)
    return lat, lon


def compute_fill_circles(
    hull_polygon: List[Tuple[float, float]],
    existing_points: List[Dict[str, float]],
    radius_m: float = 10000.0,
    packing_scale: float = 0.5,
) -> List[Dict[str, float]]:
    if len(hull_polygon) < 3:
        return []

    xy_coords = []
    for lat, lon in hull_polygon:
        if isinstance(lat, (float, int)) and isinstance(lon, (float, int)):
            xy_coords.append(_to_xy(lat, lon))
    if len(xy_coords) < 3:
        return []

    polygon_xy = Polygon(xy_coords)
    if polygon_xy.is_empty or polygon_xy.area == 0:
        return []

    shrunken = polygon_xy.buffer(-radius_m)
    candidate_polygons = [poly.buffer(0) for poly in _iter_polygons(shrunken) if not poly.is_empty]
    if not candidate_polygons:
        return []

    existing_centers: List[Tuple[float, float]] = []
    for point in existing_points:
        if not _is_valid_point(point):
            continue
        x, y = _to_xy(point["lat"], point["lon"])
        existing_centers.append((x, y))

    all_centers = existing_centers.copy()
    accepted: List[Tuple[float, float]] = []

    packing_scale = max(0.25, min(packing_scale, 1.0))
    horizontal_spacing = radius_m * 2.0 * packing_scale
    vertical_spacing = radius_m * math.sqrt(3.0) * packing_scale
    min_separation_sq = (radius_m * 1.8) ** 2

    for poly in candidate_polygons:
        if poly.is_empty or poly.area == 0:
            continue
        minx, miny, maxx, maxy = poly.bounds
        row_index = 0
        y = miny
        while y <= maxy:
            offset = radius_m if row_index % 2 else 0.0
            x = minx - horizontal_spacing
            while x <= maxx + horizontal_spacing:
                cx = x + offset
                candidate_point = Point(cx, y)
                if not (poly.contains(candidate_point) or poly.touches(candidate_point)):
                    x += horizontal_spacing
                    continue

                overlaps = False
                for ox, oy in all_centers:
                    dx = cx - ox
                    dy = y - oy
                    if dx * dx + dy * dy < min_separation_sq:
                        overlaps = True
                        break
                if overlaps:
                    x += horizontal_spacing
                    continue

                all_centers.append((cx, y))
                accepted.append((cx, y))
                x += horizontal_spacing
            y += vertical_spacing
            row_index += 1

    circles: List[Dict[str, float]] = []
    for cx, cy in accepted:
        lat, lon = _to_latlon(cx, cy)
        circles.append({"lat": lat, "lon": lon})
    return circles


def compute_fill_values(
    existing_points: List[Dict[str, float]],
    fill_points: List[Dict[str, float]],
    values_by_time: List[List[float]],
    power: float = 2.0,
) -> List[List[float]]:
    if not fill_points or not values_by_time or not existing_points:
        return []

    station_xy: List[Tuple[float, float]] = []
    for point in existing_points:
        if not _is_valid_point(point):
            station_xy.append((math.nan, math.nan))
            continue
        station_xy.append(_to_xy(point["lat"], point["lon"]))

    fill_xy: List[Tuple[float, float]] = []
    for point in fill_points:
        if not _is_valid_point(point):
            fill_xy.append((math.nan, math.nan))
            continue
        fill_xy.append(_to_xy(point["lat"], point["lon"]))

    results: List[List[float]] = []
    for frame in values_by_time:
        if len(frame) != len(station_xy):
            results.append([math.nan] * len(fill_xy))
            continue
        frame_results: List[float] = []
        for (fx, fy) in fill_xy:
            if not math.isfinite(fx) or not math.isfinite(fy):
                frame_results.append(math.nan)
                continue
            numerator = 0.0
            denominator = 0.0
            for (sx, sy), value in zip(station_xy, frame):
                if not math.isfinite(sx) or not math.isfinite(sy):
                    continue
                if not math.isfinite(value):
                    continue
                dx = fx - sx
                dy = fy - sy
                distance = math.hypot(dx, dy)
                if distance < 1e-6:
                    numerator = value
                    denominator = 1.0
                    break
                weight = 1.0 / ((distance + 1e-6) ** power)
                numerator += weight * value
                denominator += weight
            if denominator == 0.0:
                frame_results.append(math.nan)
            else:
                frame_results.append(numerator / denominator)
        results.append(frame_results)
    return results
