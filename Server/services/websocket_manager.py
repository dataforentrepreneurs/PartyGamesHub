from fastapi import WebSocket # pyre-ignore
from typing import Dict

class ConnectionManager:
    def __init__(self):
        # Maps a room_code to a dict of player_id -> WebSocket
        self.active_connections: Dict[str, Dict[str, WebSocket]] = {}

    async def connect(self, room_code: str, player_id: str, websocket: WebSocket):
        await websocket.accept()
        if room_code not in self.active_connections:
            self.active_connections[room_code] = {}
        self.active_connections[room_code][player_id] = websocket

    def disconnect(self, room_code: str, player_id: str):
        if room_code in self.active_connections:
            if player_id in self.active_connections[room_code]:
                self.active_connections[room_code].pop(player_id, None)
            if len(self.active_connections[room_code]) == 0:
                self.active_connections.pop(room_code, None)

    async def broadcast_to_room(self, room_code: str, message: dict):
        if room_code in self.active_connections:
            dead_connections = []
            for pid, connection in list(self.active_connections[room_code].items()):
                try:
                    await connection.send_json(message)
                except Exception:
                    dead_connections.append(pid)
            for pid in dead_connections:
                self.disconnect(room_code, pid)

    async def send_to_player(self, room_code: str, player_id: str, message: dict):
        if room_code in self.active_connections and player_id in self.active_connections[room_code]:
            try:
                await self.active_connections[room_code][player_id].send_json(message)
            except Exception:
                self.disconnect(room_code, player_id)

manager = ConnectionManager()
