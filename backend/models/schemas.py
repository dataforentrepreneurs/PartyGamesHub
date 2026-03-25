from pydantic import BaseModel # pyre-ignore
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
    is_mock: bool = False

class BatchEvaluationResult(BaseModel):
    results: List[AIScoreResponse]
    round_summary: str
    winner_explanation: str
