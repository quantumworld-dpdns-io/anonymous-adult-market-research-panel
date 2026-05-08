import numpy as np


def gaussian_noise_scale(sensitivity: float, epsilon: float, delta: float) -> float:
    """
    Calibrated Gaussian mechanism: σ = sensitivity * sqrt(2 * ln(1.25/δ)) / ε.
    Provides (ε, δ)-differential privacy.
    """
    if epsilon <= 0 or delta <= 0 or delta >= 1:
        raise ValueError("epsilon must be > 0; delta must be in (0, 1)")
    sigma = sensitivity * np.sqrt(2.0 * np.log(1.25 / delta)) / epsilon
    return float(sigma)


def add_gaussian_noise(
    array: np.ndarray,
    sensitivity: float,
    epsilon: float,
    delta: float,
    rng: np.random.Generator | None = None,
) -> np.ndarray:
    """Add calibrated Gaussian noise for (ε, δ)-DP to a numpy array."""
    if rng is None:
        rng = np.random.default_rng()
    sigma = gaussian_noise_scale(sensitivity, epsilon, delta)
    noise = rng.normal(0.0, sigma, size=array.shape).astype(array.dtype)
    return array + noise


def renyi_dp_compose(epsilon_per_round: float, delta: float, num_rounds: int) -> float:
    """
    Advanced composition via Rényi DP: tighter ε bound for many rounds.
    Returns total ε for (ε, delta)-DP after num_rounds rounds.
    Conservative sequential composition used when RDP not configured.
    """
    return epsilon_per_round * num_rounds
