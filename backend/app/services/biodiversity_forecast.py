from datetime import date
from pathlib import Path

import h3
import pandas as pd

from app.services.future_forecast import generate_future_forecast


PROJECT_ROOT = Path(__file__).resolve().parents[3]

FORECAST_DIR = PROJECT_ROOT / "ml" / "forecast_2026"

_FORECAST_CACHE = {}


def _forecast_path(prediction_date: date) -> Path:
    return (
        FORECAST_DIR
        / f"{prediction_date.isoformat()}_biodiversity_forecast.parquet"
    )


def _ensure_forecast_artifact(
    prediction_date: date,
) -> Path:
    """
    Return an existing biodiversity forecast artifact or generate it.

    Existing validated artifacts are reused. If the requested future
    date has no biodiversity artifact, the shared future forecast
    orchestrator generates the required environmental inputs, M2
    environment features, M8 PFZ forecast, and M9 biodiversity forecast.
    """

    path = _forecast_path(prediction_date)

    if path.exists() and path.stat().st_size > 0:
        return path

    try:
        generated = generate_future_forecast(
            prediction_date=prediction_date,
        )
    except Exception as exc:
        raise RuntimeError(
            f"Future biodiversity forecast could not be generated for "
            f"{prediction_date.isoformat()}: {exc}"
        ) from exc

    generated_path = generated["biodiversity"]

    if not generated_path.exists() or generated_path.stat().st_size == 0:
        raise RuntimeError(
            f"Future biodiversity generation completed but the "
            f"biodiversity artifact was not created for "
            f"{prediction_date.isoformat()}."
        )

    return generated_path


def _load_forecast(prediction_date: date) -> pd.DataFrame:
    if prediction_date not in _FORECAST_CACHE:
        path = _ensure_forecast_artifact(prediction_date)

        df = pd.read_parquet(path)
        df["h3_index"] = df["h3_index"].astype(str)

        _FORECAST_CACHE[prediction_date] = df

    return _FORECAST_CACHE[prediction_date]


def get_biodiversity_forecast(
    prediction_date: date,
    latitude: float,
    longitude: float,
):
    df = _load_forecast(prediction_date)

    distances = (
        (df["center_lat"] - latitude) ** 2
        + (df["center_lon"] - longitude) ** 2
    )

    row = df.loc[distances.idxmin()]
    requested_h3 = str(row["h3_index"])

    center_lat = float(row["center_lat"])
    center_lon = float(row["center_lon"])

    return {
        "date": prediction_date,
        "source": str(row["source_type"]),
        "h3_index": requested_h3,
        "latitude": center_lat,
        "longitude": center_lon,
        "prediction_status": str(row["prediction_status"]),
        "predicted_biodiversity_index": float(
            row["predicted_biodiversity_index"]
        ),
        "biodiversity_hotspot_likelihood": float(
            row["biodiversity_hotspot_likelihood"]
        ),
        "mess_similarity": float(row["mess_similarity"]),
        "confidence_score": float(row["confidence_score"]),
        "environment": {
            "sst_c": float(row["sst_c"]),
            "chlorophyll_mg_m3": float(row["chlorophyll_mg_m3"]),
            "salinity_psu": float(row["salinity_psu"]),
            "current_u_ms": float(row["current_u_ms"]),
            "current_v_ms": float(row["current_v_ms"]),
            "current_speed_ms": float(row["current_speed_ms"]),
            "mixed_layer_m": float(row["mixed_layer_m"]),
            "ssh_m": float(row["ssh_m"]),
        },
        "forecast_horizon_days": (
            None
            if pd.isna(row["forecast_horizon_days"])
            else int(row["forecast_horizon_days"])
        ),
        "model_type": str(row["model_type"]),
        "model_training_period": str(row["model_training_period"]),
        "validation_period": str(row["validation_period"]),
    }
