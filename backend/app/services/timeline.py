from datetime import date, timedelta
import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[3]

START_DATE = date(2023, 1, 1)

HISTORICAL_ARCHIVE = (
    PROJECT_ROOT
    / "ml"
    / "replay_complete"
    / "2023_2025_complete_daily.parquet"
)

OBSERVED_DIR = PROJECT_ROOT / "ml" / "observed_2026"
FORECAST_DIR = PROJECT_ROOT / "ml" / "forecast_2026"


def _observed_date_available(current_date: date) -> bool:
    path = (
        OBSERVED_DIR
        / f"{current_date.strftime('%Y_%m')}_observed.parquet"
    )
    return path.exists()


def _forecast_date_available(current_date: date) -> bool:
    pfz_path = (
        FORECAST_DIR
        / f"{current_date.isoformat()}_pfz_forecast.parquet"
    )
    biodiversity_path = (
        FORECAST_DIR
        / f"{current_date.isoformat()}_biodiversity_forecast.parquet"
    )

    return pfz_path.exists() or biodiversity_path.exists()


def _latest_supported_date() -> date:
    candidates = [date(2025, 12, 31)]

    for path in OBSERVED_DIR.glob("*_observed.parquet"):
        match = re.fullmatch(r"(\d{4})_(\d{2})_observed\.parquet", path.name)
        if not match:
            continue
        year, month = map(int, match.groups())
        if month == 12:
            next_month = date(year + 1, 1, 1)
        else:
            next_month = date(year, month + 1, 1)
        candidates.append(next_month - timedelta(days=1))

    for path in FORECAST_DIR.glob("*_pfz_forecast.parquet"):
        match = re.fullmatch(r"(\d{4}-\d{2}-\d{2})_pfz_forecast\.parquet", path.name)
        if match:
            candidates.append(date.fromisoformat(match.group(1)))

    for path in FORECAST_DIR.glob("*_biodiversity_forecast.parquet"):
        match = re.fullmatch(r"(\d{4}-\d{2}-\d{2})_biodiversity_forecast\.parquet", path.name)
        if match:
            candidates.append(date.fromisoformat(match.group(1)))

    return max(candidates)


def get_timeline():
    """
    Return the AquaGrid supported date timeline.

    Historical:
        2023-01-01 to 2025-12-31

    Observed 2026:
        Dates for which the real observed archive exists.

    Forecast 2026:
        Dates for which a real forecast artifact exists.

    Dates without an underlying artifact are marked unavailable.
    """

    timeline = []

    end_date = _latest_supported_date()
    current_date = START_DATE

    while current_date <= end_date:

        if current_date <= date(2025, 12, 31):
            source = "historical"
            status = "available"

        elif _observed_date_available(current_date):
            source = "observed"
            status = "available"

        elif _forecast_date_available(current_date):
            source = "forecast"
            status = "prediction"

        else:
            source = "unavailable"
            status = "unavailable"

        timeline.append(
            {
                "date": current_date,
                "source": source,
                "status": status,
            }
        )

        current_date += timedelta(days=1)

    return {
        "start_date": START_DATE,
        "end_date": end_date,
        "total_days": len(timeline),
        "dates": timeline,
    }
