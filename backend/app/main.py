import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes.pfz import router as pfz_router
from app.routes.biodiversity import router as biodiversity_router
from app.routes.timeline import router as timeline_router


app = FastAPI(
    title="AquaGrid Backend API",
    description="Backend API for the AquaGrid PFZ and biodiversity dashboard",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin for origin in [
            "http://127.0.0.1:5500",
            "http://localhost:5500",
            os.getenv("FRONTEND_ORIGIN"),
        ] if origin
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(pfz_router)
app.include_router(biodiversity_router)
app.include_router(timeline_router)


@app.get("/")
def root():
    return {
        "project": "AquaGrid",
        "status": "running",
        "service": "backend",
    }


@app.get("/health")
def health():
    return {
        "status": "healthy",
    }