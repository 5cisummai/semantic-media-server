"""Text extraction from PDF and related helpers."""

import base64
import io

from fastapi import HTTPException


def extract_text_from_pdf_base64(base64_value: str) -> str:
    try:
        import PyPDF2

        raw = base64.b64decode(base64_value)
        pdf_file = io.BytesIO(raw)
        reader = PyPDF2.PdfReader(pdf_file)
        return "".join(page.extract_text() or "" for page in reader.pages)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"PDF extraction failed: {e}") from e
