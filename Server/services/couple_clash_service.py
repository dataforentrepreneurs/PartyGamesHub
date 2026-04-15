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

MODE_KEYWORDS = {
    "classic": [
        "Pizza", "Bicycle", "Beach with umbrella", "Snow-capped mountain", "Hot beverage", "Guitar", "Elephant", "Airplane",
        "Camera", "Umbrella", "Sunflower", "Bridge at night", "Books", "Deciduous tree", "Desert", "Water wave",
        "Statue of liberty", "Shopping cart", "Castle", "Office building", "Locomotive", "Ship", "Desert island", "Volcano", "Milky way",
        "Robot", "Woman scientist", "Woman cook", "Woman health worker", "Woman astronaut", "Woman firefighter", "Woman police officer", "Woman teacher"
    ],
    "couples": [
        "Wedding", "Ring", "Heart with ribbon", "Kiss mark", "Rose", "Wine glass", "Fork and knife", "Luggage", "Two hearts", 
        "Sunset", "Beach with umbrella", "Couch and lamp", "Champagne glass", "Wrapped gift", "Candle", "Musical note", "Love letter", "Locked with Heart", "Ferris wheel", 
        "Basket", "Woman dancing", "Handshake", "Hourglass done", "Sparkler", "Chocolate bar", "Fire", "Sparkles", "Smiling face with hearts"
    ],
    "movies": [
        "Movie camera", "Man dancing", "Woman dancing", "Sari", "Popcorn", "Video camera", "Clapper board", "Direct Hit", "Scroll", "Performing arts", 
        "Studio Light", "Person supervillain", "Person superhero", "Musical score", "Star", "Admission tickets", "Trophy", "Hand with fingers splayed", "Sunglasses", 
        "Lipstick", "Artist palette", "Crown", "Gem stone", "Fire", "Person wearing turban", "Elephant", "Tiger", "Peacock", "Lotus"
    ],
    "kids": [
        "Cat", "Dog", "Red apple", "Sun with face", "Full moon", "Glowing star", "Soccer ball", "Automobile", "Evergreen tree", "House", 
        "Hibiscus", "Bird", "Teddy bear", "Baby chick", "Balloon", "Birthday cake", "Ice cream", "Butterfly", "Tropical fish", "Rainbow", 
        "Elephant", "Lion", "Rabbit", "Bear", "Duck", "Monkey", "Giraffe", "Zebra", "Turtle"
    ],
    "bollywood_real": [
        "Shah Rukh Khan", "Salman Khan", "Deepika Padukone", "Amitabh Bachchan", "Aamir Khan", "Gabbar Singh", "Sholay", "3 Idiots", 
        "Alia Bhatt", "Priyanka Chopra", "Rajinikanth", "Kareena Kapoor", "Hrithik Roshan", "Akshay Kumar", "Katrina Kaif", 
        "Ranveer Singh", "Ranbir Kapoor", "Anushka Sharma", "Varun Dhawan", "Madhuri Dixit", "Sridevi", "Kajol", "Rishi Kapoor", 
        "Dev Anand", "Lagaan", "Dangal", "Bahubali"
    ]
}

RELIABLE_IMAGE_MAP = {
    "Shah Rukh Khan": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/Shahrukh_Khan_CE.jpg/400px-Shahrukh_Khan_CE.jpg",
    "Salman Khan": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/Salman_Khan_at_Renault_Star_Guild_Awards.jpg/400px-Salman_Khan_at_Renault_Star_Guild_Awards.jpg",
    "Deepika Padukone": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Deepika_Padukone_at_Grazia_Millennial_Awards_2022_%281%29.jpg/400px-Deepika_Padukone_at_Grazia_Millennial_Awards_2022_%281%29.jpg",
    "Amitabh Bachchan": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c6/Amitabh_Bachchan_2011.jpg/400px-Amitabh_Bachchan_2011.jpg",
    "Aamir Khan": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Aamir_Khan_March_2015.jpg/400px-Aamir_Khan_March_2015.jpg",
    "Gabbar Singh": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/ba/Amjad_Khan_%28actor%29.jpg/400px-Amjad_Khan_%28actor%29.jpg",
    "Sholay": "https://upload.wikimedia.org/wikipedia/en/thumb/5/52/Sholay-poster.jpg/400px-Sholay-poster.jpg",
    "3 Idiots": "https://upload.wikimedia.org/wikipedia/en/thumb/d/df/3_idiots_poster.jpg/400px-3_idiots_poster.jpg",
    "Alia Bhatt": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Alia_Bhatt_Red_Carpets.jpg/400px-Alia_Bhatt_Red_Carpets.jpg",
    "Priyanka Chopra": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Priyanka-chopra-vogue-june-2023-new_copy_2.jpg/400px-Priyanka-chopra-vogue-june-2023-new_copy_2.jpg",
    "Rajinikanth": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/Rajinikanth_2.jpg/400px-Rajinikanth_2.jpg",
    "Kareena Kapoor": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/Kareena_Kapoor_Khan_Grazia.jpg/400px-Kareena_Kapoor_Khan_Grazia.jpg",
    "Hrithik Roshan": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/da/Hrithik_Roshan_2012.jpg/400px-Hrithik_Roshan_2012.jpg",
    "Akshay Kumar": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2e/Akshay_Kumar_promoting_Singh_Is_Bliing.jpg/400px-Akshay_Kumar_promoting_Singh_Is_Bliing.jpg",
    "Katrina Kaif": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Katrina_Kaif_2023.jpg/400px-Katrina_Kaif_2023.jpg",
    "Ranveer Singh": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/Ranveer_Singh_2017.jpg/400px-Ranveer_Singh_2017.jpg",
    "Ranbir Kapoor": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/db/Ranbir_Kapoor_at_World_of_Anant_Ambani.jpg/400px-Ranbir_Kapoor_at_World_of_Anant_Ambani.jpg",
    "Anushka Sharma": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ae/Anushka_Sharma_at_Femina_Women_Awards_2015_%28cropped%29.jpg/400px-Anushka_Sharma_at_Femina_Women_Awards_2015_%28cropped%29.jpg",
    "Varun Dhawan": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Varun_Dhawan_promoting_Bhediya.jpg/400px-Varun_Dhawan_promoting_Bhediya.jpg",
    "Madhuri Dixit": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/Madhuri_Dixit_promoting_Maja_Ma.jpg/400px-Madhuri_Dixit_promoting_Maja_Ma.jpg",
    "Sridevi": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f6/Sridevi_2012.jpg/400px-Sridevi_2012.jpg",
    "Kajol": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/28/Kajol_at_Kala_Ghoda_Festival_%281%29.jpg/400px-Kajol_at_Kala_Ghoda_Festival_%281%29.jpg",
    "Rishi Kapoor": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Rishi_Kapoor_Filmfare.jpg/400px-Rishi_Kapoor_Filmfare.jpg",
    "Dev Anand": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/Dev_Anand_at_the_starlite_event.jpg/400px-Dev_Anand_at_the_starlite_event.jpg",
    "Lagaan": "https://upload.wikimedia.org/wikipedia/en/thumb/b/b6/Lagaan.jpg/400px-Lagaan.jpg",
    "Dangal": "https://upload.wikimedia.org/wikipedia/en/thumb/9/99/Dangal_Poster.jpg/400px-Dangal_Poster.jpg",
    "Bahubali": "https://upload.wikimedia.org/wikipedia/en/thumb/c/c8/Baahubali_The_Beginning_Poster.jpg/400px-Baahubali_The_Beginning_Poster.jpg"
}

def get_emoji_url(keyword: str) -> str:
    """
    Constructs a 3D Fluent Emoji URL.
    Handles standard objects: assets/{Folder}/3D/{file}_3d.png
    Handles people/jobs: assets/{Folder}/Default/3D/{file}_3d_default.png
    """
    folder = keyword.replace(" ", "%20")
    # Base filename is lowercase with underscores
    base_file = keyword.lower().replace(" ", "_").replace("-", "_")
    
    # Heuristic for people/jobs that use the 'Default' skin tone path
    people_keywords = ["Woman", "Man", "Person", "Hand", "Fingers", "Handshake"]
    is_people = any(p in keyword for p in people_keywords)
    
    # Special Handling for Snow-capped mountain (has hyphen)
    if keyword == "Snow-capped mountain":
        return "https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Snow-capped%20mountain/3D/snow-capped_mountain_3d.png"

    if is_people:
        # Example: assets/Woman%20scientist/Default/3D/woman_scientist_3d_default.png
        return f"https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/{folder}/Default/3D/{base_file}_3d_default.png"
    else:
        # Example: assets/Pizza/3D/pizza_3d.png
        return f"https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/{folder}/3D/{base_file}_3d.png"

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
    def __init__(self, id: int, image: str, type: str, keyword: str = ""):
        self.id = id
        self.image = image
        self.type = type # "blue", "pink", "neutral", "trap"
        self.keyword = keyword
        self.revealed = False

    def to_dict(self):
        return {
            "id": self.id,
            "keyword": self.keyword,
            "image": self.image,
            "type": self.type,
            "revealed": self.revealed
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]):
        tile = cls(data["id"], data["image"], data["type"])
        tile.keyword = data.get("keyword", "")
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
        
        self.game_mode = "classic"
        self.starting_team_pref = "blue"
        self.team_times = {"blue": 0, "pink": 0}
        self.turn_started_at = 0
        self.winner = None

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
        
        # Mode-specific keywords (ensure uniqueness)
        mode_pool = list(set(MODE_KEYWORDS.get(self.game_mode, MODE_KEYWORDS["classic"])))
        if len(mode_pool) < 25:
            # Fallback/merge if pool is small
            mode_pool = mode_pool + random.sample(MODE_KEYWORDS["classic"], 25 - len(mode_pool))
            
        selected_keywords = random.sample(mode_pool, 25)
        
        self.board = []
        for i, (k, t) in enumerate(zip(selected_keywords, types)):
            img_url = RELIABLE_IMAGE_MAP.get(k, get_emoji_url(k))
            self.board.append(Tile(i, img_url, t, k))
            
        self.status = TurnPhase.WAITING_FOR_CLUE
        self.turn_phase = TurnPhase.WAITING_FOR_CLUE
        self.current_turn = starting_team
        self.scores = {"blue": 0, "pink": 0}
        self.team_times = {"blue": 0, "pink": 0}
        self.turn_started_at = time.time()
        self.winner = None
        self.save()

    def reroll_tile(self, tile_id: int):
        """Replaces a tile's image with a new keyword from the pool."""
        tile = next((t for t in self.board if t.id == tile_id), None)
        if not tile or tile.revealed:
            return

        mode_pool = list(set(MODE_KEYWORDS.get(self.game_mode, MODE_KEYWORDS["classic"])))
        used_keywords = {t.keyword for t in self.board}
        available = [k for k in mode_pool if k not in used_keywords]

        if not available:
            # If we run out, just pick one that isn't the current one
            available = [k for k in mode_pool if k != tile.keyword]

        if available:
            new_keyword = random.choice(available)
            tile.keyword = new_keyword
            tile.image = RELIABLE_IMAGE_MAP.get(new_keyword, get_emoji_url(new_keyword))
            self.save()

    def submit_clue(self, word: str, number: int):
        if self.turn_phase == TurnPhase.WAITING_FOR_CLUE:
            self.clue_word = word
            self.clue_number = number
            self.guesses_remaining = number
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
            self.winner = result["winner"]
        elif tile.type == self.current_turn:
            self.scores[self.current_turn] += 1
            if self.scores[self.current_turn] >= self.max_tiles[self.current_turn]:
                self.status = TurnPhase.GAME_OVER
                self.turn_phase = TurnPhase.GAME_OVER
                result["game_over"] = True
                result["winner"] = self.current_turn
                self.winner = result["winner"]
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
                    self.winner = result["winner"]
            
            if not result["game_over"]:
                self.end_turn()

        self.is_revealing = False
        self.save()
        return result

    def end_turn(self):
        # Accumulate time
        elapsed = time.time() - self.turn_started_at
        self.team_times[self.current_turn] += int(elapsed)
        
        self.current_turn = "pink" if self.current_turn == "blue" else "blue"
        self.turn_phase = TurnPhase.WAITING_FOR_CLUE
        self.turn_started_at = time.time()
        
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
            "votes": self.votes,
            "game_mode": self.game_mode,
            "starting_team_pref": self.starting_team_pref,
            "team_times": self.team_times,
            "turn_started_at": self.turn_started_at,
            "winner": self.winner
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
        
        room.game_mode = data.get("game_mode", "classic")
        room.starting_team_pref = data.get("starting_team_pref", "blue")
        room.team_times = data.get("team_times", {"blue": 0, "pink": 0})
        room.turn_started_at = data.get("turn_started_at", 0)
        room.winner = data.get("winner")
        
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
