"""Live receipt reading for the web interface: POST a photo, get back the fields the model read.

The browser rechecks the accounting rules itself (TypeScript port of consistency.py, 277/277
parity), so the server only runs the model. Start it in WSL, where the Triton kernels work:

    bash scripts/wsl.sh bash scripts/serve.sh

Settings (environment variables):
    SUMPROOF_ADAPTER   LoRA adapter to load       (default runs/sft/adapter-epoch1.0)
    SUMPROOF_SAMPLES   extra sampled readings for checker-guided best-of-N (default 0: greedy, ~11 s;
                       4 gives the README's best-of-4 setting, ~28 s per receipt)
    SUMPROOF_ORIGINS   comma-separated sites allowed to call the server
"""

from __future__ import annotations

import io
import os
import threading
import time
from collections.abc import Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps, UnidentifiedImageError

from .receipts.schema import Receipt

ADAPTER = os.environ.get("SUMPROOF_ADAPTER", "runs/sft/adapter-epoch1.0")
SAMPLES = int(os.environ.get("SUMPROOF_SAMPLES", "0"))
ORIGINS = os.environ.get("SUMPROOF_ORIGINS", "http://localhost:3000,https://sumproof.vercel.app").split(",")
MAX_BYTES = 10 * 1024 * 1024

Reader = Callable[[Image.Image], Receipt | None]


def load_reader() -> Reader:
    """Load the fine-tuned Qwen3.5-4B once; the returned function reads one photo."""
    from .receipts import vlm

    model, processor = vlm.load(ADAPTER)

    def read(image: Image.Image) -> Receipt | None:
        receipt, _ = vlm.extract(model, processor, image, n_samples=SAMPLES)
        return receipt

    return read


def create_app(reader: Reader | None = None) -> FastAPI:
    """Build the app. Tests pass a fake `reader`; normally the model loads at startup."""
    state: dict[str, Reader | None] = {"read": reader}
    gpu = threading.Lock()  # one 8 GB GPU: read one receipt at a time

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if state["read"] is None:
            state["read"] = load_reader()
        yield

    app = FastAPI(title="SumProof receipt reader", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in ORIGINS if o.strip()],
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
        allow_private_network=True,  # lets the public site call this server on the visitor's own machine
    )

    @app.get("/health")
    def health() -> dict:
        return {"ok": state["read"] is not None, "adapter": ADAPTER, "readings": SAMPLES + 1}

    @app.post("/read")
    def read(file: UploadFile = File(...)) -> dict:
        if not (file.content_type or "").startswith("image/"):
            raise HTTPException(415, "Please upload a photo (JPG, PNG or WebP).")
        data = file.file.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise HTTPException(413, "The photo is larger than 10 MB.")
        try:
            image = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
        except (UnidentifiedImageError, OSError):
            raise HTTPException(400, "This file could not be opened as an image.") from None

        start = time.perf_counter()
        with gpu:
            receipt = state["read"](image)
        seconds = round(time.perf_counter() - start, 1)
        if receipt is None:
            raise HTTPException(422, "No receipt could be read from this photo. Try a sharper, straight-on photo.")
        return {"receipt": receipt.model_dump(exclude_none=True), "seconds": seconds}

    return app


def main() -> None:
    import uvicorn

    uvicorn.run(create_app(), host="127.0.0.1", port=int(os.environ.get("SUMPROOF_PORT", "8000")))


if __name__ == "__main__":
    main()
