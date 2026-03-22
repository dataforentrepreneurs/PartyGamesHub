import asyncio
import base64
import os
from dotenv import load_dotenv  # type: ignore

# Ensure we define the fake key if none
if not os.environ.get("GEMINI_API_KEY"):
    load_dotenv()

from services.ai_judge import evaluate_single  # type: ignore

async def test():
    # Single pixel PNG base64
    dummy_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    
    # Try testing the real model prompt
    print("Testing evaluate_single...")
    res = await evaluate_single("tester", "Draw a completely terrible scribble", dummy_b64)
    print("AI Judge returned:")
    print(res.dict())
    
if __name__ == "__main__":
    asyncio.run(test())
