"""The API (docs/API.md): accounts, offline dictionaries and cover art. Sync and Premium AI come later
(DESIGN.md section 13)."""

import hashlib
import json
import logging
import sqlite3
from collections.abc import Iterator
from contextlib import asynccontextmanager
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from app import artwork, auth, dictionaries
from app.config import Config, Settings, get_config, get_settings
from app.db import connect, open_db
from app.errors import APIError, install_error_handlers

log = logging.getLogger("api")


class AppleSignIn(BaseModel):
    identity_token: str = Field(min_length=20, max_length=8000)
    # The raw nonce the app put (hashed) into the Apple request; guards against replayed tokens.
    nonce: str | None = Field(default=None, max_length=200)
    # Apple gives the app the name only on the very first sign-in.
    name: str | None = Field(default=None, max_length=100)


class GoogleSignIn(BaseModel):
    id_token: str = Field(min_length=20, max_length=8000)


class DevSignIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)


def json_response(request: Request, data: Any) -> Response:
    """JSON with an ETag; answers 304 when the app already has this exact response."""
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()
    etag = '"' + hashlib.sha1(body).hexdigest()[:20] + '"'
    headers = {"ETag": etag, "Cache-Control": "no-cache"}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return Response(body, media_type="application/json", headers=headers)


def create_app(settings: Settings | None = None, cfg: Config | None = None) -> FastAPI:
    settings = settings or get_settings()
    cfg = cfg or get_config()
    apple_keys = auth.AppleKeys()
    google_keys = auth.GoogleKeys()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        open_db(settings.db_path).close()  # apply migrations once at startup
        yield

    app = FastAPI(title="Eksigo API", version="2", lifespan=lifespan,
                  docs_url="/v1/docs", openapi_url="/v1/openapi.json", redoc_url=None)  # fmt: skip
    install_error_handlers(app)

    def db() -> Iterator[sqlite3.Connection]:
        conn = connect(settings.db_path)
        try:
            yield conn
        finally:
            conn.close()

    DB = Annotated[sqlite3.Connection, Depends(db)]
    Authorization = Annotated[str | None, Header()]

    def signed_in(conn: sqlite3.Connection, token: str) -> dict[str, Any]:
        return {"token": token, "user": auth.user_json(auth.require_user(conn, cfg, f"Bearer {token}"))}

    @app.get("/v1/health")
    def health():
        return {"status": "ok"}

    # ------------------------------------------------------------ accounts (DESIGN.md section 8)

    @app.post("/v1/auth/apple")
    def sign_in_apple(conn: DB, body: AppleSignIn):
        claims = auth.verify_apple_token(body.identity_token, body.nonce, cfg, apple_keys)
        user_id = auth.upsert_apple_user(conn, claims["sub"], claims.get("email"), (body.name or "").strip() or None)
        return signed_in(conn, auth.create_session(conn, user_id))

    @app.post("/v1/auth/google")
    def sign_in_google(conn: DB, body: GoogleSignIn):
        claims = auth.verify_google_token(body.id_token, cfg, google_keys)
        email = claims.get("email") if claims.get("email_verified") else None
        user_id = auth.upsert_google_user(conn, claims["sub"], email, (claims.get("name") or "").strip() or None)
        return signed_in(conn, auth.create_session(conn, user_id))

    @app.post("/v1/auth/dev")
    def sign_in_dev(conn: DB, body: DevSignIn):
        if not auth.dev_login_enabled():
            raise APIError(404, "not_found", "Not found")
        return signed_in(conn, auth.create_session(conn, auth.upsert_dev_user(conn, body.name.strip())))

    @app.post("/v1/auth/sign-out", status_code=204)
    def sign_out(conn: DB, authorization: Authorization = None):
        auth.sign_out(conn, authorization)
        return Response(status_code=204)

    @app.get("/v1/me")
    def me(conn: DB, authorization: Authorization = None):
        return auth.user_json(auth.require_user(conn, cfg, authorization))

    @app.delete("/v1/me", status_code=204)
    def delete_me(conn: DB, authorization: Authorization = None):
        auth.delete_user(conn, auth.require_user(conn, cfg, authorization)["id"])
        return Response(status_code=204)

    # ------------------------------------------------------------ free resources, no account needed

    @app.get("/v1/dictionaries")
    def dictionary_list(request: Request):
        """The offline dictionaries the apps download for the learner's language (DESIGN.md section 5)."""
        return json_response(request, dictionaries.public(settings.public_base_url))

    @app.get("/dictionaries/{name}")
    def dictionary_file(name: str):
        """A new version gets a new name, so a file never changes."""
        if name not in {e["file"] for e in dictionaries.entries()}:
            raise APIError(404, "not_found", "No such dictionary")
        return FileResponse(dictionaries.DIR / name, media_type="application/octet-stream",
                            headers={"Cache-Control": "public, max-age=31536000, immutable"})  # fmt: skip

    @app.get("/v1/art")
    def art(url: Annotated[str, Query(max_length=2000)]):
        """A cover image from another host, scaled down and cached (some hosts can't be reached from China)."""
        try:
            path = artwork.path_for(url, settings.data_dir / "artwork")
        except artwork.ArtworkError as e:
            log.info("art %s: %s", url[:200], e)
            raise APIError(404, "not_found", "No image there") from e
        return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=2592000"})

    return app
