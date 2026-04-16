from fastapi import APIRouter, HTTPException, Body
from services.state_manager import create_room_state, get_room_state
from models.schemas import RoomCreateResponse, RoomCreateRequest
from services.analytics import track_event

router = APIRouter(prefix="/rooms", tags=["Rooms"])

@router.post("", response_model=RoomCreateResponse)
def create_new_room(request: RoomCreateRequest = Body(default_factory=RoomCreateRequest)):
    print("Received request to create room")
    room = create_room_state()
    
    track_event(
        event_name="lobby_created",
        lobby_id=room.room_code,
        platform=request.platform,
        user_role="host",
        device_id=request.device_id,
        player_count=1
    )
    
    return RoomCreateResponse(room_code=room.room_code, host_id=room.host_id)

@router.get("/{room_code}")
def get_room_status(room_code: str):
    room = get_room_state(room_code)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return {
        "room_code": room.room_code,
        "status": room.status,
        "players": list(room.players.values())
    }
