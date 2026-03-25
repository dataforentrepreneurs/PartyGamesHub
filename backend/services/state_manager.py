from typing import Dict, Optional
import uuid
import secrets

class RoomState:
    def __init__(self, room_code: str, host_id: str):
        self.room_code = room_code
        self.host_id = host_id
        self.status = "waiting" # waiting, drawing, judging, results
        self.players = {} # player_id -> {"name": display_name, "score": 0}
        self.round_prompt = ""
        self.game_mode = "classic"
        self.submissions = {} 
        self.current_round = 0
        self.max_rounds = 10
        self.last_round_deltas = {} # player_id -> latest round score
        self.player_history = {} # player_id -> list of details
        
    def add_player(self, display_name: str) -> str:
        player_id = str(uuid.uuid4())
        self.players[player_id] = {"name": display_name, "score": 0}
        return player_id
        
    def start_round(self, prompt: str, mode: str = "classic"):
        self.status = "drawing"
        self.round_prompt = prompt
        self.game_mode = mode
        self.submissions = {}
        self.current_round += 1
        self.last_round_deltas = {}
        
    def add_submission(self, player_id: str, image_data: str):
        if self.status == "drawing":
            self.submissions[player_id] = {"image": image_data, "score_data": None}

    def reset_game(self):
        self.status = "waiting"
        self.current_round = 0
        self.submissions = {}
        self.last_round_deltas = {}
        self.player_history = {}
        for player_id in self.players:
            self.players[player_id]["score"] = 0

active_rooms: Dict[str, RoomState] = {}

def create_room_state() -> RoomState:
    room_code = secrets.token_hex(3).upper()
    host_id = str(uuid.uuid4())
    room = RoomState(room_code, host_id)
    active_rooms[room_code] = room
    return room

def get_room_state(room_code: str) -> Optional[RoomState]:
    return active_rooms.get(room_code.upper())
