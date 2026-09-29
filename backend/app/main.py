from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.chat import router as chat_router
from .database.db import init_db


# ==========================================
# DATABASE
# ==========================================

init_db()


# ==========================================
# FASTAPI APPLICATION
# ==========================================

app = FastAPI(
    title="NexusAI API"
)


# ==========================================
# CORS
# ==========================================

app.add_middleware(
    CORSMiddleware,

    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],

    allow_credentials=True,

    allow_methods=["*"],

    allow_headers=["*"],

    # IMPORTANT:
    # Allows the React frontend to read
    # the custom conversation ID header.
    expose_headers=[
        "X-Conversation-ID",
    ],
)


# ==========================================
# ROUTES
# ==========================================

app.include_router(chat_router)


# ==========================================
# ROOT
# ==========================================

@app.get("/")
async def root():
    return {
        "message": "NexusAI API is running",
        "status": "ok",
    }


# ==========================================
# HEALTH CHECK
# ==========================================

@app.get("/health")
async def health():
    return {
        "status": "healthy",
    }