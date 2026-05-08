import numpy as np
from scipy import stats


def validate_uniformity(samples: list[int], max_value: int, alpha: float = 0.05) -> float:
    """
    Chi-squared goodness-of-fit test for uniform distribution over [0, max_value).

    Returns p-value. A p-value > alpha means we cannot reject the null hypothesis
    of uniformity at the given significance level.

    Returns 1.0 if there is insufficient data to run the test (< 2 bins with
    expected count >= 5).
    """
    if not samples or max_value < 2:
        return 1.0

    observed = np.bincount(np.array(samples, dtype=int), minlength=max_value)
    expected_per_bin = len(samples) / max_value
    expected = np.full(max_value, expected_per_bin)

    mask = expected >= 5
    if mask.sum() < 2:
        return 1.0

    _, p_value = stats.chisquare(observed[mask], f_exp=expected[mask])
    return float(p_value)
