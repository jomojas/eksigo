# Server

FastAPI and SQLite: optional accounts (Sign in with Apple or Google), offline dictionaries and cover art. Sync and Premium AI come later (DESIGN.md section 13). The API is described in [docs/API.md](../docs/API.md).

## Run it locally

```bash
cd backend
uv sync
EKSIGO_DEV_LOGIN=1 uv run uvicorn app.main:create_app --factory --reload
```

- **API docs:** http://localhost:8000/v1/docs
- **Data:** `backend/data/app.db`
- **Signing in without Apple or Google:** `POST /v1/auth/dev` works because of `EKSIGO_DEV_LOGIN=1`. Never set it on the VPS.
- **Tests:** `uv run pytest -q`

## Operator commands (on the VPS, in `/opt/eab`)

```bash
docker compose exec api python -m app.admin users
docker compose exec api python -m app.admin plan <user_id> premium
docker compose exec api python -m app.admin backup
```

## Deploying

Merging into `main` builds the image `ghcr.io/jomojas/eksigo-backend` and deploys it to the VPS (`.github/workflows/backend.yml`). The deploy step only runs when the repository variable `DEPLOY_ENABLED` is `true`.

## Switching the VPS from v1 to v2 (once)

1. **Back up v1:** `docker compose exec api python -m pipeline backup`, then copy the file off the VPS.
2. **Owner, in `/opt/eab/.env`:** remove `EAB_IMAGE` and add `EKSIGO_IMAGE=ghcr.io/jomojas/eksigo-backend:latest`. The other lines can stay.
3. **Owner, in this repository's settings:**
   - add the secrets `VPS_HOST`, `VPS_USER` and `VPS_SSH_KEY`, using a new deploy key
   - set the variable `DEPLOY_ENABLED=true`
4. **Deploy:** re-run the latest `backend` workflow on `main`.
   - The new compose file replaces v1's. v1's `pipeline` container is removed.
   - The API starts on a new, empty volume (`eab_eksigo`). Everyone signs in again.
   - v1's database stays in `eab_data` until it is deleted.
5. **Nightly backup:** change the crontab line to `docker compose exec -T api python -m app.admin backup`.
6. **v1 repository:** turn off its workflows and delete its VPS secrets, so it can't deploy v1 again.
7. **Later:** delete `eab_data` and v1's images.
