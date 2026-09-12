from datetime import date

from fastapi import APIRouter, HTTPException, Query

from app.services.historical import get_historical_pfz
from app.services.archive import get_prediction_from_archive
from app.services.forecast import generate_forecast_pfz, _ensure_forecast_artifact
from app.services.archive_availability import is_prediction_available


router = APIRouter(
    prefix="/pfz",
    tags=["PFZ"],
)


# AquaGrid supported date range
MIN_DATE = date(2023, 1, 1)
MAX_DATE = date(2026, 12, 31)


# Approximate Mumbai–Goa marine study-region bounds.
# These can later be replaced with the exact project boundary.
MIN_LAT = 14.0
MAX_LAT = 20.5
MIN_LON = 70.0
MAX_LON = 74.5


def validate_date(requested_date: date):
    """
    Validate that the requested date falls inside
    AquaGrid's supported date range.
    """

    if requested_date < MIN_DATE or requested_date > MAX_DATE:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Date must be between "
                f"{MIN_DATE.isoformat()} and {MAX_DATE.isoformat()}."
            ),
        )


def validate_coordinates(latitude: float, longitude: float):
    """
    Validate that the requested coordinates fall inside
    the approximate Mumbai–Goa study region.
    """

    if not MIN_LAT <= latitude <= MAX_LAT:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Latitude must be between "
                f"{MIN_LAT} and {MAX_LAT}."
            ),
        )

    if not MIN_LON <= longitude <= MAX_LON:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Longitude must be between "
                f"{MIN_LON} and {MAX_LON}."
            ),
        )


def get_pfz_for_date(
    requested_date: date,
    latitude: float,
    longitude: float,
):
    """
    Route a PFZ request to the correct backend service.

    Historical dates use historical PFZ data.
    Dates with an available prediction archive use the archive.
    Other supported dates use the forecast service.
    """

    if requested_date.year <= 2025:
        return get_historical_pfz(
            advisory_date=requested_date,
            latitude=latitude,
            longitude=longitude,
        )

    if is_prediction_available(requested_date):
        return get_prediction_from_archive(
            prediction_date=requested_date,
            latitude=latitude,
            longitude=longitude,
        )

    return generate_forecast_pfz(
        prediction_date=requested_date,
        latitude=latitude,
        longitude=longitude,
    )


@router.get("/date")
def get_pfz_by_date(
    date: date = Query(...),
    lat: float = Query(...),
    lon: float = Query(...),
):
    """
    Return PFZ information for a requested date and location.
    """

    validate_date(date)
    validate_coordinates(lat, lon)

    try:
        return get_pfz_for_date(
            requested_date=date,
            latitude=lat,
            longitude=lon,
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                f"PFZ forecast is currently unavailable for "
                f"{date.isoformat()}: {exc}"
            ),
        ) from exc


@router.get("/cell/{h3_index}")
def get_pfz_cell(
    h3_index: str,
    date: date = Query(...),
):
    """
    Return PFZ information for the exact requested H3 cell and date.
    """

    validate_date(date)

    try:
        import h3

        latitude, longitude = h3.cell_to_latlng(h3_index)

    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid H3 cell: {h3_index}",
        ) from exc

    validate_coordinates(latitude, longitude)

    try:
        result = get_pfz_for_date(
            requested_date=date,
            latitude=latitude,
            longitude=longitude,
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                f"PFZ forecast is currently unavailable for "
                f"{date.isoformat()}: {exc}"
            ),
        ) from exc

    # The service performs a nearest-cell lookup. Verify that it
    # actually resolved to the requested H3 cell.
    if result.get("h3_index") != h3_index:
        raise HTTPException(
            status_code=404,
            detail=(
                f"H3 cell {h3_index} is not available in the "
                f"PFZ archive for {date.isoformat()}."
            ),
        )

    return result
    """
    Return PFZ information for a specific H3 cell and date.

    Uses real Parquet-backed PFZ data.
    """

    validate_date(date)

    result = get_pfz_for_date(
        requested_date=date,
        latitude=18.0,
        longitude=73.0,
    )

    result["h3_index"] = h3_index

    return result


@router.get("/grid")
def get_pfz_grid(
    date: date = Query(...),
):
    """
    Return the complete real H3 PFZ grid for the requested date.

    The grid is loaded from the same real Parquet archive used by
    the PFZ date/cell/stats services.
    """

    validate_date(date)

    if date.year <= 2025:
        from app.services.historical import HISTORICAL_ARCHIVE
        archive_path = HISTORICAL_ARCHIVE

    elif is_prediction_available(date):
        from app.services.archive import _archive_path
        archive_path = _archive_path(date)

    else:
        try:
            archive_path = _ensure_forecast_artifact(date)
        except RuntimeError as exc:
            raise HTTPException(
                status_code=503,
                detail=(
                    f"PFZ forecast is currently unavailable for "
                    f"{date.isoformat()}: {exc}"
                ),
            ) from exc

    import pandas as pd

    df = pd.read_parquet(archive_path)

    if "prediction_date" in df.columns:
        df = df[
            df["prediction_date"].astype(str).str[:10]
            == date.isoformat()
        ]

    if df.empty:
        raise HTTPException(
            status_code=404,
            detail=f"No PFZ records available for {date.isoformat()}.",
        )

    required = [
        "h3_index",
        "center_lat",
        "center_lon",
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
    ]

    missing = [column for column in required if column not in df.columns]

    if missing:
        raise HTTPException(
            status_code=500,
            detail=f"PFZ grid is missing required columns: {missing}",
        )

    records = df[required].copy()

    records = records.drop_duplicates(
        subset=["h3_index"],
        keep="first",
    )

    # Convert pandas NaN/inf values to JSON-safe nulls.
    records = records.astype(object).where(pd.notna(records), None)

    import math

    cells = []
    for record in records.to_dict(orient="records"):
        safe_record = {}
        for key, value in record.items():
            if isinstance(value, float) and not math.isfinite(value):
                safe_record[key] = None
            else:
                safe_record[key] = value
        cells.append(safe_record)

    return {
        "date": date,
        "source": (
            "historical"
            if date.year <= 2025
            else "observed"
            if is_prediction_available(date)
            else "forecast"
        ),
        "total_cells": int(len(cells)),
        "cells": cells,
    }


@router.get("/stats")
def get_pfz_stats(
    date: date = Query(...),
):
    """
    Return PFZ summary statistics calculated from the real
    AquaGrid archive for the requested date.
    """

    validate_date(date)

    if date.year <= 2025:
        from app.services.historical import HISTORICAL_ARCHIVE

        archive_path = HISTORICAL_ARCHIVE

    elif is_prediction_available(date):
        from app.services.archive import _archive_path

        archive_path = _archive_path(date)

    else:
        try:
            archive_path = _ensure_forecast_artifact(date)
        except RuntimeError as exc:
            raise HTTPException(
                status_code=503,
                detail=(
                    f"PFZ forecast is currently unavailable for "
                    f"{date.isoformat()}: {exc}"
                ),
            ) from exc

    import pandas as pd

    df = pd.read_parquet(archive_path)

    if "prediction_date" in df.columns:
        df = df[
            df["prediction_date"].astype(str).str[:10]
            == date.isoformat()
        ]

    if df.empty:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No PFZ records available for "
                f"{date.isoformat()}."
            ),
        )

    probabilities = pd.to_numeric(
        df["pfz_probability"],
        errors="coerce",
    )

    predictions = pd.to_numeric(
        df["pfz_prediction"],
        errors="coerce",
    )

    confidence = df["confidence"].fillna("").astype(str)

    usable = probabilities.notna() & predictions.notna()

    probabilities = probabilities[usable]
    predictions = predictions[usable]
    confidence = confidence[usable]

    return {
        "date": date,
        "total_cells": int(len(df)),
        "usable_cells": int(len(probabilities)),
        "unavailable_cells": int(len(df) - len(probabilities)),

        "high_confidence": int(
            (confidence == "High Confidence").sum()
        ),
        "recommended": int(
            (confidence == "Recommended").sum()
        ),
        "moderate_opportunity": int(
            (confidence == "Moderate Opportunity").sum()
        ),
        "low_potential": int(
            (confidence == "Low Potential").sum()
        ),

        "average_probability": (
            float(probabilities.mean())
            if len(probabilities) > 0
            else None
        ),

        "pfz_cells": int(
            (predictions == 1).sum()
        ),
        "non_pfz_cells": int(
            (predictions == 0).sum()
        ),
    }