from pydantic import BaseModel
from typing import Optional, Dict, List

class RoomCreateResponse(BaseModel):
    room_code: str
    host_id: str

class PlayerJoinRequest(BaseModel):
    display_name: str

class ScoreBreakdown(BaseModel):
    prompt_relevance: int
    creativity: int
    clarity: int
    entertainment: int

class AIScoreResponse(BaseModel):
    submission_id: str
    scores: ScoreBreakdown
    total_score: int
    comment: str

class AIBatchResponse(BaseModel):
    results: List[AIScoreResponse]
