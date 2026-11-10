"""Settings: paths and switches from environment variables, everything else from config.yaml."""

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel

BACKEND_DIR = Path(__file__).resolve().parent.parent


class AuthConfig(BaseModel):
    """Sign in with Apple and Google (DESIGN.md section 8)."""

    # Apple identity tokens' audience: the iPhone app's bundle ID (later also the desktop's Services ID).
    apple_audiences: list[str] = ["com.eksigo.app"]
    # Google ID tokens' audience: the apps' OAuth client IDs (not secret). Empty: Google sign-in is off.
    google_client_ids: list[str] = []
    # A session unused for this long must sign in again.
    session_idle_days: int = 180


class Config(BaseModel):
    auth: AuthConfig = AuthConfig()


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    config_path: Path
    public_base_url: str

    @property
    def db_path(self) -> Path:
        return self.data_dir / "app.db"


def load_settings() -> Settings:
    return Settings(
        data_dir=Path(os.environ.get("EKSIGO_DATA_DIR", BACKEND_DIR / "data")),
        config_path=Path(os.environ.get("EKSIGO_CONFIG", BACKEND_DIR / "config.yaml")),
        public_base_url=os.environ.get("EKSIGO_PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/"),
    )


def load_config(path: Path) -> Config:
    return Config.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")) or {})


@lru_cache
def get_settings() -> Settings:
    return load_settings()


@lru_cache
def get_config() -> Config:
    return load_config(get_settings().config_path)
