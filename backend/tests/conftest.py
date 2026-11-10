import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import BACKEND_DIR, Config, Settings, load_config
from app.db import open_db
from app.main import create_app


@pytest.fixture(autouse=True)
def no_dev_login(monkeypatch):
    monkeypatch.delenv("EKSIGO_DEV_LOGIN", raising=False)


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(data_dir=tmp_path / "data", config_path=BACKEND_DIR / "config.yaml", public_base_url="https://api.test")


@pytest.fixture
def cfg() -> Config:
    return load_config(BACKEND_DIR / "config.yaml")


@pytest.fixture
def conn(settings) -> sqlite3.Connection:
    c = open_db(settings.db_path)
    yield c
    c.close()


@pytest.fixture
def client(settings, cfg):
    with TestClient(create_app(settings, cfg)) as c:
        yield c


def sign_in(settings, name="tester") -> dict[str, str]:
    """Headers of a signed-in account (a dev account, created straight in the database)."""
    from app import auth

    c = open_db(settings.db_path)
    try:
        return {"Authorization": f"Bearer {auth.create_session(c, auth.upsert_dev_user(c, name))}"}
    finally:
        c.close()


@pytest.fixture
def auth_headers(settings) -> dict[str, str]:
    return sign_in(settings)
