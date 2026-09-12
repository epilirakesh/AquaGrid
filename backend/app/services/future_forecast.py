from __future__ import annotations

from datetime import date
from pathlib import Path
import subprocess
import sys
import threading


PROJECT_ROOT = Path(__file__).resolve().parents[3]

PYTHON = sys.executable

ACQUISITION_ENGINE = (
    PROJECT_ROOT / "ml" / "copernicus_forecast_acquisition.py"
)

M2_ENGINE = (
    PROJECT_ROOT / "ml" / "vectorized_interpolation_engine.py"
)

M8_ENGINE = (
    PROJECT_ROOT / "ml" / "m8_future_pfz_engine.py"
)

M9_ENGINE = (
    PROJECT_ROOT / "ml" / "m9_future_biodiversity_engine.py"
)

H3_GRID = (
    PROJECT_ROOT / "data" / "combined" / "h3_reference_grid.csv"
)

PFZ_MODEL = (
    PROJECT_ROOT / "ml" / "models" / "random_forest_full.pkl"
)

M9_MODEL = (
    PROJECT_ROOT / "ml" / "m9_validation" / "temporal_sdm_2023_2024.pkl"
)

M9_REFERENCE = (
    PROJECT_ROOT / "ml" / "m9_validation" / "temporal_train_2023_2024.parquet"
)

FORECAST_DIR = PROJECT_ROOT / "ml" / "forecast_2026"

_FORECAST_LOCK = threading.Lock()


def _environment_path(prediction_date: date) -> Path:
    return (
        FORECAST_DIR
        / f"{prediction_date.isoformat()}_environment_forecast.parquet"
    )


def _pfz_path(prediction_date: date) -> Path:
    return (
        FORECAST_DIR
        / f"{prediction_date.isoformat()}_pfz_forecast.parquet"
    )


def _biodiversity_path(prediction_date: date) -> Path:
    return (
        FORECAST_DIR
        / f"{prediction_date.isoformat()}_biodiversity_forecast.parquet"
    )


def _environment_directory(prediction_date: date) -> Path:
    return (
        PROJECT_ROOT
        / "data"
        / "environmental"
        / "forecast"
        / prediction_date.isoformat()
    )


def _physics_path(prediction_date: date) -> Path:
    return (
        _environment_directory(prediction_date)
        / f"forecast_physics_{prediction_date.isoformat()}.nc"
    )


def _chl_path(prediction_date: date) -> Path:
    return (
        _environment_directory(prediction_date)
        / f"forecast_chl_{prediction_date.isoformat()}.nc"
    )


def _run(command: list[str], label: str) -> None:
    print()
    print("=" * 80)
    print(f"AQUAGRID FUTURE FORECAST - {label}")
    print("=" * 80)
    print("COMMAND:")
    print(" ".join(str(part) for part in command))

    completed = subprocess.run(
        command,
        cwd=PROJECT_ROOT,
        check=False,
    )

    if completed.returncode != 0:
        raise RuntimeError(
            f"{label} failed with exit code {completed.returncode}."
        )


def _acquire_environment(prediction_date: date) -> None:
    environment_dir = _environment_directory(prediction_date)
    physics = _physics_path(prediction_date)
    chl = _chl_path(prediction_date)

    if physics.exists() and chl.exists():
        print(
            f"REUSE ENVIRONMENT: {prediction_date.isoformat()}"
        )
        return

    _run(
        [
            PYTHON,
            str(ACQUISITION_ENGINE),
            "--date",
            prediction_date.isoformat(),
        ],
        "COPERNICUS ACQUISITION",
    )

    if not physics.exists():
        raise RuntimeError(
            f"Forecast Physics artifact was not created: {physics}"
        )

    if not chl.exists():
        raise RuntimeError(
            f"Forecast chlorophyll artifact was not created: {chl}"
        )


def _run_m2(
    prediction_date: date,
    initialization_date: date,
) -> None:
    output = _environment_path(prediction_date)

    if output.exists() and output.stat().st_size > 0:
        print(
            f"REUSE M2 ENVIRONMENT: {output}"
        )
        return

    lead_days = (
        prediction_date - initialization_date
    ).days

    if lead_days < 0:
        raise ValueError(
            "Forecast prediction date cannot be earlier than "
            "the forecast initialization date."
        )

    _run(
        [
            PYTHON,
            str(M2_ENGINE),
            "--h3",
            str(H3_GRID),
            "--physics",
            str(_physics_path(prediction_date)),
            "--bgc",
            str(_chl_path(prediction_date)),
            "--date",
            prediction_date.isoformat(),
            "--output",
            str(output),
            "--time-method",
            "exact",
            "--source-type",
            "forecast",
            "--source-provider",
            "Copernicus",
            "--forecast-initialization",
            initialization_date.isoformat(),
            "--forecast-lead-days",
            str(lead_days),
        ],
        "M2 INTERPOLATION",
    )

    if not output.exists():
        raise RuntimeError(
            f"M2 environment artifact was not created: {output}"
        )


def _run_m8(prediction_date: date) -> None:
    output = _pfz_path(prediction_date)

    if output.exists() and output.stat().st_size > 0:
        print(
            f"REUSE M8 PFZ: {output}"
        )
        return

    _run(
        [
            PYTHON,
            str(M8_ENGINE),
            "--environment",
            str(_environment_path(prediction_date)),
            "--model",
            str(PFZ_MODEL),
            "--date",
            prediction_date.isoformat(),
            "--output",
            str(output),
            "--source-type",
            "forecast",
            "--source-provider",
            "Copernicus",
        ],
        "M8 PFZ PREDICTION",
    )

    if not output.exists():
        raise RuntimeError(
            f"M8 PFZ artifact was not created: {output}"
        )


def _run_m9(prediction_date: date) -> None:
    output = _biodiversity_path(prediction_date)

    if output.exists() and output.stat().st_size > 0:
        print(
            f"REUSE M9 BIODIVERSITY: {output}"
        )
        return

    _run(
        [
            PYTHON,
            str(M9_ENGINE),
            "--h3",
            str(H3_GRID),
            "--physics",
            str(_physics_path(prediction_date)),
            "--bgc",
            str(_chl_path(prediction_date)),
            "--model",
            str(M9_MODEL),
            "--reference",
            str(M9_REFERENCE),
            "--date",
            prediction_date.isoformat(),
            "--source-type",
            "forecast",
            "--source-provider",
            "Copernicus",
            "--time-method",
            "exact",
            "--output",
            str(output),
        ],
        "M9 BIODIVERSITY PREDICTION",
    )

    if not output.exists():
        raise RuntimeError(
            f"M9 biodiversity artifact was not created: {output}"
        )


def generate_future_forecast(
    prediction_date: date,
    initialization_date: date | None = None,
) -> dict[str, Path]:
    """
    Generate and cache the complete AquaGrid future forecast package.

    Pipeline:
        Copernicus -> M2 -> M8 PFZ + M9 biodiversity

    Existing artifacts are reused. The shared lock prevents
    simultaneous requests from generating the same date twice.
    """

    if initialization_date is None:
        initialization_date = date.today()

    if prediction_date < initialization_date:
        raise ValueError(
            f"Prediction date {prediction_date} is earlier than "
            f"initialization date {initialization_date}."
        )

    FORECAST_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    with _FORECAST_LOCK:
        _acquire_environment(prediction_date)

        _run_m2(
            prediction_date,
            initialization_date,
        )

        _run_m8(prediction_date)

        _run_m9(prediction_date)

    return {
        "environment": _environment_path(prediction_date),
        "pfz": _pfz_path(prediction_date),
        "biodiversity": _biodiversity_path(prediction_date),
        "physics": _physics_path(prediction_date),
        "chlorophyll": _chl_path(prediction_date),
    }
