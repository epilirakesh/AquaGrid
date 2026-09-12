from pathlib import Path
import argparse

import joblib
import numpy as np
import pandas as pd


FEATURES = [
    "sst_c",
    "current_u_ms",
    "current_v_ms",
    "current_speed_ms",
    "salinity_psu",
    "mixed_layer_m",
    "ssh_m",
    "chlorophyll_mg_m3",
]

THRESHOLD = 0.20


def main():

    parser = argparse.ArgumentParser(
        description="AquaGrid M8 Future PFZ Prediction Engine"
    )

    parser.add_argument("--environment", required=True)
    parser.add_argument(
        "--model",
        default="ml/models/random_forest_full.pkl",
    )
    parser.add_argument("--date", required=True)
    parser.add_argument("--output", required=True)

    parser.add_argument(
        "--source-type",
        default="forecast",
    )

    parser.add_argument(
        "--source-provider",
        default="Copernicus",
    )

    args = parser.parse_args()

    print("=" * 80)
    print("AQUAGRID - M8 FUTURE PFZ PREDICTION ENGINE")
    print("=" * 80)

    # --------------------------------------------------------
    # Load environment
    # --------------------------------------------------------

    env_path = Path(args.environment)

    if not env_path.exists():
        raise FileNotFoundError(
            f"Environment file not found: {env_path}"
        )

    grid = pd.read_parquet(
        env_path
    )

    print(
        f"\nEnvironment rows: {len(grid):,}"
    )

    # --------------------------------------------------------
    # Validate features
    # --------------------------------------------------------

    missing_columns = [
        c for c in FEATURES
        if c not in grid.columns
    ]

    if missing_columns:
        raise ValueError(
            f"Missing M2 features: {missing_columns}"
        )

    # --------------------------------------------------------
    # Load frozen PFZ model
    # --------------------------------------------------------

    model_path = Path(args.model)

    if not model_path.exists():
        raise FileNotFoundError(
            f"Model not found: {model_path}"
        )

    model = joblib.load(
        model_path
    )

    model_features = list(
        getattr(
            model,
            "feature_names_in_",
            [],
        )
    )

    if model_features != FEATURES:
        raise ValueError(
            "PFZ model feature order does not match M2 "
            f"feature contract.\n"
            f"Expected: {FEATURES}\n"
            f"Model:    {model_features}"
        )

    print(
        f"Model: {type(model).__name__}"
    )

    print(
        f"Trees: {getattr(model, 'n_estimators', 'N/A')}"
    )

    print(
        f"Threshold: {THRESHOLD}"
    )

    # --------------------------------------------------------
    # Feature completeness
    # --------------------------------------------------------

    complete = (
        grid[FEATURES]
        .notna()
        .all(axis=1)
    )

    print(
        f"\nRF usable cells : {complete.sum():,}"
    )

    print(
        f"Unavailable     : {(~complete).sum():,}"
    )

    # --------------------------------------------------------
    # Initialize outputs
    # --------------------------------------------------------

    grid["pfz_probability"] = np.nan

    grid["pfz_prediction"] = np.nan

    grid["confidence"] = "Unavailable"

    grid["prediction_status"] = (
        "incomplete_features"
    )

    # --------------------------------------------------------
    # Predict usable cells only
    # --------------------------------------------------------

    if complete.any():

        X = grid.loc[
            complete,
            FEATURES,
        ]

        probability = model.predict_proba(
            X
        )[:, 1]

        prediction = (
            probability >= THRESHOLD
        ).astype(int)

        confidence = pd.cut(
            probability,
            bins=[
                0.0,
                0.20,
                0.50,
                0.75,
                1.00,
            ],
            labels=[
                "Low Potential",
                "Moderate Opportunity",
                "Recommended",
                "High Confidence",
            ],
            include_lowest=True,
        )

        grid.loc[
            complete,
            "pfz_probability",
        ] = probability

        grid.loc[
            complete,
            "pfz_prediction",
        ] = prediction

        grid.loc[
            complete,
            "confidence",
        ] = confidence.astype(str)

        grid.loc[
            complete,
            "prediction_status",
        ] = "complete_features"

    # --------------------------------------------------------
    # Forecast metadata
    # --------------------------------------------------------

    grid["prediction_date"] = pd.Timestamp(
        args.date
    )

    grid["source_type"] = (
        args.source_type
    )

    grid["source_provider"] = (
        args.source_provider
    )

    # --------------------------------------------------------
    # Standard output order
    # --------------------------------------------------------

    base_columns = [
        "prediction_date",
        "h3_index",
        "center_lat",
        "center_lon",
        "pfz_probability",
        "pfz_prediction",
        "confidence",
        "prediction_status",
    ]

    metadata_columns = [
        "source_type",
        "source_provider",
    ]

    output_columns = (
        base_columns
        + FEATURES
        + metadata_columns
    )

    output = grid[
        output_columns
    ].copy()

    # --------------------------------------------------------
    # Save
    # --------------------------------------------------------

    output_path = Path(
        args.output
    )

    output_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    output.to_parquet(
        output_path,
        index=False,
    )

    # --------------------------------------------------------
    # Summary
    # --------------------------------------------------------

    print("\n" + "=" * 80)
    print("M8 FUTURE PFZ SUMMARY")
    print("=" * 80)

    print(
        f"\nPrediction date   : {args.date}"
    )

    print(
        f"Total H3 cells    : {len(output):,}"
    )

    print(
        f"RF usable         : {complete.sum():,}"
    )

    print(
        f"Unavailable       : {(~complete).sum():,}"
    )

    print(
        f"AI PFZ rows       : "
        f"{int((output['pfz_prediction'] == 1).sum()):,}"
    )

    if complete.any():

        print(
            f"Mean probability : "
            f"{output.loc[complete, 'pfz_probability'].mean():.6f}"
        )

        print(
            f"Max probability  : "
            f"{output.loc[complete, 'pfz_probability'].max():.6f}"
        )

    print(
        f"\nSource type       : {args.source_type}"
    )

    print(
        f"Source provider   : {args.source_provider}"
    )

    print(
        f"\nSaved:\n{output_path.resolve()}"
    )

    print("\n" + "=" * 80)
    print("M8 FUTURE PFZ ENGINE COMPLETED")
    print("=" * 80)


if __name__ == "__main__":
    main()
