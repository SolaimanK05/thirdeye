from http import HTTPStatus
from typing import Any

import psycopg
import structlog
from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, JsonValue
from starlette.exceptions import HTTPException

log = structlog.get_logger()


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: JsonValue = None


class ErrorBody(BaseModel):
    error: ErrorDetail


ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    status.HTTP_404_NOT_FOUND: {"model": ErrorBody, "description": "Not found"},
    status.HTTP_422_UNPROCESSABLE_CONTENT: {
        "model": ErrorBody,
        "description": "Invalid request",
    },
    status.HTTP_503_SERVICE_UNAVAILABLE: {
        "model": ErrorBody,
        "description": "Database unavailable",
    },
}


def error_response(status_code: int, message: str, details: Any = None) -> JSONResponse:
    code = HTTPStatus(status_code).phrase.lower().replace(" ", "_")
    body: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        body["details"] = details
    return JSONResponse(status_code=status_code, content={"error": body})


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
        response = error_response(exc.status_code, str(exc.detail))
        if exc.headers:
            response.headers.update(exc.headers)
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return error_response(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Request validation failed",
            jsonable_encoder(exc.errors()),
        )

    @app.exception_handler(psycopg.OperationalError)
    async def database_unavailable(
        request: Request, exc: psycopg.OperationalError
    ) -> JSONResponse:
        log.warning("request.db_unavailable", path=request.url.path, error=str(exc))
        return error_response(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Database unavailable"
        )

    @app.exception_handler(Exception)
    async def unhandled_error(request: Request, exc: Exception) -> JSONResponse:
        log.exception("request.unhandled_error", path=request.url.path)
        return error_response(
            status.HTTP_500_INTERNAL_SERVER_ERROR, "Internal server error"
        )
