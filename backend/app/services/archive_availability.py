from datetime import date
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[3]

OBSERVED_2026_DIR = PROJECT_ROOT / "ml" / "observed_2026"


def _archive_path(prediction_date: date) -> Path:
    return (
        OBSERVED_2026_DIR
        / f"{prediction_date.strftime('%Y_%m')}_observed.parquet"
    )


def is_prediction_available(prediction_date: date) -> bool:
    """
    Return True only when the real observed 2026 archive
    exists for the requested date.
    """

    if prediction_date.year != 2026:
        return False

    return _archive_path(prediction_date).exists()


def get_archive_status(prediction_date: date):
    """
    Return structured information about observed 2026
    archive availability.
    """

    available = is_prediction_available(prediction_date)

    if available:
        return {
            "available": True,
            "source": "observed",
            "status": "available",
        }

    return {
        "available": False,
        "source": "forecast",
        "status": "not_available",
    }