from collections.abc import Callable

from fastapi.testclient import TestClient


def test_health_ok(make_client: Callable[[bool], TestClient]) -> None:
    response = make_client(True).get("/v1/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["db"] == "ok"
    assert body["version"]


def test_health_reports_db_down(make_client: Callable[[bool], TestClient]) -> None:
    response = make_client(False).get("/v1/health")
    assert response.status_code == 503
    assert response.json()["db"] == "error"


def test_unknown_route_returns_json_404(
    make_client: Callable[[bool], TestClient],
) -> None:
    response = make_client(True).get("/v1/does-not-exist")
    assert response.status_code == 404
    assert response.json() == {"error": {"code": "not_found", "message": "Not Found"}}


def test_routes_are_versioned(make_client: Callable[[bool], TestClient]) -> None:
    assert make_client(True).get("/health").status_code == 404


def test_cors_allows_web_origin(make_client: Callable[[bool], TestClient]) -> None:
    response = make_client(True).get(
        "/v1/health", headers={"Origin": "http://localhost:3000"}
    )
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_cors_rejects_other_origins(
    make_client: Callable[[bool], TestClient],
) -> None:
    response = make_client(True).get(
        "/v1/health", headers={"Origin": "https://evil.example"}
    )
    assert "access-control-allow-origin" not in response.headers
