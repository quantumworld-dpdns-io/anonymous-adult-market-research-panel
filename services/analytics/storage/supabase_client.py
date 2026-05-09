import asyncio
import base64
import json
import logging
import os
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")


def _get_client():
    from supabase import create_client
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


async def decrypt_and_fetch_shard(
    study_id: str,
    decryption_key: bytes,
) -> list[dict]:
    """Fetch encrypted responses for study and decrypt with AES-256-GCM."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _decrypt_and_fetch_shard_sync, study_id, decryption_key)


def _decrypt_and_fetch_shard_sync(study_id: str, decryption_key: bytes) -> list[dict]:
    client = _get_client()
    resp = (
        client.table("encrypted_responses")
        .select("encrypted_payload,nonce")
        .eq("study_id", study_id)
        .execute()
    )

    aesgcm = AESGCM(decryption_key)
    responses: list[dict] = []

    for row in (resp.data or []):
        try:
            nonce = base64.b64decode(row["nonce"])
            ciphertext = base64.b64decode(row["encrypted_payload"])
            plaintext = aesgcm.decrypt(nonce, ciphertext, study_id.encode())
            responses.append(json.loads(plaintext))
        except Exception as exc:
            logger.warning("Failed to decrypt response row: %s", exc)

    return responses


async def get_question_schema(study_id: str) -> list[dict]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, get_question_schema_sync, study_id)


def get_question_schema_sync(study_id: str) -> list[dict]:
    client = _get_client()
    resp = (
        client.table("study_questions")
        .select("id,text,question_type,options,position")
        .eq("study_id", study_id)
        .order("position")
        .execute()
    )
    return resp.data or []


async def get_shard_keys_for_study(study_id: str) -> list[bytes]:
    """
    Retrieve per-shard decryption keys from secrets manager.
    In production, fetch from AWS Secrets Manager / Vault.
    In development, returns a single dev key.
    """
    env = os.getenv("ENVIRONMENT", "development")
    if env != "production":
        dev_key = b"\x00" * 32
        return [dev_key, dev_key, dev_key]

    # Production: fetch per-study shard keys from AWS Secrets Manager.
    # Secret name pattern: panel/study/{study_id}/shard-keys
    # Secret value: JSON array of base64-encoded 32-byte keys, one per FL shard.
    import boto3
    import base64

    secret_name = f"panel/study/{study_id}/shard-keys"
    region = os.getenv("AWS_REGION", "us-east-1")
    client_sm = boto3.client("secretsmanager", region_name=region)
    try:
        resp = client_sm.get_secret_value(SecretId=secret_name)
        raw = resp.get("SecretString") or base64.b64decode(resp["SecretBinary"]).decode()
        key_list: list[str] = json.loads(raw)
        return [base64.b64decode(k) for k in key_list]
    except client_sm.exceptions.ResourceNotFoundException:
        raise ValueError(f"Shard keys not found in Secrets Manager for study {study_id}") from None
    except Exception as exc:
        raise RuntimeError(f"Failed to retrieve shard keys from Secrets Manager: {exc}") from exc


async def get_active_studies_above_threshold(min_responses: int = 50) -> list[Any]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None, _get_active_studies_sync, min_responses
    )


def _get_active_studies_sync(min_responses: int) -> list[Any]:
    client = _get_client()
    resp = client.table("studies").select("id,min_responses").eq("status", "active").execute()
    studies = []
    for s in (resp.data or []):
        count_resp = (
            client.table("encrypted_responses")
            .select("id", count="exact")
            .eq("study_id", s["id"])
            .execute()
        )
        if (count_resp.count or 0) >= min_responses:
            studies.append(type("Study", (), {"id": s["id"]})())
    return studies


async def log_federation_round(
    study_id: str,
    round_num: int,
    num_clients: int,
    epsilon_spent: float,
    epsilon_remaining: float,
) -> None:
    logger.info(
        "Federation round %d completed for study %s | clients=%d | ε_spent=%.2f | ε_remaining=%.2f",
        round_num, study_id, num_clients, epsilon_spent, epsilon_remaining,
    )
