from fastapi import APIRouter, Request, Response
from starlette.concurrency import run_in_threadpool

from app.limiter import limiter
from app.schemas import ExportRequest
from app.services.exporter import build_xlsx

router = APIRouter(prefix="/api", tags=["ekspor"])

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.post("/export/xlsx")
@limiter.limit("10/minute")
async def export_xlsx(request: Request, body: ExportRequest) -> Response:
    content = await run_in_threadpool(build_xlsx, body.columns, body.rows)
    return Response(
        content,
        media_type=XLSX_MIME,
        headers={"Content-Disposition": 'attachment; filename="hasil-pemilahan.xlsx"'},
    )
