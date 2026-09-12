from datetime import date
from pathlib import Path

import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parents[3]

OBSERVED_2026_DIR = PROJECT_ROOT / "ml" / "observed_2026"


def _archive_path(prediction_date: date) -> Path:
    """Return the monthly observed-2026 archive for a date."""

    return (
        OBSERVED_2026_DIR
        / f"{prediction_date.strftime('%Y_%m')}_observed.parquet"
    )


def _to_optional_float(value):
    if pd.isna(value):
        return None
    return float(value)


def _to_optional_int(value):
    if pd.isna(value):
        return None
    return int(value)


def get_prediction_from_archive(
    prediction_date: date,
    latitude: float,
    longitude: float,
):
    """
    Return the real observed 2026 AquaGrid PFZ prediction
    for the nearest H3 cell.
    """

    archive_path = _archive_path(prediction_date)

    if not archive_path.exists():
        raise ValueError(
            f"No observed 2026 archive available for "
            f"{prediction_date.isoformat()}."
        )

    df = pd.read_parquet(archive_path)

    date_column = "prediction_date"

    if date_column in df.columns:
        date_rows = df[
            df[date_column].astype(str).str[:10]
            == prediction_date.isoformat()
        ]
    else:
        date_rows = df

    if date_rows.empty:
        raise ValueError(
            f"No observed PFZ data available for "
            f"{prediction_date.isoformat()}."
        )

    distances = (
        (date_rows["center_lat"] - latitude) ** 2
        + (date_rows["center_lon"] - longitude) ** 2
    )

    row = date_rows.loc[distances.idxmin()]

    return {
        "date": prediction_date,
        "source": str(row.get("source_type", "observed")),
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

        "observed_pfz": None,
        "replay_score": None,
        "replay_confidence": None,

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