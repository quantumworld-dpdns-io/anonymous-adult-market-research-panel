use std::sync::Arc;
use crate::{
    config::Config,
    nullifier::NullifierRegistry,
    token::TokenIssuer,
    zk::{AgeVerifier, CredentialIssuer, DateSigner},
};

#[derive(Clone)]
pub struct AppState {
    pub age_verifier: Arc<AgeVerifier>,
    pub credential_issuer: Arc<CredentialIssuer>,
    pub date_signer: Arc<DateSigner>,
    pub nullifier_registry: Arc<NullifierRegistry>,
    pub token_issuer: Arc<TokenIssuer>,
    pub config: Arc<Config>,
}

impl AppState {
    pub async fn new(config: Config) -> anyhow::Result<Self> {
        let redis_client = redis::Client::open(config.redis_url.as_str())?;
        let redis_conn = redis_client.get_multiplexed_tokio_connection().await?;

        let age_verifier = AgeVerifier::new()?;
        let credential_issuer = CredentialIssuer::new(&config)?;
        let date_signer = DateSigner::new(&config.ml_dsa_signing_key)?;
        let nullifier_registry = NullifierRegistry::new(
            redis_conn,
            config.supabase_url.clone(),
            config.supabase_service_key.clone(),
        );
        let token_issuer = TokenIssuer::new(config.zk_token_secret.as_bytes());

        Ok(Self {
            age_verifier: Arc::new(age_verifier),
            credential_issuer: Arc::new(credential_issuer),
            date_signer: Arc::new(date_signer),
            nullifier_registry: Arc::new(nullifier_registry),
            token_issuer: Arc::new(token_issuer),
            config: Arc::new(config),
        })
    }
}
