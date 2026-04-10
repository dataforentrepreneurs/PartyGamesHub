from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query # pyre-ignore
from services.websocket_manager import manager # pyre-ignore
from services.state_manager import get_room_state # pyre-ignore
from services.ai_judge import evaluate_submissions, generate_creative_prompt # pyre-ignore
import json
import string
import asyncio
import os
import random
import time
import posthog
import sentry_sdk
from posthog import Posthog

# Attempt to load frontend .env for the API key if missing locally
frontend_env_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend", ".env"))
if os.path.exists(frontend_env_path):
    from dotenv import load_dotenv
    load_dotenv(frontend_env_path)

POSTHOG_KEY = os.environ.get("POSTHOG_API_KEY") or os.environ.get("VITE_POSTHOG_KEY")
ph_client = None
if POSTHOG_KEY:
    ph_client = Posthog(POSTHOG_KEY, host="https://eu.i.posthog.com")

FALLBACK_PROMPTS = {
    "Family": ["A dog flying a kite", "A friendly monster baking cookies", "A penguin on vacation"],
    "Kids": ["A superhero duck", "A pizza with eyeballs", "A magic treehouse"],
    "Couples": ["Arguing over the TV remote", "Who forgot to take out the trash", "Stealing the blankets"],
    "Office": ["The printer is jammed again", "Zoom call in pajamas", "Someone stole my lunch"]
}

router = APIRouter(tags=["Game"])

async def process_judging(room_code: str, room):
    try:
        eval_result = await evaluate_submissions(room.round_prompt, room.submissions, room.theme)
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
        
        # Track AI Latency Backend-Side exactly once
        if ph_client:
            try:
                ph_client.capture(
                    "AI_Judge_Latency",
                    distinct_id=room.host_id, # using host ID as distinct persona for the room
                    properties={
                        "latency_seconds": float(eval_result.ai_latency_seconds),
                        "player_count": len(room.submissions),
                        "is_mock": any_mock,
                        "theme": room.theme
                    }
                )
                ph_client.flush() # Force instantaneous delivery of latency metric
            except Exception as e:
                print("Posthog capture failed:", e)

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
        
        room.last_round_summary = eval_result.round_summary
        room.last_winner_explanation = winner_exp
        room.save()

        # Broadcast results
        await manager.broadcast_to_room(room_code, {
            "event": "results_ready",
            "results": results_data,
            "round_summary": eval_result.round_summary,
            "winner_explanation": winner_exp,
            "leaderboard": room.players,
            "current_round": room.current_round,
            "max_rounds": room.max_rounds,
            "round_deltas": room.last_round_deltas,
            "ai_latency_seconds": eval_result.ai_latency_seconds
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

@router.websocket("/ws/drawjudge/rooms/{room_code}")
async def websocket_endpoint(
    websocket: WebSocket, 
    room_code: str, 
    player_id: str = Query(...), 
    name: str = Query(...)
):
    room_code = room_code.upper()
    
    # Tag Sentry for multiplayer debugging
    sentry_sdk.set_tag("room_code", room_code)
    sentry_sdk.set_tag("player_id", player_id)
    
    room = get_room_state(room_code)
    
    if not room:
        await websocket.close(code=4004, reason="Room not found")
        return

    # Add player if not exists
    if player_id not in room.players and player_id != room.host_id:
        room.players[player_id] = {"name": name, "score": 0}
        if room.status == "drawing":
            room.round_participants.append(player_id)
            room.save()

    room.player_presence[player_id] = {"connected": True, "last_seen": time.time()}

    await manager.connect(room_code, player_id, websocket)

    # Immediately send dedicated resume_state event to the player
    has_sub = player_id in room.submissions
    sub_image = room.submissions.get(player_id, {}).get("image", "")

    await websocket.send_text(json.dumps({
        "event": "resume_state",
        "status": room.status,
        "current_round": room.current_round,
        "max_rounds": room.max_rounds,
        "prompt": room.round_prompt,
        "mode": room.game_mode,
        "theme": room.theme,
        "time_left": max(0, int(room.round_end_time - time.time())) if room.status == "drawing" else 0,
        "has_submitted": has_sub,
        "submitted_image": sub_image,
        "leaderboard": room.players,
        "is_host": player_id == room.host_id
    }))
    
    if room.status == "results":
        current_results = []
        for pid, history in room.player_history.items():
            if history and history[-1]["round"] == room.current_round:
                last_entry = history[-1]
                sub_data = room.submissions.get(pid, {})
                img = sub_data.get("image", "") if isinstance(sub_data, dict) else ""
                current_results.append({
                    "submission_id": pid,
                    "total_score": last_entry["total_score"],
                    "comment": last_entry["comment"],
                    "scores": last_entry["scores"],
                    "image": img
                })
        current_results.sort(key=lambda x: x["total_score"], reverse=True)
        await websocket.send_text(json.dumps({
            "event": "results_ready",
            "results": current_results,
            "round_summary": room.last_round_summary,
            "winner_explanation": room.last_winner_explanation,
            "leaderboard": room.players,
            "current_round": room.current_round,
            "max_rounds": room.max_rounds,
            "round_deltas": room.last_round_deltas
        }))
    
    time_left = max(0, int(room.round_end_time - time.time())) if room.status == "drawing" else 0
    # Broadcast updated room state to everyone
    await manager.broadcast_to_room(room_code, {
        "event": "room_state_update",
        "status": room.status,
        "players": room.players,
        "current_round": room.current_round,
        "max_rounds": room.max_rounds,
        "prompt": room.round_prompt,
        "mode": room.game_mode,
        "theme": room.theme,
        "host_id": room.host_id,
        "time_left": time_left
    })
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            event = message.get("event")
            
            if event == "ping":
                room.player_presence[player_id] = {"connected": True, "last_seen": time.time()}
                await websocket.send_text(json.dumps({"event": "pong"}))
                continue
                
            if event == "start_round":
                if room.status in ["drawing", "judging"]:
                    continue
                mode = message.get("mode", "classic")
                
                ai_prompt = await generate_creative_prompt(room.theme)
                fallback_list = FALLBACK_PROMPTS.get(room.theme, FALLBACK_PROMPTS["Family"])
                selected_prompt = ai_prompt if ai_prompt else random.choice(fallback_list)
                
                duration = 60
                if mode == "speed":
                    duration = 15
                
                room.start_round(selected_prompt, mode, duration)
                
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
                    new_theme = message.get("theme")
                    if new_max is not None:
                        room.max_rounds = max(1, int(new_max))
                    if new_theme is not None:
                        room.theme = new_theme
                        
                    await manager.broadcast_to_room(room_code, {
                        "event": "room_state_update",
                        "status": room.status,
                        "players": room.players,
                        "current_round": room.current_round,
                        "max_rounds": room.max_rounds,
                        "prompt": room.round_prompt,
                        "mode": room.game_mode,
                        "theme": room.theme,
                        "host_id": room.host_id,
                        "time_left": max(0, int(room.round_end_time - time.time())) if room.status == "drawing" else 0
                    })
                        
            elif event == "return_to_lobby":
                if player_id == room.host_id:
                    room.reset_game()
                    await manager.broadcast_to_room(room_code, {
                        "event": "room_state_update",
                        "status": room.status,
                        "players": room.players,
                        "current_round": room.current_round,
                        "max_rounds": room.max_rounds,
                        "prompt": room.round_prompt,
                        "mode": room.game_mode,
                        "theme": room.theme,
                        "host_id": room.host_id,
                        "time_left": 0
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
                    
                    # If all round participants have submitted (ignoring temporary disconnects)
                    if len(room.submissions) >= len(room.round_participants) and len(room.round_participants) > 0:
                        room.status = "judging"
                        await manager.broadcast_to_room(room_code, {
                            "event": "judging_started"
                        })
                        # Add a tiny delay to allow any pending canvas-finish packets from laggy connections to arrive
                        async def delayed_judging():
                            await asyncio.sleep(1.5)
                            await process_judging(room_code, room)
                        asyncio.create_task(delayed_judging())
            
            elif event == "force_judging":
                if player_id == room.host_id and room.status == "drawing":
                    room.status = "judging"
                    await manager.broadcast_to_room(room_code, {"event": "judging_started"})
                    
                    async def delayed_judging():
                        await asyncio.sleep(1.5)
                        await process_judging(room_code, room)
                    asyncio.create_task(delayed_judging())
                        
    except WebSocketDisconnect:
        manager.disconnect(room_code, player_id)
        
        # Mark as disconnected instead of immediately assuming total loss of player
        if player_id in room.player_presence:
            room.player_presence[player_id]["connected"] = False
            room.player_presence[player_id]["last_seen"] = time.time()

        # Notify remaining players
        await manager.broadcast_to_room(room_code, {
            "event": "room_state_update",
            "status": room.status,
            "players": room.players,
            "current_round": room.current_round,
            "max_rounds": room.max_rounds,
            "prompt": room.round_prompt,
            "mode": room.game_mode,
            "theme": room.theme,
            "host_id": room.host_id,
            "time_left": max(0, int(room.round_end_time - time.time())) if room.status == "drawing" else 0
        })
