"""FastAPI entrypoint for the Bianomics intake backend."""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.routes import router as api_v1_router
from app.core.config import get_settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

settings = get_settings()

# Log voice configuration status at startup
logger.info("Voice enabled: %s", settings.voice_enabled)
logger.info("Deepgram API key configured: %s", bool(settings.deepgram_api_key))
logger.info("AI voice output uses browser speech synthesis on the frontend")

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Client-code intake chatbot API with Supabase storage and Monday integration.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_v1_router, prefix="/api/v1")


@app.get("/", tags=["health"])
def root() -> dict[str, str]:
    return {"message": "Bianomics Intake API is running"}
