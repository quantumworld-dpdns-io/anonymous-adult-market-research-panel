import numpy as np


def assign_strata(
    selected_indices: list[int],
    strata_weights: list[float],
    n_samples: int,
    backend=None,
    shots: int = 4096,
) -> list[int]:
    """
    Assign each selected index to a stratum proportional to strata_weights.

    Uses quantum stratified sampling when backend is provided, otherwise falls
    back to classical multinomial assignment.

    Returns a list of stratum indices (0-based) parallel to selected_indices.
    """
    if not selected_indices:
        return []

    if backend is not None:
        from circuits.stratified_sampler import sample_strata_assignments
        return sample_strata_assignments(strata_weights, len(selected_indices), backend, shots)

    # Classical fallback: multinomial draw
    rng = np.random.default_rng()
    counts = rng.multinomial(len(selected_indices), strata_weights)
    assignments: list[int] = []
    for stratum_idx, count in enumerate(counts):
        assignments.extend([stratum_idx] * int(count))
    rng.shuffle(assignments)
    return assignments[: len(selected_indices)]
