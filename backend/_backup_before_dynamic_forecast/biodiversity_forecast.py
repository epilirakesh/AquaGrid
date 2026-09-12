from datetime import date
from pathlib import Path

import pandas as pd
import h3


PROJECT_ROOT = Path(__file__).resolve().parents[3]

FORECAST_DIR = PROJECT_ROOT / "ml" / "forecast_2026"

_FORECAST_CACHE = {}


def _forecast_path(prediction_date: date) -> Path:
    return FORECAST_DIR / f"{prediction_date.isoformat()}_biodiversity_forecast.parquet"


def _load_forecast(prediction_date: date) -> pd.DataFrame:
    if prediction_date not in _FORECAST_CACHE:
        path = _forecast_path(prediction_date)

        if not path.exists():
            raise FileNotFoundError(
                f"No biodiversity forecast available for {prediction_date}: {path}"
            )

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

    requested_h3 = h3.latlng_to_cell(latitude, longitude, 7)

    match = df[df["h3_index"] == requested_h3]

    if match.empty:
        raise ValueError(
            f"H3 cell {requested_h3} is not present in biodiversity forecast "
            f"for {prediction_date}"
        )

    row = match.iloc[0]

    center_lat, center_lon = h3.cell_to_latlng(requested_h3)

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
        "forecast_horizon_days": None if pd.isna(row["forecast_horizon_days"]) else int(row["forecast_horizon_days"]),
        "model_type": str(row["model_type"]),
        "model_training_period": str(row["model_training_period"]),
        "validation_period": str(row["validation_period"]),
    }
