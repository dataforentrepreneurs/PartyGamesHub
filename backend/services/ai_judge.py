import os
import json
import asyncio
import random
import base64
from typing import Dict, List
import traceback
from models.schemas import AIScoreResponse, ScoreBreakdown  # type: ignore

try:
    import google.generativeai as genai  # type: ignore
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
    total_score = min(100, int(raw_score * 2))

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
            print("No GEMINI_API_KEY found in environment variables. Falling back to mock.")
            raise ValueError("No Gemini API key found. Using mock fallback.")
            
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel('gemini-1.5-flash')
        
        if "," in b64_image:
            b64_image = b64_image.split(",")[1]
            
        img_data = base64.b64decode(b64_image)
        image_parts = [{"mime_type": "image/png", "data": img_data}]
        
        instructions = f"""You are 'The Draw Judge', a ruthless but hilarious art critic for a multiplayer drawing game.
The drawing prompt was: "{prompt_text}"

You must evaluate this player's drawing. DO NOT be overly generous. If the drawing is just a blank canvas, a minimal scribble, or completely ignores the prompt, you MUST give it VERY LOW scores (0 to 3)! Give high scores ONLY if it is a genuinely recognizable attempt at the prompt.
Score out of 10 on these metrics:
1. prompt_relevance: Does the drawing actually depict "{prompt_text}"? (0=No/Blank, 10=Perfectly)
2. creativity: Did they add a funny or original twist? (0=Boring/Blank, 10=Genius)
3. clarity: Can you reasonably tell what it is? (0=Unrecognizable scribble, 10=Very clear)
4. entertainment: Is it amusing, charming, or surprisingly good/bad? (0=Boring, 10=Hilarious)

Your comment should be funny, sarcastic, but family-friendly. Roast them slightly if the drawing is bad!

You MUST respond STRICTLY in JSON:
{{
  "is_scribble_or_blank": true,
  "scores": {{ "prompt_relevance": 2, "creativity": 3, "clarity": 1, "entertainment": 4 }},
  "total_score": 10,
  "comment": "Did you draw this with your eyes closed? It looks like a potato."
}}"""
        
        response = await asyncio.to_thread(
            model.generate_content,
            contents=[instructions, image_parts[0]],
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json"
            )
        )
        
        data = json.loads(response.text)
        scores_dict = data.get("scores", {})
        
        is_bad = data.get("is_scribble_or_blank", False)
        rel = int(scores_dict.get("prompt_relevance", 0))
        cre = int(scores_dict.get("creativity", 0))
        cla = int(scores_dict.get("clarity", 0))
        ent = int(scores_dict.get("entertainment", 0))
        
        if is_bad or rel <= 3:
            # Force max 15 points if AI explicitly flags it as a scribble or off-topic
            total_score = random.randint(0, 15)
        else:
            # Scale normally for valid drawings
            raw_score = (rel * 2) + cre + cla + ent
            total_score = min(100, int(raw_score * 2))
        
        return AIScoreResponse(
            submission_id=player_id,
            scores=ScoreBreakdown(**scores_dict),
            total_score=total_score,
            comment=data.get("comment", "")
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
