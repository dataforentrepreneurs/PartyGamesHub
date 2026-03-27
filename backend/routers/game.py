from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query # pyre-ignore
from services.websocket_manager import manager # pyre-ignore
from services.state_manager import get_room_state # pyre-ignore
from services.ai_judge import evaluate_submissions # pyre-ignore
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
        eval_result = await evaluate_submissions(room.round_prompt, room.submissions)
        results = eval_result.results
        
        # Reset deltas for this round
        room.last_round_deltas = {}
        
        # Update cumulative scores
        for res in results:
            pid = res.submission_id
            if pid in room.players:
                room.players[pid]["score"] += res.total_score
                room.last_round_deltas[pid] = res.total_score
                
        # Notify host if mock AI was used
        any_mock = any(res.is_mock for res in results)
        if any_mock:
            ai_status_msg = "Game scored using Mock AI (API key missing or error)"
        else:
            ai_status_msg = "Game scored successfully using Gemini AI"
            
        await manager.send_to_player(room_code, room.host_id, {
            "event": "ai_diagnostic",
            "message": ai_status_msg
        })
        # Inform room to transition out of judging state to allow next rounds
        room.status = "results"
                
        # Prepare detailed results list including the images
        results_data = []
        for r in results:
            item = r.model_dump() if hasattr(r, "model_dump") else r.dict()
            sub_data = room.submissions.get(r.submission_id, {})
            img = sub_data.get("image", "") if isinstance(sub_data, dict) else ""
            item["image"] = img
            results_data.append(item)
            
            # Store history
            room.player_history.setdefault(r.submission_id, []).append({
                "round": room.current_round,
                "prompt": room.round_prompt,
                "image": img,
                "total_score": r.total_score,
                "comment": r.comment,
                "scores": r.scores.model_dump() if hasattr(r.scores, "model_dump") else r.scores.dict()
            })
            
        winner_exp = eval_result.winner_explanation
        if winner_exp:
            for p_id, p_stats in room.players.items():
                if p_id in winner_exp:
                    winner_exp = winner_exp.replace(p_id, p_stats["name"])

        # Broadcast results
        await manager.broadcast_to_room(room_code, {
            "event": "results_ready",
            "results": results_data,
            "round_summary": eval_result.round_summary,
            "winner_explanation": winner_exp,
            "leaderboard": room.players,
            "current_round": room.current_round,
            "max_rounds": room.max_rounds,
            "round_deltas": room.last_round_deltas
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Error during AI judging flow: {e}")
        room.status = "results"
        await manager.send_to_player(room_code, room.host_id, {
            "event": "ai_diagnostic",
            "message": f"Judging crashed internally: {e}"
        })

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
    # The host should sit in "Projector Mode", not directly as a competitive player
    if player_id not in room.players and player_id != room.host_id:
        room.players[player_id] = {"name": name, "score": 0}

    await manager.connect(room_code, player_id, websocket)
    
    # Broadcast updated room state to everyone
    await manager.broadcast_to_room(room_code, {
        "event": "room_state_update",
        "status": room.status,
        "players": room.players,
        "current_round": room.current_round,
        "max_rounds": room.max_rounds
    })

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            event = message.get("event")
            
            if event == "ping":
                continue
                
            if event == "start_round":
                if room.status in ["drawing", "judging"]:
                    continue
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
                    "duration_seconds": duration,
                    "current_round": room.current_round,
                    "max_rounds": room.max_rounds
                })
                
            elif event == "update_settings":
                if player_id == room.host_id:
                    new_max = message.get("max_rounds")
                    if new_max is not None:
                        room.max_rounds = max(1, int(new_max))
                        await manager.broadcast_to_room(room_code, {
                            "event": "room_state_update",
                            "status": room.status,
                            "players": room.players,
                            "current_round": room.current_round,
                            "max_rounds": room.max_rounds
                        })
                        
            elif event == "return_to_lobby":
                if player_id == room.host_id:
                    room.reset_game()
                    await manager.broadcast_to_room(room_code, {
                        "event": "room_state_update",
                        "status": room.status,
                        "players": room.players,
                        "current_round": room.current_round,
                        "max_rounds": room.max_rounds
                    })
                    
            elif event == "get_player_history":
                target_pid = message.get("player_id")
                if target_pid:
                    history = room.player_history.get(target_pid, [])
                    await websocket.send_text(json.dumps({
                        "event": "player_history",
                        "player_id": target_pid,
                        "history": history
                    }))
                
            elif event == "submit_drawing":
                image_data = message.get("image_data") # Base64 string
                if image_data:
                    room.add_submission(player_id, image_data)
                    
                    await manager.broadcast_to_room(room_code, {
                        "event": "submission_count_update",
                        "count": len(room.submissions),
                        "total": len(room.players)
                    })
                    
                    # If all players have submitted
                    if len(room.submissions) >= len(room.players) and len(room.players) > 0:
                        room.status = "judging"
                        await manager.broadcast_to_room(room_code, {
                            "event": "judging_started"
                        })
                        # Trigger asynchronous judging task
                        asyncio.create_task(process_judging(room_code, room))
            
            elif event == "force_judging":
                if player_id == room.host_id and room.status == "drawing":
                    room.status = "judging"
                    await manager.broadcast_to_room(room_code, {"event": "judging_started"})
                    asyncio.create_task(process_judging(room_code, room))
                        
    except WebSocketDisconnect:
        manager.disconnect(room_code, player_id)
        
        # Only remove the player from state if the game hasn't started yet.
        # Otherwise, preserve their score/history in case they reconnect!
        if room.status == "waiting" and player_id in room.players:
            del room.players[player_id]
            
        # Check if the round was stalled waiting for this player
        if room.status == "drawing" and len(room.players) > 0 and len(room.submissions) >= len(room.players):
            room.status = "judging"
            await manager.broadcast_to_room(room_code, {"event": "judging_started"})
            # Trigger asynchronous judging task
            asyncio.create_task(process_judging(room_code, room))

        # Notify remaining players
        await manager.broadcast_to_room(room_code, {
            "event": "room_state_update",
            "status": room.status,
            "players": room.players,
            "current_round": room.current_round,
            "max_rounds": room.max_rounds
        })
