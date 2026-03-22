import os
import json
import asyncio
import random
import base64
from typing import Dict, List
import traceback
from models.schemas import AIScoreResponse, ScoreBreakdown

try:
    import google.generativeai as genai
    HAS_GENAI = True
except ImportError:
    HAS_GENAI = False

def get_mock_score(player_id: str, prompt: str) -> AIScoreResponse:
    rel = random.randint(6, 10)
    cre = random.randint(5, 10)
    cla = random.randint(4, 10)
    ent = random.randint(7, 10)
    comments = [
        f"A deeply moving interpretation of '{prompt}'. The abstraction is wild!",
        "I'm slightly confused, but completely entertained. A bold choice.",
        "Leonardo da Vinci is shaking right now. This is magnificent.",
        "It looks exactly like the prompt, if you squint and tilt your head."
    ]
    return AIScoreResponse(
        submission_id=player_id, 
        scores=ScoreBreakdown(prompt_relevance=rel, creativity=cre, clarity=cla, entertainment=ent),
        total_score=rel + cre + cla + ent,
        comment=random.choice(comments)
    )

async def evaluate_single(player_id: str, prompt_text: str, b64_image: str) -> AIScoreResponse:
    try:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not HAS_GENAI or not api_key:
            print("No GEMINI_API_KEY found in environment variables. Falling back to mock.")
            raise ValueError("No Gemini API key found. Using mock fallback.")
            
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel('gemini-1.5-flash')
        
        if "," in b64_image:
            b64_image = b64_image.split(",")[1]
            
        img_data = base64.b64decode(b64_image)
        image_parts = [{"mime_type": "image/png", "data": img_data}]
        
        instructions = f"""You are 'The Draw Judge', a playful, family-friendly, and slightly eccentric art critic for a multiplayer party game.
The drawing prompt was: "{prompt_text}"

Review this player's drawing and score it out of 10 on the following metrics:
1. prompt_relevance: Did the drawing match the prompt? (0-10)
2. creativity: Did they add a funny or original twist? (0-10)
3. clarity: Can you reasonably tell what it is? (0-10)
4. entertainment: Is it amusing, charming, or surprisingly good/bad? (0-10)

Your overall tone should be lighthearted, funny, and NEVER insulting or mean.

You MUST respond STRICTLY in JSON:
{{
  "scores": {{ "prompt_relevance": 8, "creativity": 7, "clarity": 6, "entertainment": 9 }},
  "total_score": 30,
  "comment": "Funny comment here!"
}}"""
        
        response = await asyncio.to_thread(
            model.generate_content,
            contents=[instructions, image_parts[0]],
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json"
            )
        )
        
        data = json.loads(response.text)
        return AIScoreResponse(
            submission_id=player_id,
            scores=ScoreBreakdown(**data["scores"]),
            total_score=data["total_score"],
            comment=data["comment"]
        )
    except Exception as e:
        print(f"FAILED AI generation for {player_id}. Error: {e}")
        traceback.print_exc()
        await asyncio.sleep(2)
        return get_mock_score(player_id, prompt_text)

async def evaluate_submissions(prompt: str, submissions: Dict[str, dict]) -> List[AIScoreResponse]:
    print(f"Evaluating {len(submissions)} submissions for prompt: {prompt}")
    tasks = []
    for player_id, data in submissions.items():
        b64_img = data.get("image", "")
        tasks.append(evaluate_single(player_id, prompt, b64_img))
        
    results = list(await asyncio.gather(*tasks))
    results.sort(key=lambda x: x.total_score, reverse=True)
    return results
