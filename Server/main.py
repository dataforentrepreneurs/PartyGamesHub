import uvicorn
import os
import logging
import json
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from routers import rooms, game, couple_clash

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("party-games-hub")

# Initialize Sentry
SENTRY_DSN = os.getenv("SENTRY_DSN")
IS_PRODUCTION = os.getenv("RENDER") is not None or os.getenv("ENVIRONMENT") == "production"

if SENTRY_DSN and IS_PRODUCTION:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        integrations=[FastApiIntegration()],
        traces_sample_rate=1.0,
        profiles_sample_rate=1.0,
        environment="production"
    )
    logger.info("Sentry initialized in production mode")

app = FastAPI(title="Party Games Hub API")

@app.middleware("http")
async def log_requests(request: Request, call_next):
    # Structured logging for production observability
    log_data = {
        "method": request.method,
        "url": str(request.url),
        "client": request.client.host if request.client else "unknown"
    }
    
    # Try to extract game context if available in headers or query
    room_code = request.query_params.get("room_code") or request.headers.get("X-Room-Code")
    if room_code:
        log_data["room_code"] = room_code
        sentry_sdk.set_tag("room_code", room_code)

    logger.info(f"API Request: {json.dumps(log_data)}")
    
    try:
        response = await call_next(request)
        return response
    except Exception as e:
        logger.error(f"Request failed: {e}", exc_info=True)
        raise

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],  
    allow_headers=["*"],  
)

# Mount modular API routers
app.include_router(couple_clash.router)
app.include_router(rooms.router, prefix="/api/drawjudge")
app.include_router(game.router)

@app.get("/api/health")
async def health_check():
    print("DEBUG: Health check hit")
    return {"status": "ok", "message": "Backend is reachable!"}

@app.get("/privacy")
async def serve_privacy():
    privacy_path = os.path.join(os.path.dirname(__file__), "static", "privacy.html")
    if os.path.exists(privacy_path):
        return FileResponse(privacy_path)
    raise HTTPException(status_code=404, detail="Privacy policy not found.")

# Mount the compiled React Single Page Apps for production serving
launcher_dist = os.getenv("LAUNCHER_DIST", os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "Games", "Launcher", "dist")))
drawjudge_dist = os.getenv("DRAWJUDGE_DIST", os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "Games", "DrawJudge", "dist")))
coupleclash_dist = os.getenv("COUPLECLASH_DIST", os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "Games", "CoupleClash", "dist")))

# Diagnostic logging for Render paths
logger.info(f"DEBUG: Launcher path: {launcher_dist} (Exists: {os.path.exists(launcher_dist)})")
logger.info(f"DEBUG: DrawJudge path: {drawjudge_dist} (Exists: {os.path.exists(drawjudge_dist)})")
logger.info(f"DEBUG: CoupleClash path: {coupleclash_dist} (Exists: {os.path.exists(coupleclash_dist)})")

# Mount assets specifically (Vite defaults to /assets)
if os.path.exists(launcher_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(launcher_dist, "assets")), name="launcher_assets")
if os.path.exists(drawjudge_dist):
    app.mount("/drawjudge/assets", StaticFiles(directory=os.path.join(drawjudge_dist, "assets")), name="drawjudge_assets")
if os.path.exists(coupleclash_dist):
    app.mount("/coupleclash/assets", StaticFiles(directory=os.path.join(coupleclash_dist, "assets")), name="coupleclash_assets")

@app.get("/{full_path:path}")
async def serve_frontend(request: Request, full_path: str):
    # CRITICAL: If this is an API request, DO NOT return HTML
    if full_path.startswith("api/") or "api/" in request.url.path:
        raise HTTPException(status_code=404, detail=f"API route '{full_path}' not found on server.")

    # Handle DrawJudge frontend (SPA at /drawjudge)
    if full_path.startswith("drawjudge"):
        if not os.path.exists(drawjudge_dist):
            logger.warning(f"DrawJudge dist not found at {drawjudge_dist}")
            return {"error": "DrawJudge frontend not built"}
        
        # Strip 'drawjudge/' to seek files within the dist folder
        sub_path = full_path[9:].lstrip("/") 
        target_path = os.path.join(drawjudge_dist, sub_path)
        
        if sub_path and os.path.isfile(target_path):
            return FileResponse(target_path)
        # Fallback to index.html for SPA routing
        return FileResponse(os.path.join(drawjudge_dist, "index.html"))

    # Handle CoupleClash frontend (SPA at /coupleclash)
    if full_path.startswith("coupleclash"):
        if not os.path.exists(coupleclash_dist):
            logger.warning(f"CoupleClash dist not found at {coupleclash_dist}")
            return {"error": "CoupleClash frontend not built"}
        
        # Strip 'coupleclash/' to seek files within the dist folder
        sub_path = full_path[11:].lstrip("/") 
        target_path = os.path.join(coupleclash_dist, sub_path)
        
        if sub_path and os.path.isfile(target_path):
            return FileResponse(target_path)
        # Fallback to index.html for SPA routing
        return FileResponse(os.path.join(coupleclash_dist, "index.html"))

    # Handle Launcher frontend (SPA at root)
    if os.path.exists(launcher_dist):
        target_path = os.path.join(launcher_dist, full_path)
        if full_path and os.path.isfile(target_path):
            return FileResponse(target_path)
        # Fallback to index.html for SPA routing
        return FileResponse(os.path.join(launcher_dist, "index.html"))

    return {
        "status": "ready", 
        "message": "PartyGamesHub API is running.",
        "note": "Frontend 'dist' folders not found. Ensure 'npm run build' has been completed for Launcher, DrawJudge, and CoupleClash."
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
