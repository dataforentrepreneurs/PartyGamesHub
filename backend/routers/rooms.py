from fastapi import APIRouter, HTTPException
from services.state_manager import create_room_state, get_room_state
from models.schemas import RoomCreateResponse

router = APIRouter(prefix="/api/rooms", tags=["Rooms"])

@router.post("/", response_model=RoomCreateResponse)
def create_new_room():
    room = create_room_state()
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
