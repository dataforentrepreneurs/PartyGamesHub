from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from services.websocket_manager import manager
from services.couple_clash_service import get_couple_clash_state, create_couple_clash_room, TurnPhase
import json
import time
import asyncio

router = APIRouter(tags=["CoupleClash"])

@router.post("/api/coupleclash/rooms")
async def create_room():
    print("DEBUG: STAGE 1 - POST /api/coupleclash/rooms hit")
    room = create_couple_clash_room()
    print(f"DEBUG: STAGE 2 - Created room: {room.room_code}")
    return {"room_code": room.room_code, "host_id": room.host_id}

@router.websocket("/ws/coupleclash/rooms/{room_code}")
async def websocket_endpoint(
    websocket: WebSocket, 
    room_code: str, 
    player_id: str = Query(...), 
    name: str = Query(...)
):
    print(f"DEBUG: WebSocket connection attempt for room {room_code} by {name} ({player_id})")
    await websocket.accept()
    try:
        room_code = room_code.upper()
        room = get_couple_clash_state(room_code)
        
        if not room:
            print(f"DEBUG: Room {room_code} NOT FOUND. Closing.")
            await websocket.close(code=4004)
            return

        print(f"DEBUG: Room {room_code} found. Adding player {name}.")
        room.add_player(player_id, name)
        
        if room_code not in manager.active_connections:
            manager.active_connections[room_code] = {}
        manager.active_connections[room_code][player_id] = websocket

        print(f"DEBUG: Sending Initial Sync to {name}")
        # Initial Sync
        state_dict = room.to_dict()
        await websocket.send_text(json.dumps({
            "event": "sync_state",
            "state": state_dict,
            "is_host": player_id == room.host_id
        }))

        print(f"DEBUG: Broadcasting Room Update")
        # Broadcast updated player list
        await manager.broadcast_to_room(room_code, {
            "event": "room_update",
            "players": room.players,
            "presence": room.player_presence
        })

        print(f"DEBUG: Entering message loop for {name}")
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            event = message.get("event")
            print(f"DEBUG: Received event {event} from {name}")


            if event == "assign_captain":
                if player_id == room.host_id:
                    target_player_id = message.get("player_id")
                    team = message.get("team")
                    if team == "blue":
                        room.blue_captain = target_player_id
                    elif team == "pink":
                        room.pink_captain = target_player_id
                    
                    room.save()
                    await manager.broadcast_to_room(room_code, {
                        "event": "room_update",
                        "state": room.to_dict(), # Full sync is easier for role changes
                        "players": room.players,
                        "presence": room.player_presence
                    })
                    print(f"DEBUG: Host assigned {target_player_id} as {team} captain")
                room.player_presence[player_id]["last_seen"] = time.time()
                await websocket.send_text(json.dumps({"event": "pong"}))
                continue

            if event == "update_team":
                team = message.get("team") # "blue", "pink" or None
                if player_id in room.players:
                    room.players[player_id]["team"] = team
                    room.save()
                    await manager.broadcast_to_room(room_code, {
                        "event": "room_update",
                        "players": room.players
                    })

            elif event == "start_game":
                # Only TV host (or anyone if we want to be lax for now) can start
                starting_team = message.get("starting_team", "blue")
                room.generate_board(starting_team)
                await manager.broadcast_to_room(room_code, {
                    "event": "game_started",
                    "state": room.to_dict()
                })

            elif event == "submit_clue":
                word = message.get("word")
                number = message.get("number")
                if word and number is not None:
                    room.submit_clue(word, int(number))
                    await manager.broadcast_to_room(room_code, {
                        "event": "clue_submitted",
                        "clue_word": room.clue_word,
                        "clue_number": room.clue_number,
                        "state": room.to_dict()
                    })

            elif event == "vote_tile":
                player_data = room.players.get(player_id, {})
                player_team = player_data.get("team")
                
                # Captains cannot vote
                if player_id == room.blue_captain or player_id == room.pink_captain:
                    print(f"DEBUG: Vote IGNORED - {name} is a Captain.")
                    continue

                # Only the team whose turn it is can vote
                if player_team == room.current_turn:
                    tile_id = str(message.get("tile_id"))
                    if tile_id not in room.votes:
                        room.votes[tile_id] = []
                    
                    if player_id in room.votes[tile_id]:
                        room.votes[tile_id].remove(player_id)
                    else:
                        # Limit is 1 + current clue number
                        current_votes = sum(1 for vlist in room.votes.values() if player_id in vlist)
                        if current_votes < (room.clue_number + 1):
                            room.votes[tile_id].append(player_id)
                    
                    room.save()
                    await manager.broadcast_to_room(room_code, {
                        "event": "votes_updated",
                        "votes": room.votes
                    })
                continue

            elif event == "reveal_tile":
                tile_id = message.get("tile_id")
                print(f"DEBUG: Host {name} is attempting to reveal tile {tile_id}")
                if tile_id is not None:
                    result = room.reveal_tile(tile_id)
                    if "error" not in result:
                        print(f"DEBUG: Reveal SUCCESS for tile {tile_id}")
                        await manager.broadcast_to_room(room_code, {
                            "event": "tile_revealed",
                            "tile_id": tile_id,
                            "result": result,
                            "state": room.to_dict()
                        })
                    else:
                        print(f"DEBUG: Reveal FAILED: {result['error']}")
                        await websocket.send_text(json.dumps({
                            "event": "error",
                            "message": result["error"]
                        }))

            elif event == "end_turn":
                room.end_turn()
                await manager.broadcast_to_room(room_code, {
                    "event": "turn_ended",
                    "state": room.to_dict()
                })
                
            elif event == "reset_game":
                room.status = TurnPhase.LOBBY
                room.turn_phase = TurnPhase.LOBBY
                room.board = []
                room.save()
                await manager.broadcast_to_room(room_code, {
                    "event": "game_reset",
                    "state": room.to_dict()
                })

    except WebSocketDisconnect:
        print(f"DEBUG: {name} disconnected normally.")
        manager.disconnect(room_code, player_id)
        if player_id in room.player_presence:
            room.player_presence[player_id]["connected"] = False
        await manager.broadcast_to_room(room_code, {
            "event": "player_disconnected",
            "player_id": player_id,
            "presence": room.player_presence
        })
    except Exception as e:
        import traceback
        print(f"DEBUG: CRASH for {name}: {e}")
        traceback.print_exc()
        manager.disconnect(room_code, player_id)

