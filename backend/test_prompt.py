import asyncio
import base64
import os
from dotenv import load_dotenv  # type: ignore

# Ensure we define the fake key if none
if not os.environ.get("GEMINI_API_KEY"):
    load_dotenv()

from services.ai_judge import evaluate_submissions  # type: ignore

async def test():
    # Single pixel PNG base64
    dummy_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    
    # Try testing the real model prompt using the new batch dictionary format
    print("Testing evaluate_submissions...")
    test_batch = {
        "test_player": {"image": dummy_b64}
    }
    results = await evaluate_submissions("Draw a completely terrible scribble", test_batch)
    
    print("AI Judge returned:")
    for res in results:
        print(res.model_dump())
    
if __name__ == "__main__":
    asyncio.run(test())
