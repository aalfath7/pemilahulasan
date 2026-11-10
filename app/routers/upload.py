from fastapi import APIRouter, HTTPException, Request, UploadFile
from starlette.concurrency import run_in_threadpool

from app.config import get_settings
from app.limiter import limiter
from app.schemas import UploadResponse
from app.services.parser import ParseError, parse_file, suggest_columns

router = APIRouter(prefix="/api", tags=["unggah"])


@router.post("/upload", response_model=UploadResponse)
@limiter.limit("20/minute")
async def upload(request: Request, file: UploadFile) -> UploadResponse:
    max_mb = get_settings().max_upload_mb
    data = await file.read(max_mb * 1024 * 1024 + 1)
    if len(data) > max_mb * 1024 * 1024:
        raise HTTPException(413, f"Ukuran file melebihi {max_mb} MB.")
    if not data:
        raise HTTPException(400, "File kosong.")

    try:
        table = await run_in_threadpool(parse_file, file.filename or "", data)
    except ParseError as exc:
        raise HTTPException(400, str(exc)) from exc

    text_idx, rating_idx = suggest_columns(table)
    return UploadResponse(
        filename=file.filename or "file",
        columns=table.columns,
        rows=table.rows,
        total_rows=table.total_rows,
        truncated=table.truncated,
        suggested_text=text_idx,
        suggested_rating=rating_idx,
    )
