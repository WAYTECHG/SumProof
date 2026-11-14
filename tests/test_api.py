"""Live reader API, with a fake model so it runs on CPU in a second."""

import io

import pytest

pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from sumproof.api import create_app  # noqa: E402
from sumproof.receipts.schema import Item, Receipt  # noqa: E402


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (40, 60), "white").save(buf, format="PNG")
    return buf.getvalue()


def _client(reader):
    return TestClient(create_app(reader=reader))


def test_read_returns_fields_and_time():
    fake = lambda img: Receipt(items=[Item(name="Tea", amount="5,000")], total="5,000")  # noqa: E731
    with _client(fake) as c:
        assert c.get("/health").json()["ok"] is True
        r = c.post("/read", files={"file": ("r.png", _png(), "image/png")})
    assert r.status_code == 200
    body = r.json()
    assert body["receipt"] == {"items": [{"name": "Tea", "amount": "5,000"}], "total": "5,000"}
    assert body["seconds"] >= 0


def test_rejects_non_images_and_unreadable_receipts():
    with _client(lambda img: None) as c:
        assert c.post("/read", files={"file": ("a.txt", b"hello", "text/plain")}).status_code == 415
        assert c.post("/read", files={"file": ("a.png", b"not a png", "image/png")}).status_code == 400
        assert c.post("/read", files={"file": ("r.png", _png(), "image/png")}).status_code == 422


def test_cors_allows_the_site_and_local_network_preflight():
    with _client(lambda img: None) as c:
        r = c.options(
            "/read",
            headers={
                "Origin": "https://sumproof.vercel.app",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Private-Network": "true",
            },
        )
    assert r.headers["access-control-allow-origin"] == "https://sumproof.vercel.app"
    assert r.headers.get("access-control-allow-private-network") == "true"
