import os
import uuid
import time
import json
import logging
from fastapi import APIRouter, BackgroundTasks
from models.schemas import FeedbackPayload

logger = logging.getLogger("party-games-hub")
router = APIRouter(prefix="/api/feedback", tags=["Feedback"])

@router.post("")
def submit_feedback(payload: FeedbackPayload, background_tasks: BackgroundTasks):
    """
    Saves user feedback asynchronously to a JSON file.
    """
    def save_feedback_file():
        try:
            # Resolve data/feedback directory relative to this router file
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            feedback_dir = os.path.join(base_dir, "data", "feedback")
            os.makedirs(feedback_dir, exist_ok=True)

            feedback_id = str(uuid.uuid4())
            timestamp = int(time.time())
            filename = f"feedback_{timestamp}_{feedback_id[:8]}.json"
            filepath = os.path.join(feedback_dir, filename)

            # Support both Pydantic V1 and V2
            feedback_data = payload.model_dump() if hasattr(payload, 'model_dump') else payload.dict()
            feedback_data["id"] = feedback_id
            feedback_data["created_at"] = timestamp

            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(feedback_data, f, indent=2, ensure_ascii=False)

            logger.info(f"Successfully saved user feedback to {filepath}")
        except Exception as e:
            logger.error(f"Error saving feedback: {e}", exc_info=True)

    background_tasks.add_task(save_feedback_file)
    return {"status": "success", "message": "Feedback submitted successfully"}
