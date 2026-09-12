from datetime import date
from pathlib import Path

import pandas as pd

from app.services.future_forecast import generate_future_forecast


PROJECT_ROOT = Path(__file__).resolve().parents[3]

FORECAST_DIR = PROJECT_ROOT / "ml" / "forecast_2026"


def _forecast_path(prediction_date: date) -> Path:
    return (
        FORECAST_DIR
        / f"{prediction_date.isoformat()}_pfz_forecast.parquet"
    )


def _to_optional_float(value):
    if pd.isna(value):
        return None
    return float(value)


def _to_optional_int(value):
    if pd.isna(value):
        return None
    return int(value)


def _ensure_forecast_artifact(
    prediction_date: date,
) -> Path:
    """
    Return an existing PFZ forecast artifact or generate it dynamically.

    Existing validated artifacts are always reused. If the requested
    future date has no artifact, the shared future forecast orchestrator
    runs Copernicus acquisition -> M2 -> M8/M9 and caches the result.
    """

    forecast_path = _forecast_path(prediction_date)

    if forecast_path.exists() and forecast_path.stat().st_size > 0:
        return forecast_path

    try:
        generated = generate_future_forecast(
            prediction_date=prediction_date,
        )
    except Exception as exc:
        raise RuntimeError(
            f"Future PFZ forecast could not be generated for "
            f"{prediction_date.isoformat()}: {exc}"
        ) from exc

    generated_path = generated["pfz"]

    if not generated_path.exists() or generated_path.stat().st_size == 0:
        raise RuntimeError(
            f"Future PFZ generation completed but the PFZ artifact "
            f"was not created for {prediction_date.isoformat()}."
        )

    return generated_path


def generate_forecast_pfz(
    prediction_date: date,
    latitude: float,
    longitude: float,
):
    """
    Return the real AquaGrid future PFZ forecast for the
    nearest H3 cell.

    Existing forecast artifacts are reused. If an artifact does not
    exist, the shared future forecast orchestrator generates the
    required Copernicus environmental inputs, M2 features, M8 PFZ
    forecast, and M9 biodiversity forecast.
    """

    forecast_path = _ensure_forecast_artifact(prediction_date)

    df = pd.read_parquet(forecast_path)

    if df.empty:
        raise ValueError(
            f"PFZ forecast file is empty for "
            f"{prediction_date.isoformat()}."
        )

    distances = (
        (df["center_lat"] - latitude) ** 2
        + (df["center_lon"] - longitude) ** 2
    )

    row = df.loc[distances.idxmin()]

    return {
        "date": prediction_date,
        "source": str(row.get("source_type", "forecast")),
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
