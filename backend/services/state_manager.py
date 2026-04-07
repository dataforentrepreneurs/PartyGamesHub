from typing import Dict, Optional, Any
import uuid
import secrets
import time
import json
import os

# Optional redis import for graceful degrade if not installed during tests
try:
    import redis
    import fakeredis
except ImportError:
    redis = None
    fakeredis = None

# Initialize Redis client
REDIS_URL = os.environ.get("REDIS_URL")
if REDIS_URL and redis:
    redis_client = redis.from_url(REDIS_URL)
elif fakeredis:
    redis_client = fakeredis.FakeStrictRedis()
else:
    redis_client = None

class RoomState:
    def __init__(self, room_code: str, host_id: str):
        self.room_code = room_code
        self.host_id = host_id
        self.status = "waiting" # waiting, drawing, judging, results
        self.players = {} # player_id -> {"name": display_name, "score": 0}
        self.round_prompt = ""
        self.game_mode = "classic"
        self.theme = "Family"
        self.submissions = {} 
        self.current_round = 0
        self.max_rounds = 10
        self.last_round_deltas = {} # player_id -> latest round score
        self.player_history = {} # player_id -> list of details
        self.round_end_time = 0.0
        self.player_presence = {} # player_id -> {"connected": bool, "last_seen": float}
        self.round_participants = [] # list of player_ids active at the start of current round
        self.last_round_summary = ""
        self.last_winner_explanation = ""
        
    def add_player(self, display_name: str) -> str:
        player_id = str(uuid.uuid4())
        self.players[player_id] = {"name": display_name, "score": 0}
        self.player_presence[player_id] = {"connected": True, "last_seen": time.time()}
        self.save()
        return player_id
        
    def start_round(self, prompt: str, mode: str = "classic", duration: int = 60):
        self.status = "drawing"
        self.round_prompt = prompt
        self.game_mode = mode
        self.submissions = {}
        self.current_round += 1
        self.last_round_deltas = {}
        self.round_end_time = time.time() + duration
        self.round_participants = list(self.players.keys())
        self.save()
        
    def add_submission(self, player_id: str, image_data: str):
        if self.status == "drawing":
            self.submissions[player_id] = {"image": image_data, "score_data": None}
            self.save()

    def reset_game(self):
        self.status = "waiting"
        self.current_round = 0
        self.submissions = {}
        self.last_round_deltas = {}
        self.player_history = {}
        for player_id in self.players:
            self.players[player_id]["score"] = 0
        self.save()

    def to_dict_lite(self) -> Dict[str, Any]:
        """Serializes the class but STRIPS all heavy Base64 image data to protect 25MB Redis limit."""
        data = {
            "room_code": self.room_code,
            "host_id": self.host_id,
            "status": self.status,
            "players": self.players,
            "round_prompt": self.round_prompt,
            "game_mode": self.game_mode,
            "theme": self.theme,
            "current_round": self.current_round,
            "max_rounds": self.max_rounds,
            "last_round_deltas": self.last_round_deltas,
            "round_end_time": self.round_end_time,
            "player_presence": self.player_presence,
            "round_participants": self.round_participants,
            "last_round_summary": self.last_round_summary,
            "last_winner_explanation": self.last_winner_explanation,
            "submissions": {},
            "player_history": {}
        }
        
        # Clone submissions but remove 'image'
        for pid, sub in self.submissions.items():
            lite_sub = sub.copy()
            if "image" in lite_sub:
                lite_sub["image"] = ""
            data["submissions"][pid] = lite_sub
            
        # Clone history but remove 'image'
        for pid, history_list in self.player_history.items():
            lite_history = []
            for item in history_list:
                lite_item = item.copy()
                if "image" in lite_item:
                    lite_item["image"] = ""
                lite_history.append(lite_item)
            data["player_history"][pid] = lite_history
            
        return data

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'RoomState':
        room = cls(data.get("room_code", ""), data.get("host_id", ""))
        room.status = data.get("status", "waiting")
        room.players = data.get("players", {})
        room.round_prompt = data.get("round_prompt", "")
        room.game_mode = data.get("game_mode", "classic")
        room.theme = data.get("theme", "Family")
        room.submissions = data.get("submissions", {})
        room.current_round = int(data.get("current_round", 0))
        room.max_rounds = int(data.get("max_rounds", 10))
        room.last_round_deltas = data.get("last_round_deltas", {})
        room.player_history = data.get("player_history", {})
        room.round_end_time = float(data.get("round_end_time", 0.0))
        room.player_presence = data.get("player_presence", {})
        room.round_participants = data.get("round_participants", [])
        room.last_round_summary = data.get("last_round_summary", "")
        room.last_winner_explanation = data.get("last_winner_explanation", "")
        return room

    def save(self):
        save_room_state(self)

# In-memory primary cache
active_rooms: Dict[str, RoomState] = {}

def save_room_state(room: RoomState):
    """Saves the lite state to Redis with a 1-hour TTL."""
    if redis_client:
        try:
            lite_data = room.to_dict_lite()
            redis_client.set(f"room:{room.room_code}", json.dumps(lite_data), ex=3600)
        except Exception as e:
            print(f"Redis Save Error: {e}")

def create_room_state() -> RoomState:
    room_code = secrets.token_hex(3).upper()
    host_id = str(uuid.uuid4())
    room = RoomState(room_code, host_id)
    active_rooms[room_code] = room
    save_room_state(room)
    return room

def get_room_state(room_code: str) -> Optional[RoomState]:
    room_code = room_code.upper()
    
    # Check local memory first
    if room_code in active_rooms:
        return active_rooms[room_code]
        
    # If not in memory but we have Redis (Server crashed & restarted)
    if redis_client:
        try:
            data_str = redis_client.get(f"room:{room_code}")
            if data_str:
                data = json.loads(data_str)
                room = RoomState.from_dict(data)
                active_rooms[room_code] = room
                return room
        except Exception as e:
            print(f"Redis Load Error: {e}")
            
    return None
