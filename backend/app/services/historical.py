from datetime import date
from pathlib import Path

import pandas as pd


# AquaGrid project root:
# <project>/backend/app/services/historical.py
PROJECT_ROOT = Path(__file__).resolve().parents[3]

HISTORICAL_ARCHIVE_DIR = (
    PROJECT_ROOT
    / "ml"
    / "replay_complete"
    / "yearly"
)

REQUIRED_COLUMNS = [
    "prediction_date",
    "h3_index",
    "center_lat",
    "center_lon",
    "observed_pfz",
    "advisory_record_count",
    "observation_status",
    "pfz_probability",
    "pfz_prediction",
    "confidence",
    "prediction_status",
    "sst_c",
    "current_u_ms",
    "current_v_ms",
    "current_speed_ms",
    "salinity_psu",
    "mixed_layer_m",
    "ssh_m",
    "chlorophyll_mg_m3",
    "source_type",
    "source_provider",
]


def _load_archive() -> pd.DataFrame:
    """Load the certified 2023-2025 complete daily AquaGrid archive."""

    archives = sorted(HISTORICAL_ARCHIVE_DIR.glob("*_daily.parquet"))

    if not archives:
        raise FileNotFoundError(
            f"AquaGrid historical archive directory not found or empty: "
            f"{HISTORICAL_ARCHIVE_DIR}"
        )

    df = pd.concat(
        [pd.read_parquet(path) for path in archives],
        ignore_index=True,
    )

    missing = [column for column in REQUIRED_COLUMNS if column not in df.columns]

    if missing:
        raise ValueError(
            f"Historical archive is missing required columns: {missing}"
        )

    return df


def _find_nearest_cell(
    df: pd.DataFrame,
    latitude: float,
    longitude: float,
):
    """Find the nearest AquaGrid H3 cell to the requested coordinates."""

    distances = (
        (df["center_lat"] - latitude) ** 2
        + (df["center_lon"] - longitude) ** 2
    )

    index = distances.idxmin()

    return df.loc[index]


def _to_optional_float(value):
    if pd.isna(value):
        return None
    return float(value)


def _to_optional_int(value):
    if pd.isna(value):
        return None
    return int(value)


def _to_optional_bool(value):
    if pd.isna(value):
        return None
    return bool(value)


def get_historical_pfz(
    advisory_date: date,
    latitude: float,
    longitude: float,
):
    """
    Return the real AquaGrid historical PFZ/replay record
    for the nearest H3 cell on the requested date.
    """

    df = _load_archive()

    date_rows = df[
        df["prediction_date"].astype(str).str[:10]
        == advisory_date.isoformat()
    ]

    if date_rows.empty:
        raise ValueError(
            f"No AquaGrid historical archive data available for "
            f"{advisory_date.isoformat()}."
        )

    row = _find_nearest_cell(
        date_rows,
        latitude=latitude,
        longitude=longitude,
    )

    observed_pfz = _to_optional_bool(row["observed_pfz"])

    return {
        "date": advisory_date,
        "source": str(row["source_type"]),
        "h3_index": str(row["h3_index"]),
        "latitude": float(row["center_lat"]),
        "longitude": float(row["center_lon"]),

        "probability": _to_optional_float(row["pfz_probability"]),
        "confidence": (
            None
            if pd.isna(row["confidence"])
            else str(row["confidence"])
        ),
        "prediction": _to_optional_int(row["pfz_prediction"]),

        "observed_pfz": observed_pfz,

        "replay_score": _to_optional_float(row["pfz_probability"]),
        "replay_confidence": (
            None
            if pd.isna(row["confidence"])
            else str(row["confidence"])
        ),

        "environment": {
            "sst_c": _to_optional_float(row["sst_c"]),
            "current_u_ms": _to_optional_float(row["current_u_ms"]),
            "current_v_ms": _to_optional_float(row["current_v_ms"]),
            "current_speed_ms": _to_optional_float(row["current_speed_ms"]),
            "salinity_psu": _to_optional_float(row["salinity_psu"]),
            "mixed_layer_m": _to_optional_float(row["mixed_layer_m"]),
            "ssh_m": _to_optional_float(row["ssh_m"]),
            "chlorophyll_mg_m3": _to_optional_float(
                row["chlorophyll_mg_m3"]
            ),
        },
    }