from __future__ import annotations

import argparse
from datetime import date
from pathlib import Path

import copernicusmarine
import xarray as xr


BASE = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = BASE / "data" / "environmental" / "forecast"

MIN_LON = 69.5
MAX_LON = 74.5
MIN_LAT = 14.5
MAX_LAT = 20.8
MIN_DEPTH = 0.4
MAX_DEPTH = 1.0


DATASETS = {
    "thetao": {
        "dataset_id": "cmems_mod_glo_phy-thetao_anfc_0.083deg_P1D-m",
        "variables": ["thetao"],
        "filename": "forecast_thetao_{date}.nc",
        "depth": True,
    },
    "currents": {
        "dataset_id": "cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m",
        "variables": ["uo", "vo"],
        "filename": "forecast_currents_{date}.nc",
        "depth": True,
    },
    "salinity": {
        "dataset_id": "cmems_mod_glo_phy-so_anfc_0.083deg_P1D-m",
        "variables": ["so"],
        "filename": "forecast_salinity_{date}.nc",
        "depth": True,
    },
    "surface": {
        "dataset_id": "cmems_mod_glo_phy_anfc_0.083deg_P1D-m",
        "variables": ["mlotst", "zos"],
        "filename": "forecast_surface_{date}.nc",
        "depth": False,
    },
    "chl": {
        "dataset_id": "cmems_mod_glo_bgc-pft_anfc_0.25deg_P1D-m",
        "variables": ["chl"],
        "filename": "forecast_chl_{date}.nc",
        "depth": True,
    },
}


def parse_date(value: str) -> str:
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            f"Invalid date: {value}. Expected YYYY-MM-DD."
        ) from exc

    return parsed.isoformat()


def subset_dataset(
    *,
    dataset_id: str,
    variables: list[str],
    target_date: str,
    output_file: Path,
    use_depth: bool,
) -> None:
    if output_file.exists() and output_file.stat().st_size > 0:
        print(f"REUSE: {output_file}")
        return

    output_file.parent.mkdir(parents=True, exist_ok=True)

    command_kwargs = {
        "dataset_id": dataset_id,
        "variables": variables,
        "start_datetime": target_date,
        "end_datetime": target_date,
        "minimum_longitude": MIN_LON,
        "maximum_longitude": MAX_LON,
        "minimum_latitude": MIN_LAT,
        "maximum_latitude": MAX_LAT,
        "output_directory": str(output_file.parent),
        "output_filename": output_file.name,
    }

    if use_depth:
        command_kwargs["minimum_depth"] = MIN_DEPTH
        command_kwargs["maximum_depth"] = MAX_DEPTH

    print()
    print("DOWNLOAD")
    print(f"  Dataset : {dataset_id}")
    print(f"  Variables: {variables}")
    print(f"  Date    : {target_date}")
    print(f"  Output  : {output_file}")

    copernicusmarine.subset(**command_kwargs)

    if not output_file.exists() or output_file.stat().st_size == 0:
        raise RuntimeError(
            f"Copernicus download did not produce a valid file: {output_file}"
        )


def validate_input(
    path: Path,
    expected_variables: list[str],
    target_date: str,
) -> None:
    if not path.exists():
        raise FileNotFoundError(path)

    with xr.open_dataset(path) as ds:
        actual_variables = list(ds.data_vars)

        missing = [
            variable
            for variable in expected_variables
            if variable not in actual_variables
        ]

        if missing:
            raise ValueError(
                f"{path.name}: missing variables {missing}; "
                f"found {actual_variables}"
            )

        if "time" not in ds.coords:
            raise ValueError(f"{path.name}: missing time coordinate")

        times = ds.time.values

        if len(times) == 0:
            raise ValueError(f"{path.name}: empty time coordinate")

        requested = target_date
        actual = str(times[0])[:10]

        if actual != requested:
            raise ValueError(
                f"{path.name}: requested {requested}, found {actual}"
            )

        for coord in ("latitude", "longitude"):
            if coord not in ds.coords:
                raise ValueError(
                    f"{path.name}: missing coordinate {coord}"
                )

        print(
            f"VALID: {path.name} | "
            f"variables={actual_variables} | "
            f"date={actual}"
        )


def merge_physics(
    files: dict[str, Path],
    output_file: Path,
) -> None:
    if output_file.exists() and output_file.stat().st_size > 0:
        print(f"REUSE MERGED PHYSICS: {output_file}")
        return

    datasets = []

    try:
        for name in ("thetao", "currents", "salinity", "surface"):
            path = files[name]

            print(f"Loading Physics input: {path}")

            ds = xr.open_dataset(path)
            datasets.append(ds)

        reference = datasets[0]

        for ds in datasets[1:]:
            for coord in ("time", "latitude", "longitude"):
                if coord not in ds.coords:
                    raise ValueError(
                        f"Missing coordinate '{coord}' in Physics input"
                    )

            if not reference.time.equals(ds.time):
                raise ValueError("Physics time coordinates do not match.")

            if not reference.latitude.equals(ds.latitude):
                raise ValueError(
                    "Physics latitude coordinates do not match."
                )

            if not reference.longitude.equals(ds.longitude):
                raise ValueError(
                    "Physics longitude coordinates do not match."
                )

        merged = xr.merge(
            datasets,
            compat="no_conflicts",
        )

        required = [
            "thetao",
            "uo",
            "vo",
            "so",
            "mlotst",
            "zos",
        ]

        missing = [
            variable
            for variable in required
            if variable not in merged.data_vars
        ]

        if missing:
            raise ValueError(
                f"Merged Physics is missing variables: {missing}"
            )

        output_file.parent.mkdir(parents=True, exist_ok=True)

        merged.to_netcdf(output_file)

        merged.close()

    finally:
        for ds in datasets:
            ds.close()

    if not output_file.exists() or output_file.stat().st_size == 0:
        raise RuntimeError(
            f"Physics merge did not produce a valid file: {output_file}"
        )

    print(f"MERGED PHYSICS: {output_file}")


def acquire(target_date: str) -> dict[str, Path]:
    target_dir = OUTPUT_ROOT / target_date

    target_dir.mkdir(parents=True, exist_ok=True)

    files: dict[str, Path] = {}

    for name, config in DATASETS.items():
        filename = config["filename"].format(date=target_date)
        output_file = target_dir / filename

        subset_dataset(
            dataset_id=config["dataset_id"],
            variables=config["variables"],
            target_date=target_date,
            output_file=output_file,
            use_depth=config["depth"],
        )

        validate_input(
            output_file,
            config["variables"],
            target_date,
        )

        files[name] = output_file

    physics_output = target_dir / f"forecast_physics_{target_date}.nc"

    merge_physics(
        files,
        physics_output,
    )

    files["physics"] = physics_output

    return files


def main() -> None:
    parser = argparse.ArgumentParser(
        description="AquaGrid Copernicus Marine future-environment acquisition"
    )

    parser.add_argument(
        "--date",
        required=True,
        type=parse_date,
        help="Forecast date in YYYY-MM-DD format.",
    )

    args = parser.parse_args()

    print("=" * 80)
    print("AQUAGRID - COPERNICUS FUTURE ENVIRONMENT ACQUISITION")
    print("=" * 80)
    print(f"Date: {args.date}")
    print(f"Output root: {OUTPUT_ROOT}")

    files = acquire(args.date)

    print()
    print("=" * 80)
    print("ACQUISITION SUMMARY")
    print("=" * 80)

    for name, path in files.items():
        print(f"{name:10s}: {path}")

    print()
    print("AQUAGRID COPERNICUS ACQUISITION COMPLETED")
    print("=" * 80)


if __name__ == "__main__":
    main()
