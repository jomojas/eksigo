"""The API (docs/API.md): accounts, offline dictionaries and cover art. Sync and Premium AI come later
(DESIGN.md section 13)."""

import hashlib
import json
import logging
import sqlite3
from collections.abc import Iterator
from contextlib import asynccontextmanager
from typing import Annotated, Any, Literal
from urllib.parse import parse_qsl

from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response
from pydantic import BaseModel, Field

from app import artwork, auth, desktop_auth, dictionaries
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


class DesktopToken(BaseModel):
    code: str = Field(min_length=20, max_length=200)
    verifier: str = Field(min_length=43, max_length=128)


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

    # The desktop signs in through the browser (desktop_auth.py).

    @app.get("/v1/auth/desktop/{provider}")
    def desktop_start(conn: DB, provider: Literal["apple", "google"],
                      port: Annotated[int, Query(ge=1024, le=65535)],
                      state: Annotated[str, Query(min_length=16, max_length=200)],
                      challenge: Annotated[str, Query(min_length=43, max_length=128)]):  # fmt: skip
        return RedirectResponse(desktop_auth.start(conn, cfg, settings, provider, port, state, challenge), 302)

    def back_to_app(conn: sqlite3.Connection, p: desktop_auth.Pending | None, provider: str, sign_in) -> Response:
        if p is None:  # nothing to go back to: an old tab, or the app's 15 minutes are up
            return HTMLResponse(desktop_auth.done_page(False, provider), 400)
        try:
            return RedirectResponse(desktop_auth.finish(conn, p, sign_in()), 302)
        except (APIError, ValueError, OSError) as e:
            log.warning("desktop %s sign-in: %s", provider, e)
            return RedirectResponse(desktop_auth.fail(conn, p, "failed"), 302)

    @app.get("/v1/auth/google/callback")
    def google_callback(conn: DB, state: str | None = None, code: str | None = None, error: str | None = None):
        p = desktop_auth.pending(conn, state, "google")
        if p is not None and (error or not code):
            return RedirectResponse(desktop_auth.fail(conn, p, "cancelled" if error == "access_denied" else "failed"), 302)
        return back_to_app(conn, p, "google", lambda: desktop_auth.google_user(conn, cfg, settings, google_keys, p, code))

    @app.post("/v1/auth/apple/callback")
    async def apple_callback(request: Request):
        # Apple posts a form (response_mode=form_post). Parsed by hand: no need for python-multipart.
        form = dict(parse_qsl((await request.body())[:20000].decode(errors="replace")))
        conn = connect(settings.db_path)
        try:
            p = desktop_auth.pending(conn, form.get("state"), "apple")
            if p is not None and (form.get("error") or not form.get("id_token")):
                cancelled = form.get("error") == "user_cancelled_authorize"
                return RedirectResponse(desktop_auth.fail(conn, p, "cancelled" if cancelled else "failed"), 303)
            response = back_to_app(conn, p, "apple", lambda: desktop_auth.apple_user(conn, cfg, settings, apple_keys, p, form))
            if response.status_code == 302:
                response.status_code = 303  # after a POST, the browser must GET the app's address
            return response
        finally:
            conn.close()

    @app.post("/v1/auth/desktop/token")
    def desktop_token(conn: DB, body: DesktopToken):
        return signed_in(conn, auth.create_session(conn, desktop_auth.redeem(conn, body.code, body.verifier)))

    @app.get("/v1/auth/done")
    def desktop_done(ok: int = 0, provider: str | None = None):
        """Where the app sends the browser at the end, so the tab says what happened."""
        return HTMLResponse(desktop_auth.done_page(bool(ok), provider))

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
        user = auth.require_user(conn, cfg, authorization)
        auth.delete_user(conn, user["id"])
        desktop_auth.revoke_apple(cfg, settings, user)
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
