from pathlib import Path
import pandas as pd
import numpy as np
import xarray as xr


PFZ_FEATURES = [
    "sst_c",
    "current_u_ms",
    "current_v_ms",
    "current_speed_ms",
    "salinity_psu",
    "mixed_layer_m",
    "ssh_m",
    "chlorophyll_mg_m3",
]


DEFAULT_PHYSICS_MAP = {
    "sst_c": ("thetao", "surface"),
    "current_u_ms": ("uo", "surface"),
    "current_v_ms": ("vo", "surface"),
    "salinity_psu": ("so", "surface"),
    "mixed_layer_m": ("mlotst", None),
    "ssh_m": ("zos", None),
}


DEFAULT_BGC_MAP = {
    "chlorophyll_mg_m3": ("chl", "surface"),
}


def load_h3_grid(h3_file):
    df = pd.read_csv(h3_file)

    required = [
        "h3_index",
        "center_lat",
        "center_lon",
    ]

    missing = [c for c in required if c not in df.columns]

    if missing:
        raise ValueError(
            f"Missing H3 columns: {missing}"
        )

    return df[required].copy()


def select_time(ds, date, method="exact", tolerance=None):
    """
    Select the requested environmental time.

    method='exact':
        Requires an exact timestamp.

    method='nearest':
        Selects the nearest available timestamp and can optionally
        enforce a tolerance.
    """

    timestamp = np.datetime64(
        pd.Timestamp(date),
        "ns",
    )

    if method == "exact":
        return ds.sel(time=timestamp)

    if method == "nearest":
        kwargs = {
            "time": timestamp,
            "method": "nearest",
        }

        if tolerance is not None:
            kwargs["tolerance"] = tolerance

        return ds.sel(**kwargs)

    raise ValueError(
        "time method must be 'exact' or 'nearest'"
    )


def _resolve_depth(ds, depth_mode):
    if "depth" not in ds.dims and "depth" not in ds.coords:
        return None

    if depth_mode != "surface":
        return None

    return float(ds.depth.values[0])


def interpolate_variable(
    da,
    lat,
    lon,
):
    """
    Vectorized linear interpolation with nearest-neighbor fallback.
    """

    linear = da.interp(
        latitude=lat,
        longitude=lon,
        method="linear",
    )

    nearest = da.sel(
        latitude=lat,
        longitude=lon,
        method="nearest",
    )

    result = linear.where(
        linear.notnull(),
        nearest,
    )

    return result.values.astype(float)


def interpolate_environment(
    h3_grid,
    physics_file=None,
    bgc_file=None,
    date=None,
    physics_map=None,
    bgc_map=None,
    time_method="exact",
    time_tolerance=None,
    metadata=None,
):
    """
    Generic AquaGrid environmental interpolation engine.

    Inputs
    ------
    h3_grid:
        DataFrame containing h3_index, center_lat, center_lon.

    physics_file:
        Any compatible Physics NetCDF source.

    bgc_file:
        Any compatible Biogeochemistry NetCDF source.

    date:
        Requested valid environmental time.

    physics_map / bgc_map:
        Optional variable mappings allowing alternative NetCDF
        variable names.

    time_method:
        'exact' or 'nearest'.

    time_tolerance:
        Optional tolerance for nearest-time selection.

    metadata:
        Optional dictionary of provenance/forecast metadata.
        Examples:
            source_type='forecast'
            source_provider='Copernicus'
            forecast_initialization='2026-09-03'
            forecast_lead_days=3
    """

    if date is None:
        raise ValueError("date is required")

    physics_map = physics_map or DEFAULT_PHYSICS_MAP
    bgc_map = bgc_map or DEFAULT_BGC_MAP

    if physics_file is None:
        raise ValueError("physics_file is required")

    if bgc_file is None:
        raise ValueError("bgc_file is required")

    physics = xr.open_dataset(physics_file)
    bgc = xr.open_dataset(bgc_file)

    try:
        physics_day = select_time(
            physics,
            date,
            method=time_method,
            tolerance=time_tolerance,
        )

        bgc_day = select_time(
            bgc,
            date,
            method=time_method,
            tolerance=time_tolerance,
        )

        lat = xr.DataArray(
            h3_grid["center_lat"].values,
            dims="h3",
        )

        lon = xr.DataArray(
            h3_grid["center_lon"].values,
            dims="h3",
        )

        result = h3_grid.copy()

        # ----------------------------------------------------
        # Physics features
        # ----------------------------------------------------

        for output_name, (variable, depth_mode) in physics_map.items():

            if variable not in physics_day:
                raise ValueError(
                    f"Physics variable '{variable}' not found"
                )

            da = physics_day[variable]

            depth = _resolve_depth(
                physics_day,
                depth_mode,
            )

            if (
                depth is not None
                and "depth" in da.dims
            ):
                da = da.sel(depth=depth)

            result[output_name] = interpolate_variable(
                da,
                lat,
                lon,
            )

        # ----------------------------------------------------
        # BGC features
        # ----------------------------------------------------

        for output_name, (variable, depth_mode) in bgc_map.items():

            if variable not in bgc_day:
                raise ValueError(
                    f"BGC variable '{variable}' not found"
                )

            da = bgc_day[variable]

            depth = _resolve_depth(
                bgc_day,
                depth_mode,
            )

            if (
                depth is not None
                and "depth" in da.dims
            ):
                da = da.sel(depth=depth)

            result[output_name] = interpolate_variable(
                da,
                lat,
                lon,
            )

        # ----------------------------------------------------
        # Derived PFZ feature
        # ----------------------------------------------------

        if (
            "current_u_ms" in result.columns
            and "current_v_ms" in result.columns
        ):
            result["current_speed_ms"] = np.sqrt(
                result["current_u_ms"] ** 2
                +
                result["current_v_ms"] ** 2
            )

        # ----------------------------------------------------
        # Optional provenance / forecast metadata
        # ----------------------------------------------------

        if metadata:
            for key, value in metadata.items():
                result[key] = value

        # ----------------------------------------------------
        # Keep standardized PFZ feature order first
        # ----------------------------------------------------

        base_columns = [
            "h3_index",
            "center_lat",
            "center_lon",
        ]

        ordered_features = [
            f for f in PFZ_FEATURES
            if f in result.columns
        ]

        extra_columns = [
            c for c in result.columns
            if c not in base_columns + ordered_features
        ]

        result = result[
            base_columns
            + ordered_features
            + extra_columns
        ]

        return result

    finally:
        physics.close()
        bgc.close()


if __name__ == "__main__":

    import argparse

    parser = argparse.ArgumentParser(
        description="AquaGrid generic vectorized environmental interpolation engine"
    )

    parser.add_argument(
        "--h3",
        required=True,
        help="Path to H3 reference CSV"
    )

    parser.add_argument(
        "--physics",
        required=True,
        help="Path to Physics NetCDF"
    )

    parser.add_argument(
        "--bgc",
        required=True,
        help="Path to Biogeochemistry NetCDF"
    )

    parser.add_argument(
        "--date",
        required=True,
        help="Requested valid date, e.g. 2026-01-15"
    )

    parser.add_argument(
        "--output",
        required=True,
        help="Output Parquet path"
    )

    parser.add_argument(
        "--time-method",
        choices=["exact", "nearest"],
        default="exact",
        help="Environmental time-selection method"
    )

    parser.add_argument(
        "--source-type",
        default=None,
        help="Optional provenance, e.g. observed or forecast"
    )

    parser.add_argument(
        "--source-provider",
        default=None,
        help="Optional provenance, e.g. CMEMS or Copernicus"
    )

    parser.add_argument(
        "--forecast-initialization",
        default=None,
        help="Optional forecast initialization timestamp"
    )

    parser.add_argument(
        "--forecast-lead-days",
        type=float,
        default=None,
        help="Optional forecast lead time in days"
    )

    args = parser.parse_args()

    print("=" * 80)
    print("AQUAGRID - GENERIC VECTORIZED INTERPOLATION ENGINE")
    print("=" * 80)

    print("\nInputs:")
    print(f"H3 grid     : {args.h3}")
    print(f"Physics     : {args.physics}")
    print(f"BGC         : {args.bgc}")
    print(f"Valid date  : {args.date}")
    print(f"Time method : {args.time_method}")

    h3 = load_h3_grid(args.h3)

    print(f"\nH3 cells: {len(h3):,}")

    metadata = {}

    if args.source_type is not None:
        metadata["source_type"] = args.source_type

    if args.source_provider is not None:
        metadata["source_provider"] = args.source_provider

    if args.forecast_initialization is not None:
        metadata["forecast_initialization"] = args.forecast_initialization

    if args.forecast_lead_days is not None:
        metadata["forecast_lead_days"] = args.forecast_lead_days

    result = interpolate_environment(
        h3_grid=h3,
        physics_file=args.physics,
        bgc_file=args.bgc,
        date=args.date,
        time_method=args.time_method,
        metadata=metadata if metadata else None,
    )

    print("\nOutput rows:")
    print(f"{len(result):,}")

    print("\nOutput columns:")
    print(result.columns.tolist())

    print("\nMissing values:")
    print(result[PFZ_FEATURES].isna().sum())

    output = Path(args.output)
    output.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    result.to_parquet(
        output,
        index=False,
    )

    print("\nSaved:")
    print(output.resolve())

    print("\n" + "=" * 80)
    print("M2 GENERIC ENGINE COMPLETED")
    print("=" * 80)
