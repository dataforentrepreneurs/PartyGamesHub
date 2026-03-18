from typing import Dict, Optional
import uuid

class RoomState:
    def __init__(self, room_code: str, host_id: str):
        self.room_code = room_code
        self.host_id = host_id
        self.status = "waiting" # waiting, drawing, judging, results
        self.players = {} # player_id -> {"name": display_name, "score": 0}
        self.round_prompt = ""
        self.game_mode = "classic"
        self.submissions = {} 
        
    def add_player(self, display_name: str) -> str:
        player_id = str(uuid.uuid4())
        self.players[player_id] = {"name": display_name, "score": 0}
        return player_id
        
    def start_round(self, prompt: str, mode: str = "classic"):
        self.status = "drawing"
        self.round_prompt = prompt
        self.game_mode = mode
        self.submissions = {}
        
    def add_submission(self, player_id: str, image_data: str):
        if self.status == "drawing":
            self.submissions[player_id] = {"image": image_data, "score_data": None}

active_rooms: Dict[str, RoomState] = {}

def create_room_state() -> RoomState:
    room_code = uuid.uuid4().hex[:6].upper()
    host_id = str(uuid.uuid4())
    room = RoomState(room_code, host_id)
    active_rooms[room_code] = room
    return room

def get_room_state(room_code: str) -> Optional[RoomState]:
    return active_rooms.get(room_code.upper())
