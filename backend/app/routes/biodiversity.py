from datetime import date

import h3
from fastapi import APIRouter, HTTPException, Query

from app.services.biodiversity import get_biodiversity_data
from app.services.biodiversity_forecast import get_biodiversity_forecast
from app.services.archive_availability import is_prediction_available


router = APIRouter(
    prefix="/biodiversity",
    tags=["Biodiversity"],
)


MIN_DATE = date(2023, 1, 1)
MAX_DATE = date(2026, 12, 31)


def validate_date(requested_date: date):
    if requested_date < MIN_DATE or requested_date > MAX_DATE:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Date must be between "
                f"{MIN_DATE.isoformat()} and {MAX_DATE.isoformat()}."
            ),
        )


def is_forecast_date(requested_date: date) -> bool:
    """
    Determine whether the requested 2026 date should use the forecast
    biodiversity service.

    A date is treated as observed only when the real observed 2026
    archive exists. This is deliberately archive-driven rather than
    based on whether the calendar date is before or after today, because
    forecast artifacts can legitimately represent dates that are now
    in the past.

    Historical dates through 2025 are never forecast dates.
    """

    if requested_date.year <= 2025:
        return False

    return not is_prediction_available(requested_date)


@router.get("/date")
def get_biodiversity_by_date(
    date: date = Query(...),
    lat: float = Query(...),
    lon: float = Query(...),
):
    """
    Return observed biodiversity for historical/observed dates.

    Future dates use the real M9 biodiversity forecast service.
    """

    validate_date(date)

    if is_forecast_date(date):
        try:
            return get_biodiversity_forecast(
                prediction_date=date,
                latitude=lat,
                longitude=lon,
            )
        except RuntimeError as exc:
            raise HTTPException(
                status_code=503,
                detail=(
                    f"Biodiversity forecast is currently unavailable for "
                    f"{date.isoformat()}: {exc}"
                ),
            ) from exc
        except (FileNotFoundError, ValueError) as exc:
            raise HTTPException(
                status_code=404,
                detail=str(exc),
            ) from exc

    return get_biodiversity_data(
        prediction_date=date,
        latitude=lat,
        longitude=lon,
    )



@router.get("/grid")
def get_biodiversity_grid(
    date: date = Query(...),
):
    """
    Return the complete real H3 biodiversity grid for the requested date.

    Historical/observed dates use the observed biodiversity archive when
    available. Future/unobserved dates use the real M9 forecast artifact,
    generating it on demand when necessary.
    """

    validate_date(date)

    if is_forecast_date(date):
        try:
            from app.services.biodiversity_forecast import _ensure_forecast_artifact

            archive_path = _ensure_forecast_artifact(date)
        except RuntimeError as exc:
            raise HTTPException(
                status_code=503,
                detail=(
                    f"Biodiversity forecast is currently unavailable for "
                    f"{date.isoformat()}: {exc}"
                ),
            ) from exc
        except (FileNotFoundError, ValueError) as exc:
            raise HTTPException(
                status_code=404,
                detail=str(exc),
            ) from exc

        source = "forecast"

    else:
        from app.services.biodiversity import DATE_LAYER

        archive_path = DATE_LAYER
        source = "observed"

    import pandas as pd
    import math

    df = pd.read_parquet(archive_path) if str(archive_path).endswith(".parquet") else pd.read_csv(archive_path)

    if "prediction_date" in df.columns:
        df = df[
            df["prediction_date"].astype(str).str[:10]
            == date.isoformat()
        ]

    if df.empty:
        raise HTTPException(
            status_code=404,
            detail=f"No biodiversity records available for {date.isoformat()}.",
        )

    def safe_float(value):
        try:
            value = float(value)
            return value if math.isfinite(value) else None
        except (TypeError, ValueError):
            return None

    cells = []

    if source == "observed":
        required = [
            "h3_index",
            "occurrence_count",
            "species_count",
            "shannon_diversity",
            "elasmobranch_count",
            "crustacean_count",
        ]

        missing = [column for column in required if column not in df.columns]

        if missing:
            raise HTTPException(
                status_code=500,
                detail=f"Observed biodiversity archive is missing columns: {missing}",
            )

        for _, row in df.iterrows():
            h3_index = str(row["h3_index"])
            center_lat, center_lon = h3.cell_to_latlng(h3_index)

            cells.append({
                "h3_index": h3_index,
                "center_lat": safe_float(center_lat),
                "center_lon": safe_float(center_lon),
                "predicted_biodiversity_index": None,
                "biodiversity_hotspot_likelihood": None,
                "mess_similarity": None,
                "confidence_score": None,
                "prediction_status": "Observed",
                "observation_status": "Observed",
                "occurrence_count": safe_float(row["occurrence_count"]),
                "species_count": safe_float(row["species_count"]),
                "species_richness": safe_float(row["species_count"]),
                "shannon_index": safe_float(row["shannon_diversity"]),
                "elasmobranch_count": safe_float(row["elasmobranch_count"]),
                "crustacean_count": safe_float(row["crustacean_count"]),
            })

    else:
        required = [
            "h3_index",
            "center_lat",
            "center_lon",
            "predicted_biodiversity_index",
            "biodiversity_hotspot_likelihood",
            "mess_similarity",
            "confidence_score",
            "prediction_status",
        ]

        missing = [column for column in required if column not in df.columns]

        if missing:
            raise HTTPException(
                status_code=500,
                detail=f"Biodiversity forecast archive is missing columns: {missing}",
            )

        for _, row in df.iterrows():
            cells.append({
                "h3_index": str(row["h3_index"]),
                "center_lat": safe_float(row["center_lat"]),
                "center_lon": safe_float(row["center_lon"]),
                "predicted_biodiversity_index": safe_float(
                    row["predicted_biodiversity_index"]
                ),
                "biodiversity_hotspot_likelihood": safe_float(
                    row["biodiversity_hotspot_likelihood"]
                ),
                "mess_similarity": safe_float(row["mess_similarity"]),
                "confidence_score": safe_float(row["confidence_score"]),
                "prediction_status": str(row["prediction_status"]),
                "observation_status": None,
                "occurrence_count": None,
                "species_count": None,
                "species_richness": None,
                "shannon_index": None,
                "elasmobranch_count": None,
                "crustacean_count": None,
            })

    return {
        "date": date,
        "source": source,
        "total_cells": len(cells),
        "cells": cells,
    }

@router.get("/cell/{h3_index}")
def get_biodiversity_cell(
    h3_index: str,
    date: date = Query(...),
):
    """
    Return biodiversity information for an exact H3 cell and date.
    """

    validate_date(date)

    try:
        latitude, longitude = h3.cell_to_latlng(h3_index)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid H3 cell: {h3_index}",
        ) from exc

    if is_forecast_date(date):
        try:
            result = get_biodiversity_forecast(
                prediction_date=date,
                latitude=latitude,
                longitude=longitude,
            )
        except RuntimeError as exc:
            raise HTTPException(
                status_code=503,
                detail=(
                    f"Biodiversity forecast is currently unavailable for "
                    f"{date.isoformat()}: {exc}"
                ),
            ) from exc
        except (FileNotFoundError, ValueError) as exc:
            raise HTTPException(
                status_code=404,
                detail=str(exc),
            ) from exc
    else:
        result = get_biodiversity_data(
            prediction_date=date,
            latitude=latitude,
            longitude=longitude,
        )

    if result["h3_index"] != h3_index:
        raise HTTPException(
            status_code=404,
            detail=f"H3 cell {h3_index} could not be resolved.",
        )

    return result
