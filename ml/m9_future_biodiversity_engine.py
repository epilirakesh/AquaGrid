from pathlib import Path
import argparse

import joblib
import numpy as np
import pandas as pd

from vectorized_interpolation_engine import (
    load_h3_grid,
    interpolate_environment,
)


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


CONFIDENCE_MIN = 0.05


def calculate_mess(reference, evaluation):
    """
    Environmental similarity relative to the temporal-training
    environment.

    Negative values indicate novelty outside the reference
    distribution; larger positive values indicate greater
    similarity.
    """

    reference = np.asarray(reference, dtype=float)
    evaluation = np.asarray(evaluation, dtype=float)

    scores = np.zeros(
        (len(evaluation), reference.shape[1]),
        dtype=float,
    )

    for j in range(reference.shape[1]):

        ref = np.sort(reference[:, j])
        values = evaluation[:, j]

        lo = ref[0]
        hi = ref[-1]

        if hi == lo:
            scores[:, j] = 100.0
            continue

        pct = (
            np.searchsorted(
                ref,
                values,
                side="left",
            )
            / len(ref)
            * 100.0
        )

        similarity = np.where(
            pct == 0,
            (values - lo) / (hi - lo) * 100.0,
            np.where(
                pct <= 50,
                2.0 * pct,
                np.where(
                    pct < 100,
                    2.0 * (100.0 - pct),
                    (hi - values) / (hi - lo) * 100.0,
                ),
            ),
        )

        scores[:, j] = similarity

    return np.min(scores, axis=1)


def mess_to_confidence(mess_scores):
    """
    Preserve the project's existing MESS-to-confidence
    transformation.
    """

    confidence = np.clip(
        (mess_scores + 20.0) / 120.0,
        CONFIDENCE_MIN,
        1.0,
    )

    return confidence


def main():

    parser = argparse.ArgumentParser(
        description="AquaGrid M9 Future Biodiversity Engine"
    )

    parser.add_argument(
        "--h3",
        required=True,
    )

    parser.add_argument(
        "--physics",
        required=True,
    )

    parser.add_argument(
        "--bgc",
        required=True,
    )

    parser.add_argument(
        "--model",
        default="ml/m9_validation/temporal_sdm_2023_2024.pkl",
    )

    parser.add_argument(
        "--reference",
        default="ml/m9_validation/temporal_train_2023_2024.parquet",
    )

    parser.add_argument(
        "--date",
        required=True,
    )

    parser.add_argument(
        "--output",
        required=True,
    )

    parser.add_argument(
        "--source-type",
        default="forecast",
    )

    parser.add_argument(
        "--source-provider",
        default="Copernicus",
    )

    parser.add_argument(
        "--time-method",
        choices=["exact", "nearest"],
        default="nearest",
    )

    parser.add_argument(
        "--time-tolerance",
        default=None,
    )

    args = parser.parse_args()

    print("=" * 80)
    print("AQUAGRID - M9 FUTURE BIODIVERSITY ENGINE")
    print("=" * 80)

    # --------------------------------------------------------
    # Load H3
    # --------------------------------------------------------

    h3_grid = load_h3_grid(
        args.h3
    )

    print(
        f"\nH3 cells: {len(h3_grid):,}"
    )

    # --------------------------------------------------------
    # Load validated temporal model
    # --------------------------------------------------------

    model = joblib.load(
        args.model
    )

    if list(
        model.feature_names_in_
    ) != FEATURES:
        raise ValueError(
            "M9 model feature order does not match "
            "the official M2 feature contract."
        )

    print(
        f"M9 model: {type(model).__name__}"
    )

    print(
        f"Features: {list(model.feature_names_in_)}"
    )

    # --------------------------------------------------------
    # Load temporal reference environment
    # --------------------------------------------------------

    reference = pd.read_parquet(
        args.reference,
        columns=FEATURES,
    )

    reference_complete = reference[
        FEATURES
    ].notna().all(axis=1)

    if not reference_complete.any():
        raise ValueError(
            "Temporal reference contains no complete feature rows."
        )

    reference_X = reference.loc[
        reference_complete,
        FEATURES,
    ].to_numpy(dtype=float)

    print(
        f"MESS reference rows: "
        f"{len(reference_X):,}"
    )

    # --------------------------------------------------------
    # Official M2 environmental interpolation
    # --------------------------------------------------------

    metadata = {
        "source_type": args.source_type,
        "source_provider": args.source_provider,
        "environment_date": args.date,
    }

    environment = interpolate_environment(
        h3_grid=h3_grid,
        physics_file=args.physics,
        bgc_file=args.bgc,
        date=args.date,
        time_method=args.time_method,
        time_tolerance=args.time_tolerance,
        metadata=metadata,
    )

    # --------------------------------------------------------
    # Feature completeness
    # --------------------------------------------------------

    complete = (
        environment[FEATURES]
        .notna()
        .all(axis=1)
    )

    print(
        f"\nComplete environmental cells: "
        f"{complete.sum():,}"
    )

    print(
        f"Incomplete environmental cells: "
        f"{(~complete).sum():,}"
    )

    # --------------------------------------------------------
    # Initialize outputs
    # --------------------------------------------------------

    environment[
        "predicted_biodiversity_index"
    ] = np.nan

    environment[
        "biodiversity_hotspot_likelihood"
    ] = np.nan

    environment[
        "mess_similarity"
    ] = np.nan

    environment[
        "confidence_score"
    ] = np.nan

    environment[
        "prediction_status"
    ] = "incomplete_features"

    # --------------------------------------------------------
    # Prediction
    # --------------------------------------------------------

    if complete.any():

        X = environment.loc[
            complete,
            FEATURES,
        ]

        probability = model.predict_proba(
            X
        )[:, 1]

        mess_scores = calculate_mess(
            reference_X,
            X.to_numpy(dtype=float),
        )

        confidence = mess_to_confidence(
            mess_scores
        )

        environment.loc[
            complete,
            "predicted_biodiversity_index",
        ] = np.round(
            probability,
            4,
        )

        environment.loc[
            complete,
            "biodiversity_hotspot_likelihood",
        ] = np.round(
            probability,
            4,
        )

        environment.loc[
            complete,
            "mess_similarity",
        ] = np.round(
            mess_scores,
            2,
        )

        environment.loc[
            complete,
            "confidence_score",
        ] = np.round(
            confidence,
            4,
        )

        environment.loc[
            complete,
            "prediction_status",
        ] = "complete_features"

    # --------------------------------------------------------
    # Forecast metadata
    # --------------------------------------------------------

    environment[
        "prediction_date"
    ] = pd.Timestamp(
        args.date
    )

    environment[
        "forecast_horizon_days"
    ] = np.nan

    environment[
        "model_type"
    ] = "temporal_sdm"

    environment[
        "model_training_period"
    ] = "2023-2024"

    environment[
        "validation_period"
    ] = "2025"

    # --------------------------------------------------------
    # Final column order
    # --------------------------------------------------------

    columns = [
        "prediction_date",
        "h3_index",
        "center_lat",
        "center_lon",
        "predicted_biodiversity_index",
        "biodiversity_hotspot_likelihood",
        "mess_similarity",
        "confidence_score",
        "prediction_status",
        *FEATURES,
        "source_type",
        "source_provider",
        "environment_date",
        "forecast_horizon_days",
        "model_type",
        "model_training_period",
        "validation_period",
    ]

    result = environment[
        columns
    ].copy()

    # --------------------------------------------------------
    # Save
    # --------------------------------------------------------

    output = Path(
        args.output
    )

    output.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    result.to_parquet(
        output,
        index=False,
    )

    # --------------------------------------------------------
    # Summary
    # --------------------------------------------------------

    print("\n" + "=" * 80)
    print("M9 FUTURE BIODIVERSITY SUMMARY")
    print("=" * 80)

    print(
        f"\nPrediction date          : "
        f"{args.date}"
    )

    print(
        f"Total H3 cells           : "
        f"{len(result):,}"
    )

    print(
        f"Complete feature cells  : "
        f"{complete.sum():,}"
    )

    print(
        f"Incomplete cells         : "
        f"{(~complete).sum():,}"
    )

    if complete.any():

        print(
            f"Mean biodiversity index : "
            f"{result.loc[complete, 'predicted_biodiversity_index'].mean():.4f}"
        )

        print(
            f"Max biodiversity index  : "
            f"{result.loc[complete, 'predicted_biodiversity_index'].max():.4f}"
        )

        print(
            f"Mean MESS confidence    : "
            f"{result.loc[complete, 'confidence_score'].mean():.4f}"
        )

    print(
        f"\nSource type              : "
        f"{args.source_type}"
    )

    print(
        f"Source provider          : "
        f"{args.source_provider}"
    )

    print(
        f"\nSaved:\n{output.resolve()}"
    )

    print("\n" + "=" * 80)
    print("M9 FUTURE BIODIVERSITY ENGINE COMPLETED")
    print("=" * 80)


if __name__ == "__main__":
    main()
