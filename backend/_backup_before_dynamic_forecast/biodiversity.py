from datetime import date

import h3
from fastapi import APIRouter, HTTPException, Query

from app.services.biodiversity import get_biodiversity_data
from app.services.biodiversity_forecast import get_biodiversity_forecast


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
    M9 future biodiversity forecast currently exists
    for 2026-09-05.
    """
    return requested_date == date(2026, 9, 5)


@router.get("/date")
def get_biodiversity_by_date(
    date: date = Query(...),
    lat: float = Query(...),
    lon: float = Query(...),
):
    """
    Return observed biodiversity for historical dates.

    For the currently available future forecast date,
    return M9 biodiversity suitability/hotspot likelihood.
    """

    validate_date(date)

    if is_forecast_date(date):
        return get_biodiversity_forecast(
            prediction_date=date,
            latitude=lat,
            longitude=lon,
        )

    return get_biodiversity_data(
        prediction_date=date,
        latitude=lat,
        longitude=lon,
    )


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
    except Exception:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid H3 cell: {h3_index}",
        )

    if is_forecast_date(date):
        result = get_biodiversity_forecast(
            prediction_date=date,
            latitude=latitude,
            longitude=longitude,
        )
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
