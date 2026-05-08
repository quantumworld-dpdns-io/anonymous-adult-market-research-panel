import logging
from typing import List, Optional, Tuple, Union

import numpy as np
from flwr.common import (
    FitRes,
    Parameters,
    Scalar,
    ndarrays_to_parameters,
    parameters_to_ndarrays,
)
from flwr.server.client_proxy import ClientProxy
from flwr.server.strategy import FedAvg

from privacy.budget_tracker import BudgetTracker
from privacy.differential_privacy import add_gaussian_noise

logger = logging.getLogger(__name__)


class BudgetExhaustedError(RuntimeError):
    pass


class DPFedAvgStrategy(FedAvg):
    """FedAvg with per-round Gaussian DP noise and ε-budget enforcement."""

    def __init__(
        self,
        study_id: str,
        epsilon: float = 1.0,
        delta: float = 1e-5,
        sensitivity: float = 1.0,
        **kwargs,
    ) -> None:
        super().__init__(**kwargs)
        self.study_id = study_id
        self.epsilon = epsilon
        self.delta = delta
        self.sensitivity = sensitivity
        self.budget_tracker = BudgetTracker(study_id)

    def aggregate_fit(
        self,
        server_round: int,
        results: List[Tuple[ClientProxy, FitRes]],
        failures: List[Union[Tuple[ClientProxy, FitRes], BaseException]],
    ) -> Tuple[Optional[Parameters], dict[str, Scalar]]:
        if not self.budget_tracker.can_run_round(self.epsilon):
            raise BudgetExhaustedError(
                f"DP budget exhausted for study {self.study_id}. "
                f"Remaining: {self.budget_tracker.remaining_budget:.4f}ε"
            )

        if failures:
            logger.warning(
                "Round %d: %d client failures for study %s",
                server_round, len(failures), self.study_id,
            )

        aggregated_params, metrics = super().aggregate_fit(server_round, results, failures)

        if aggregated_params is not None:
            arrays = parameters_to_ndarrays(aggregated_params)
            noisy_arrays = [
                add_gaussian_noise(arr, self.sensitivity, self.epsilon, self.delta)
                for arr in arrays
            ]
            aggregated_params = ndarrays_to_parameters(noisy_arrays)
            self.budget_tracker.record_round(self.epsilon)
            logger.info(
                "Round %d complete. ε spent this round: %.2f. Remaining: %.2f",
                server_round, self.epsilon, self.budget_tracker.remaining_budget,
            )

        return aggregated_params, metrics
