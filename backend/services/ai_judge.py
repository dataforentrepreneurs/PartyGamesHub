import os
import json
import asyncio
import random
import base64
from typing import Dict, List
from models.schemas import AIScoreResponse, ScoreBreakdown # pyre-ignore

try:
    from google import genai # pyre-ignore
    from google.genai import types # pyre-ignore
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
    raw_score = (rel * 2) + cre + cla + ent
    total_score = int(raw_score * 2)  # Max 100

    return AIScoreResponse(
        submission_id=player_id, 
        scores=ScoreBreakdown(prompt_relevance=rel, creativity=cre, clarity=cla, entertainment=ent),
        total_score=total_score,
        comment=random.choice(comments)
    )

async def evaluate_single(player_id: str, prompt_text: str, b64_image: str) -> AIScoreResponse:
    try:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not HAS_GENAI or not api_key:
            raise ValueError("No Gemini API key found. Using mock fallback.")
            
        client = genai.Client(api_key=api_key)
        
        # Parse base64
        if "," in b64_image:
            b64_image = b64_image.split(",")[1]
            
        img_data = base64.b64decode(b64_image)
        image_part = types.Part.from_bytes(data=img_data, mime_type="image/png")
        
        instructions = f"""You are 'The Draw Judge', a playful but strict art critic for a multiplayer party game.
The drawing prompt was: "{prompt_text}"

Review this player's drawing and score it out of 10 on the following metrics:
1. prompt_relevance: Does the drawing actually depict "{prompt_text}"? (0-10). If it completely ignores the prompt or is just random scribbles, give a 0.
2. creativity: Did they add a funny or original twist to the prompt? (0-10)
3. clarity: Can you reasonably tell what it is without knowing the prompt? (0-10)
4. entertainment: Is it amusing, charming, or surprisingly good/bad? (0-10)

CRITICAL RULE: If the drawing is irrelevant to the prompt (prompt_relevance <= 3), you MUST heavily track down the other scores as well. An off-topic drawing should get a terrible total score, no matter how good it looks.

Your overall tone should be lighthearted, funny, and NEVER insulting or mean.

You MUST respond STRICTLY in JSON:
{{
  "scores": {{ "prompt_relevance": 8, "creativity": 7, "clarity": 6, "entertainment": 9 }},
  "comment": "Funny comment here!"
}}"""
        
        response = await asyncio.to_thread(
            client.models.generate_content,
            model='gemini-1.5-flash',
            contents=[instructions, image_part],
            config=types.GenerateContentConfig(response_mime_type="application/json")
        )
        
        data = json.loads(response.text)
        scores_dict = data.get("scores", {})
        
        # Ensure scores are integers
        rel = int(scores_dict.get("prompt_relevance", 0))
        cre = int(scores_dict.get("creativity", 0))
        cla = int(scores_dict.get("clarity", 0))
        ent = int(scores_dict.get("entertainment", 0))
        
        # Recalculate total_score to heavily emphasize prompt relevance
        if rel <= 3:
            # Massive penalty for entirely off-topic drawings
            raw_score = (rel + cre + cla + ent) * 0.5
        else:
            # Relevance counts double to ensure the best ON TOPIC drawing wins
            raw_score = (rel * 2) + cre + cla + ent
            
        # Scale to out of 100 (max raw_score is 50, so multiply by 2)
        total_score = int(raw_score * 2)
            
        return AIScoreResponse(
            submission_id=player_id,
            scores=ScoreBreakdown(prompt_relevance=rel, creativity=cre, clarity=cla, entertainment=ent),
            total_score=total_score,
            comment=data.get("comment", "")
        )
    except Exception as e:
        print(f"Using mock AI judge for {player_id} (API key not provided or error: {e})")
        await asyncio.sleep(2) # Fake processing delay
        return get_mock_score(player_id, prompt_text)

async def evaluate_submissions(prompt: str, submissions: Dict[str, dict]) -> List[AIScoreResponse]:
    """
    Evaluates player drawings using Gemini.
    `submissions` is a dict of player_id -> {"image": base64_image}
    """
    print(f"Evaluating {len(submissions)} submissions for prompt: {prompt}")
    
    # Run evaluation concurrently for speed
    tasks = []
    for player_id, data in submissions.items():
        b64_img = data.get("image", "")
        tasks.append(evaluate_single(player_id, prompt, b64_img))
        
    results = list(await asyncio.gather(*tasks))
    
    # Sort highest score first to determine ranks
    results.sort(key=lambda x: x.total_score, reverse=True)
    return results
