from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from thirdeye.config import get_settings
from thirdeye.db import create_pool


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    pool = create_pool(settings)
    await pool.open()
    app.state.pool = pool
    try:
        yield
    finally:
        await pool.close()


app = FastAPI(title="Third Eye API", lifespan=lifespan)


@app.get("/")
def read_root() -> dict[str, str]:
    return {"message": "Hello, World!"}
