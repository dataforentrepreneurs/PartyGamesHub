import uvicorn
import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from routers import rooms, game

app = FastAPI(title="Draw Judge API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins for frontend communication
    allow_credentials=True,
    allow_methods=["*"],  
    allow_headers=["*"],  
)

# Mount modular API routers
app.include_router(rooms.router)
app.include_router(game.router)

# Mount the compiled React Single Page App for production serving
frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.exists(frontend_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dist, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        # Skip API calls so they don't get routed to React index
        if full_path.startswith("api/") or full_path.startswith("ws/"):
            return {"error": "Endpoint not found"}
        # Check if requesting a specific top-level public file (favicon, etc.)
        target_path = os.path.join(frontend_dist, full_path)
        if os.path.isfile(target_path):
            return FileResponse(target_path)
        return FileResponse(os.path.join(frontend_dist, "index.html"))
else:
    @app.get("/")
    def serve_frontend_fallback():
        return {"status": "ok", "message": "Draw Judge API is running. (React dist folder not found)"}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
