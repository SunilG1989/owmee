from __future__ import annotations

from io import BytesIO

from PIL import Image

from app.modules.ai_assistant import router


def test_prepare_analysis_image_bytes_bounds_dimensions_and_normalizes_to_jpeg():
    source = Image.new("RGB", (2400, 1800), (40, 120, 220))
    raw = BytesIO()
    source.save(raw, format="PNG")

    prepared, content_type = router._prepare_analysis_image_bytes(raw.getvalue(), "image/png")

    assert content_type == "image/jpeg"
    assert len(prepared) < len(raw.getvalue())
    image = Image.open(BytesIO(prepared))
    assert max(image.size) <= router.MAX_ANALYSIS_IMAGE_DIMENSION
