from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from services.websocket_manager import manager
from services.state_manager import get_room_state
from services.ai_judge import evaluate_submissions
import json
import asyncio
import os
import random

# Load Prompts Library
PROMPTS_LIB = []
try:
    with open(os.path.join(os.path.dirname(__file__), '..', 'data', 'prompts.json')) as f:
        PROMPTS_LIB = json.load(f).get("prompts", ["Draw a flying cat wearing sunglasses"])
except Exception:
    PROMPTS_LIB = ["Draw a flying cat wearing sunglasses"]

router = APIRouter(tags=["Game"])

async def process_judging(room_code: str, room):
    try:
        results = await evaluate_submissions(room.round_prompt, room.submissions)
        # Update cumulative scores
        for res in results:
            pid = res.submission_id
            if pid in room.players:
                room.players[pid]["score"] += res.total_score
                
        # Broadcast results
        await manager.broadcast_to_room(room_code, {
            "event": "results_ready",
            "results": [r.dict() for r in results],
            "leaderboard": room.players
        })
    except Exception as e:
        print(f"Error during AI judging flow: {e}")

router = APIRouter(tags=["Game"])

@router.websocket("/ws/rooms/{room_code}")
async def websocket_endpoint(
    websocket: WebSocket, 
    room_code: str, 
    player_id: str = Query(...), 
    name: str = Query(...)
):
    room_code = room_code.upper()
    room = get_room_state(room_code)
    
    if not room:
        await websocket.close(code=4004, reason="Room not found")
        return

    # Add player if not exists
    if player_id not in room.players:
        room.players[player_id] = {"name": name, "score": 0}

    await manager.connect(room_code, websocket)
    
    # Broadcast updated room state to everyone
    await manager.broadcast_to_room(room_code, {
        "event": "room_state_update",
        "status": room.status,
        "players": room.players
    })

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            event = message.get("event")
            
            if event == "start_round":
                mode = message.get("mode", "classic")
                selected_prompt = random.choice(PROMPTS_LIB)
                room.start_round(selected_prompt, mode)
                
                duration = 60
                if mode == "speed":
                    duration = 15
                
                await manager.broadcast_to_room(room_code, {
                    "event": "round_started",
                    "prompt": room.round_prompt,
                    "mode": room.game_mode,
                    "duration_seconds": duration
                })
                
            elif event == "submit_drawing":
                image_data = message.get("image_data") # Base64 string
                if image_data:
                    room.add_submission(player_id, image_data)
                    
                    # If all players have submitted
                    if len(room.submissions) >= len(room.players):
                        room.status = "judging"
                        await manager.broadcast_to_room(room_code, {
                            "event": "judging_started"
                        })
                        # Trigger asynchronous judging task
                        asyncio.create_task(process_judging(room_code, room))
                        
    except WebSocketDisconnect:
        manager.disconnect(room_code, websocket)
        # Notify remaining players
        await manager.broadcast_to_room(room_code, {
            "event": "room_state_update",
            "status": room.status,
            "players": room.players
        })
