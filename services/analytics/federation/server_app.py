from flwr.server import ServerApp, ServerConfig

from federation.strategy import DPFedAvgStrategy


def make_server_app(study_id: str, num_rounds: int = 1) -> ServerApp:
    strategy = DPFedAvgStrategy(
        study_id=study_id,
        epsilon=1.0,
        delta=1e-5,
        sensitivity=1.0,
        min_fit_clients=3,
        min_evaluate_clients=3,
        min_available_clients=3,
        fraction_fit=1.0,
        fraction_evaluate=0.0,
    )
    return ServerApp(
        config=ServerConfig(num_rounds=num_rounds),
        strategy=strategy,
    )
