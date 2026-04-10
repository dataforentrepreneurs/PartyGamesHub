from typing import Dict, Optional, Any, List, Set
import uuid
import secrets
import time
import json
import os
import random

# Optional redis import for graceful degrade
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

# Enum for Turn Phases
class TurnPhase:
    LOBBY = "LOBBY"
    WAITING_FOR_CLUE = "WAITING_FOR_CLUE"
    GUESSING = "GUESSING"
    REVEALING = "REVEALING"
    GAME_OVER = "GAME_OVER"

class Tile:
    def __init__(self, id: int, image: str, type: str):
        self.id = id
        self.image = image
        self.type = type # "blue", "pink", "neutral", "trap"
        self.revealed = False

    def to_dict(self):
        return {
            "id": self.id,
            "image": self.image,
            "type": self.type,
            "revealed": self.revealed
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]):
        tile = cls(data["id"], data["image"], data["type"])
        tile.revealed = data.get("revealed", False)
        return tile

class CoupleClashRoomState:
    def __init__(self, room_code: str, host_id: str):
        self.room_code = room_code
        self.host_id = host_id
        self.status = TurnPhase.LOBBY
        self.players = {} # player_id -> {"name": display_name, "team": "blue"|"pink"|None, "role": "host"|"player"}
        self.board: List[Tile] = []
        
        self.current_turn = "blue" # "blue" or "pink"
        self.turn_phase = TurnPhase.LOBBY
        
        self.blue_captain = None # player_id
        self.pink_captain = None # player_id
        
        self.clue_word = None
        self.clue_number = 0
        self.guesses_remaining = 0
        
        self.is_revealing = False # Lock to prevent race conditions
        self.votes: Dict[int, List[str]] = {} # tile_id -> list of player_ids
        
        self.scores = {"blue": 0, "pink": 0}
        self.max_tiles = {"blue": 8, "pink": 8}
        
        self.player_presence = {} # player_id -> {"connected": bool, "last_seen": float}
        self.game_history = [] 

    def add_player(self, player_id: str, name: str) -> str:
        if player_id not in self.players:
            self.players[player_id] = {
                "name": name,
                "team": None,
                "role": "player"
            }
        self.player_presence[player_id] = {"connected": True, "last_seen": time.time()}
        self.save()
        return player_id

    def generate_board(self, starting_team: str = "blue"):
        # Tile Distribution (25 tiles total)
        # blue(10)/pink(9)/white(5)/black(1) if blue starts
        # pink(10)/blue(9)/white(5)/black(1) if pink starts
        
        types = ["neutral"] * 5 + ["trap"] * 1
        if starting_team == "blue":
            types += ["blue"] * 10 + ["pink"] * 9
            self.max_tiles = {"blue": 10, "pink": 9}
        else:
            types += ["pink"] * 10 + ["blue"] * 9
            self.max_tiles = {"pink": 10, "blue": 9}
            
        random.shuffle(types)
        
        # Curated keywords for recognizable images
        keywords = [
            "pizza", "bicycle", "beach", "mountain", "coffee", "guitar", "elephant", "airplane",
            "camera", "umbrella", "sunflower", "bridge", "library", "forest", "desert", "waterfall",
            "statue", "market", "castle", "skyscraper", "train", "ship", "island", "volcano", "galaxy",
            "robot", "scientist", "chef", "doctor", "astronaut", "firefighter", "policeman", "teacher",
            "balloon", "fireworks", "carnival", "concert", "wedding", "birthday", "party", "picnic"
        ]
        selected_keywords = random.sample(keywords, 25)
        
        self.board = []
        for i, (k, t) in enumerate(zip(selected_keywords, types)):
            # Use a reliable stock photo service
            img_url = f"https://images.unsplash.com/photo-1542281286-9e0a16bb7366?auto=format&fit=crop&q=80&w=400&q=keyword={k}"
            # Actually, let's use a more direct source if possible, but Unsplash featured is okay
            # Better: https://source.unsplash.com/featured/?{k} (Wait, Source Unsplash is deprecated)
            # Use https://images.unsplash.com/photo-... based on keywords is hard.
            # I'll use a placeholder for now and we can improvise the image library.
            img_url = f"https://loremflickr.com/400/400/{k}?lock={i}"
            self.board.append(Tile(i, img_url, t))
            
        self.status = TurnPhase.WAITING_FOR_CLUE
        self.turn_phase = TurnPhase.WAITING_FOR_CLUE
        self.current_turn = starting_team
        self.scores = {"blue": 0, "pink": 0}
        self.save()

    def submit_clue(self, word: str, number: int):
        if self.turn_phase == TurnPhase.WAITING_FOR_CLUE:
            self.clue_word = word
            self.clue_number = number
            self.guesses_remaining = number + 1
            self.turn_phase = TurnPhase.GUESSING
            self.votes = {}
            self.save()

    def reveal_tile(self, tile_id: int) -> Dict[str, Any]:
        if self.turn_phase != TurnPhase.GUESSING or self.is_revealing:
            return {"error": "Not guessing phase or already revealing"}
        
        tile = next((t for t in self.board if t.id == tile_id), None)
        if not tile or tile.revealed:
            return {"error": "Tile not found or already revealed"}
            
        self.is_revealing = True
        tile.revealed = True
        
        result = {"type": tile.type, "game_over": False, "winner": None}
        
        if tile.type == "trap":
            self.status = TurnPhase.GAME_OVER
            self.turn_phase = TurnPhase.GAME_OVER
            result["game_over"] = True
            result["winner"] = "pink" if self.current_turn == "blue" else "blue"
        elif tile.type == self.current_turn:
            self.scores[self.current_turn] += 1
            if self.scores[self.current_turn] >= self.max_tiles[self.current_turn]:
                self.status = TurnPhase.GAME_OVER
                self.turn_phase = TurnPhase.GAME_OVER
                result["game_over"] = True
                result["winner"] = self.current_turn
            else:
                self.guesses_remaining -= 1
                if self.guesses_remaining <= 0:
                    self.end_turn()
        else:
            # Hit neutral or opponent
            if tile.type in ["blue", "pink"]:
                self.scores[tile.type] += 1
                # Check if opponent just won because of this misclick!
                if self.scores[tile.type] >= self.max_tiles[tile.type]:
                    self.status = TurnPhase.GAME_OVER
                    self.turn_phase = TurnPhase.GAME_OVER
                    result["game_over"] = True
                    result["winner"] = tile.type
            
            if not result["game_over"]:
                self.end_turn()

        self.is_revealing = False
        self.save()
        return result

    def end_turn(self):
        self.current_turn = "pink" if self.current_turn == "blue" else "blue"
        self.turn_phase = TurnPhase.WAITING_FOR_CLUE
        self.clue_word = None
        self.clue_number = 0
        self.guesses_remaining = 0
        self.votes = {}
        self.save()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "room_code": self.room_code,
            "host_id": self.host_id,
            "status": self.status,
            "turn_phase": self.turn_phase,
            "current_turn": self.current_turn,
            "players": self.players,
            "blue_captain": self.blue_captain,
            "pink_captain": self.pink_captain,
            "board": [t.to_dict() for t in self.board],
            "clue_word": self.clue_word,
            "clue_number": self.clue_number,
            "guesses_remaining": self.guesses_remaining,
            "scores": self.scores,
            "max_tiles": self.max_tiles,
            "player_presence": self.player_presence,
            "votes": self.votes
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'CoupleClashRoomState':
        room = cls(data["room_code"], data["host_id"])
        room.status = data.get("status", TurnPhase.LOBBY)
        room.turn_phase = data.get("turn_phase", TurnPhase.LOBBY)
        room.current_turn = data.get("current_turn", "blue")
        room.players = data.get("players", {})
        room.blue_captain = data.get("blue_captain")
        room.pink_captain = data.get("pink_captain")
        room.board = [Tile.from_dict(t) for t in data.get("board", [])]
        room.clue_word = data.get("clue_word")
        room.clue_number = data.get("clue_number", 0)
        room.guesses_remaining = data.get("guesses_remaining", 0)
        room.scores = data.get("scores", {"blue": 0, "pink": 0})
        room.max_tiles = data.get("max_tiles", {"blue": 10, "pink": 9})
        room.player_presence = data.get("player_presence", {})
        room.votes = data.get("votes", {})
        return room

    def save(self):
        save_couple_clash_state(self)

active_couple_clash_rooms: Dict[str, CoupleClashRoomState] = {}

def save_couple_clash_state(room: CoupleClashRoomState):
    if redis_client:
        try:
            data = room.to_dict()
            redis_prefix = f"couple_clash:{room.room_code}"
            redis_client.set(redis_prefix, json.dumps(data), ex=3600)
        except Exception as e:
            print(f"Redis Save Error: {e}")

def create_couple_clash_room() -> CoupleClashRoomState:
    room_code = secrets.token_hex(3).upper()
    host_id = str(uuid.uuid4())
    room = CoupleClashRoomState(room_code, host_id)
    active_couple_clash_rooms[room_code] = room
    save_couple_clash_state(room)
    return room

def get_couple_clash_state(room_code: str) -> Optional[CoupleClashRoomState]:
    room_code = room_code.upper()
    if room_code in active_couple_clash_rooms:
        return active_couple_clash_rooms[room_code]
    
    if redis_client:
        try:
            redis_prefix = f"couple_clash:{room_code}"
            data_str = redis_client.get(redis_prefix)
            if data_str:
                data = json.loads(data_str)
                room = CoupleClashRoomState.from_dict(data)
                active_couple_clash_rooms[room_code] = room
                return room
        except Exception as e:
            print(f"Redis Load Error: {e}")
    return None
