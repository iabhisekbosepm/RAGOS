"""Environment-based config. No hardcoded secrets."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    embedding_model: str = "openai/text-embedding-3-large"
    embedding_dim: int = 3072
    vision_model: str = "google/gemini-3-flash-preview"
    llm_model: str = "deepseek/deepseek-v4-flash"  # for contextual-retrieval doc summaries

    qdrant_url: str = "http://qdrant:6333"
    qdrant_api_key: str = ""
    qdrant_collection: str = "ccragos_chunks"

    # Browser origins allowed to call this service (matches the retriever's setting).
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]

    # Character-based, structure-aware chunking.
    chunk_size: int = 1200
    chunk_overlap: int = 200

    # Langfuse observability (optional — no-op if unset).
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_host: str = "https://us.cloud.langfuse.com"

    # Auth — shares the retriever's JWT secret. Upload requires the 'editor' role.
    # OFF by default → ingestion stays open (matches retriever default).
    auth_enabled: bool = False
    auth_secret: str = "dev-only-change-me"


settings = Settings()
