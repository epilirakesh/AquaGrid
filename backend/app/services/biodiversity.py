from datetime import date
from pathlib import Path

import pandas as pd
import h3


PROJECT_ROOT = Path(__file__).resolve().parents[3]

DATE_LAYER = (
    PROJECT_ROOT
    / "data"
    / "biodiversity"
    / "final"
    / "biodiversity_h3_date_layer.csv"
)

H3_MAP = (
    PROJECT_ROOT
    / "data"
    / "biodiversity"
    / "final"
    / "biodiversity_full_h3_map.csv"
)


_DATE_DF = None
_H3_MAP_DF = None


def _load_data():
    global _DATE_DF, _H3_MAP_DF

    if _DATE_DF is None:
        _DATE_DF = pd.read_csv(DATE_LAYER)
        _DATE_DF["advisory_date"] = pd.to_datetime(
            _DATE_DF["advisory_date"]
        ).dt.date
        _DATE_DF["h3_index"] = _DATE_DF["h3_index"].astype(str)

    if _H3_MAP_DF is None:
        _H3_MAP_DF = pd.read_csv(H3_MAP)
        _H3_MAP_DF["h3_index"] = _H3_MAP_DF["h3_index"].astype(str)

    return _DATE_DF, _H3_MAP_DF


def get_biodiversity_data(
    prediction_date: date,
    latitude: float,
    longitude: float,
):
    date_df, h3_map_df = _load_data()

    # Convert requested coordinates to the canonical H3 cell.
    requested_h3 = h3.latlng_to_cell(latitude, longitude, 7)

    # Look up the exact date + H3 record.
    match = date_df[
        (date_df["advisory_date"] == prediction_date)
        & (date_df["h3_index"] == requested_h3)
    ]

    if match.empty:
        return {
            "date": prediction_date,
            "source": "observed_biodiversity",
            "h3_index": requested_h3,
            "latitude": latitude,
            "longitude": longitude,
            "observation_status": "No Observation",
            "occurrence_count": None,
            "species_count": None,
            "species_richness": None,
            "shannon_index": None,
            "elasmobranch_count": None,
            "crustacean_count": None,
            "shannon_observed": False,
            "richness_observed": False,
            "environment": None,
        }

    row = match.iloc[0]

    # Use the canonical H3 center for the response.
    center_lat, center_lon = h3.cell_to_latlng(requested_h3)

    return {
        "date": prediction_date,
        "source": "observed_biodiversity",
        "h3_index": requested_h3,
        "latitude": center_lat,
        "longitude": center_lon,
        "observation_status": "Observed",
        "occurrence_count": int(row["occurrence_count"]),
        "species_count": int(row["species_count"]),
        "species_richness": int(row["species_count"]),
        "shannon_index": float(row["shannon_diversity"]),
        "elasmobranch_count": int(row["elasmobranch_count"]),
        "crustacean_count": int(row["crustacean_count"]),
        "shannon_observed": bool(row["shannon_observed"]),
        "richness_observed": bool(row["richness_observed"]),
        "environment": None,
    }