"""Environment-based config. No hardcoded secrets."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    embedding_model: str = "openai/text-embedding-3-large"
    embedding_dim: int = 3072
    llm_model: str = "deepseek/deepseek-v4-flash"
    vision_model: str = "google/gemini-3-flash-preview"  # answers + captions when a chat image is attached
    rerank_model: str = "cohere/rerank-v3.5"
    # Out-of-scope gate: min dense cosine of query vs corpus to allow an answer.
    relevance_threshold: float = 0.22

    # ── Auth (self-contained JWT + RBAC; no external IdP) ──
    # OFF by default so the app runs open until you enable it.
    auth_enabled: bool = False
    auth_secret: str = "dev-only-change-me"          # HS256 signing key (set a strong value in prod)
    auth_token_ttl_hours: int = 12
    auth_admin_user: str = "admin"                    # first admin, seeded on startup if no users exist
    auth_admin_password: str = "admin"                # CHANGE THIS — seeded once, then edit via user mgmt

    # Langfuse observability (optional — tracing is a no-op if unset).
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_host: str = "https://us.cloud.langfuse.com"

    # Deepgram Aura TTS (Audio Overview). Free $200 credit at deepgram.com.
    deepgram_api_key: str = ""
    tts_voice_host: str = "aura-2-thalia-en"
    tts_voice_guest: str = "aura-2-apollo-en"

    qdrant_url: str = "http://qdrant:6333"
    qdrant_api_key: str = ""
    qdrant_collection: str = "ccragos_chunks"

    neo4j_uri: str = "bolt://neo4j:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = ""

    # Browser origins allowed to call the viz endpoints.
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]


settings = Settings()
