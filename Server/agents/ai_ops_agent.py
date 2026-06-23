import asyncio
import os
import json
import logging
from typing import Dict, Any, Optional

from google import genai
from pydantic import BaseModel, Field

from services.event_logger import redis_client, get_room_events
from services.discord_alerts import send_ai_anomaly_alert, Severity

logger = logging.getLogger("party-games-hub")

ANOMALY_QUEUE_KEY = "anomaly_queue"
CONSUMER_GROUP = "ai_ops_group"
CONSUMER_NAME = "ai_worker_1"

# Initialize Google GenAI
GOOGLE_API_KEY = os.environ.get("GEMINI_API_KEY")
if GOOGLE_API_KEY:
    ai_client = genai.Client(api_key=GOOGLE_API_KEY)
else:
    ai_client = None

# Structured Output Schema
class AnomalyAnalysis(BaseModel):
    severity: str = Field(description="One of: LOW, MEDIUM, HIGH, CRITICAL")
    probable_cause: str = Field(description="A concise explanation of the root cause based on the event timeline.")
    confidence: float = Field(description="Confidence score between 0.0 and 1.0")
    recommended_action: str = Field(description="Action the operator or system should take to resolve.")
    user_impact: str = Field(description="How this is currently affecting the players in the room.")

def _setup_consumer_group_sync():
    """Synchronous helper - must be called via asyncio.to_thread."""
    if not redis_client:
        return
    try:
        # Create group, start from latest '$' or '0'
        # Mkstream=True creates the stream if it doesn't exist
        redis_client.xgroup_create(ANOMALY_QUEUE_KEY, CONSUMER_GROUP, id='0', mkstream=True)
    except Exception as e:
        if "BUSYGROUP Consumer Group name already exists" not in str(e):
            logger.error(f"Failed to create consumer group: {e}")

async def setup_consumer_group():
    await asyncio.to_thread(_setup_consumer_group_sync)

async def process_anomaly(anomaly_event: Dict[str, Any], event_id: str):
    room_code = anomaly_event.get("room_code")
    game = anomaly_event.get("game")
    issue_type = anomaly_event.get("issue_type")
    
    if not room_code or not ai_client:
        return

    logger.info(f"AI Ops analyzing anomaly: {issue_type} for {game} room {room_code}")

    # 1. Rate Limiting Check
    # Avoid analyzing the exact same issue for the same room within 10 minutes
    lock_key = f"anomaly_lock:{room_code}:{issue_type}"
    if redis_client:
        is_locked = redis_client.set(lock_key, "locked", nx=True, ex=600)
        if not is_locked:
            logger.info(f"Rate limited: Already analyzed {issue_type} for {room_code} recently.")
            return

    # 2. Fetch Context
    events = get_room_events(room_code, count=100)
    
    # Extract duration and player count from the latest snapshot if available
    duration_secs = 0
    player_count = 0
    for ev in events:
        if ev.get("event") == "state_snapshot":
            details = ev.get("details", {})
            players = details.get("players", {})
            player_count = len(players) if isinstance(players, dict) else 0
            if "round_end_time" in details and "current_time" in details:
                # Basic duration guess if needed, or just default to unknown
                pass
            break

    # 3. Analyze with Gemini
    error_details = anomaly_event.get("error_details", "")
    prompt = f"""
    You are an expert Game Operations AI. Analyze the following anomaly for the multiplayer game {game}.
    
    Issue Type Detected: {issue_type}
    Room Code: {room_code}
    """
    
    if issue_type == "frontend_crash":
        prompt += f"""
    This is a CLIENT-SIDE FRONTEND CRASH.
    Error Details / Stack Trace:
    {error_details}
    
    Please determine why the client browser crashed or threw an unhandled exception based on the stack trace.
    """
    else:
        prompt += f"""
    Recent Event Timeline (Chronological, Oldest to Newest):
    {json.dumps(events, indent=2)}
    
    Determine the root cause of this anomaly based on the sequence of events.
    Pay close attention to disconnects, reconnects, missing heartbeats, and state snapshot variables.
    """

    try:
        # We must use asyncio.to_thread because the genai client is synchronous 
        # (unless using the async client, which we can try, but to_thread is safe)
        response = await asyncio.to_thread(
            ai_client.models.generate_content,
            model='gemini-2.5-flash',
            contents=prompt,
            config={
                "response_mime_type": "application/json",
                "response_schema": AnomalyAnalysis,
                "temperature": 0.2
            }
        )

        analysis = json.loads(response.text)
        
        # 4. Save to Redis History
        if redis_client:
            history_key = f"anomalies:{room_code}"
            record = {
                "timestamp": anomaly_event.get("timestamp"),
                "issue_type": issue_type,
                "analysis": json.dumps(analysis)
            }
            # Add to a list or hash in Redis
            redis_client.hset(history_key, mapping={event_id: json.dumps(record)})
            redis_client.expire(history_key, 604800) # 7 days
            
        # 5. Send Discord Alert
        await send_ai_anomaly_alert(
            room_code=room_code,
            game=game,
            duration_secs=duration_secs,
            player_count=player_count,
            severity=analysis.get("severity", Severity.REVIEW_REQUIRED),
            probable_cause=analysis.get("probable_cause", "Unknown"),
            recommended_action=analysis.get("recommended_action", "Investigate manually."),
            confidence=analysis.get("confidence", 0.0)
        )
        
    except Exception as e:
        logger.error(f"AI Ops Agent failed to analyze anomaly for {room_code}: {e}", exc_info=True)


def _xreadgroup_sync(streams: dict) -> list:
    """Synchronous helper for the blocking xreadgroup call - must be called via asyncio.to_thread."""
    return redis_client.xreadgroup(CONSUMER_GROUP, CONSUMER_NAME, streams, count=1, block=5000)

async def consume_anomaly_queue():
    if not redis_client:
        logger.warning("Redis not available. AI Ops Agent will not start.")
        return
        
    await setup_consumer_group()
    logger.info("Starting AI Ops Agent Consumer...")
    
    while True:
        try:
            # Block for up to 5000ms waiting for a new message via a thread
            # so the async event loop is NOT blocked during the wait.
            streams = {ANOMALY_QUEUE_KEY: '>'}
            messages = await asyncio.to_thread(_xreadgroup_sync, streams)
            
            if messages:
                for stream_name, events in messages:
                    for event_id, event_data in events:
                        
                        # Decode event
                        decoded_event = {k.decode('utf-8') if isinstance(k, bytes) else k: 
                                         v.decode('utf-8') if isinstance(v, bytes) else v 
                                         for k, v in event_data.items()}
                                         
                        # Process
                        await process_anomaly(decoded_event, event_id.decode('utf-8') if isinstance(event_id, bytes) else event_id)
                        
                        # Acknowledge message so it doesn't stay in PEL
                        await asyncio.to_thread(redis_client.xack, ANOMALY_QUEUE_KEY, CONSUMER_GROUP, event_id)
                        
        except asyncio.CancelledError:
            logger.info("AI Ops Agent Consumer shutting down.")
            break
        except Exception as e:
            # Handle expected socket read timeout when stream is empty
            err_str = str(e)
            if "Timeout reading from socket" in err_str or "TimeoutError" in type(e).__name__:
                logger.debug("AI Ops Agent Consumer: Idle socket read timeout (no anomalies).")
                continue
                
            logger.error(f"Error in consume_anomaly_queue: {e}")
            await asyncio.sleep(5) # Backoff on other errors
