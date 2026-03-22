import os
import json
import asyncio
import random
import base64
import traceback
from typing import Dict, List, Optional

from models.schemas import AIScoreResponse, ScoreBreakdown  # type: ignore

try:
    from google import genai  # type: ignore
    from google.genai import types # type: ignore
    HAS_GENAI = True
except ImportError:
    HAS_GENAI = False

_GEMINI_CLIENT: Optional["genai.Client"] = None

def get_gemini_client():
    global _GEMINI_CLIENT

    if not HAS_GENAI:
        raise ImportError("The 'google-genai' package is not installed. Failed to import.")

    if _GEMINI_CLIENT is None:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("No Gemini API key found.")
        _GEMINI_CLIENT = genai.Client(api_key=api_key)

    return _GEMINI_CLIENT

def get_model_name() -> str:
    # Use 2.0-flash as the new standard default for the V2 SDK
    return os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")

def clamp_score(value: int) -> int:
    return max(0, min(10, int(value)))

def get_mock_score(player_id: str, prompt: str) -> AIScoreResponse:
    rel = random.randint(6, 10)
    cre = random.randint(5, 10)
    cla = random.randint(4, 10)
    ent = random.randint(7, 10)

    comments = [
        f"A deeply moving interpretation of '{prompt}'. The abstraction is wild!",
        "I'm slightly confused, but completely entertained. A bold choice.",
        "Leonardo da Vinci is shaking right now. This is magnificent.",
        "It looks exactly like the prompt, if you squint and tilt your head.",
    ]

    raw_score = (rel * 2) + cre + cla + ent
    total_score = min(100, int(raw_score * 2))

    return AIScoreResponse(
        submission_id=player_id,
        scores=ScoreBreakdown(
            prompt_relevance=rel,
            creativity=cre,
            clarity=cla,
            entertainment=ent,
        ),
        total_score=total_score,
        comment=random.choice(comments),
        is_mock=True,
    )

def extract_json(text: str) -> dict:
    text = text.strip()

    if text.startswith("```"):
        # remove fenced code block if present
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Fallback: extract first JSON object
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError(f"Model did not return valid JSON: {text[:300]}")

    return json.loads(text[start:end + 1])

async def evaluate_single(player_id: str, prompt_text: str, b64_image: str) -> AIScoreResponse:
    try:
        client = get_gemini_client()
        model_name = get_model_name()

        if "," in b64_image:
            b64_image = b64_image.split(",", 1)[1]

        img_data = base64.b64decode(b64_image)

        instructions = f"""
You are 'The Draw Judge', a playful but strict art critic for a multiplayer drawing game.

The drawing prompt was: "{prompt_text}"

Evaluate this player's drawing.

Scoring rules:
- If the drawing is blank, near-blank, random scribble, or ignores the prompt, score very low.
- Give high scores only if it is a recognizable attempt at the prompt.

Return STRICT JSON only in this format:
{{
  "is_scribble_or_blank": true,
  "scores": {{
    "prompt_relevance": 2,
    "creativity": 3,
    "clarity": 1,
    "entertainment": 4
  }},
  "comment": "Did you draw this with your eyes closed? It looks like a potato."
}}

Score each field from 0 to 10:
- prompt_relevance
- creativity
- clarity
- entertainment

Comment must be short, funny, and family-friendly.
"""

        def _call_model():
            return client.models.generate_content(
                model=model_name,
                contents=[
                    instructions,
                    types.Part.from_bytes(data=img_data, mime_type="image/png"),
                ],
            )

        response = await asyncio.wait_for(asyncio.to_thread(_call_model), timeout=25)
        text = response.text or ""
        data = extract_json(text)

        scores_dict = data.get("scores", {})
        rel = clamp_score(scores_dict.get("prompt_relevance", 0))
        cre = clamp_score(scores_dict.get("creativity", 0))
        cla = clamp_score(scores_dict.get("clarity", 0))
        ent = clamp_score(scores_dict.get("entertainment", 0))

        is_bad = bool(data.get("is_scribble_or_blank", False))

        if is_bad or rel <= 3:
            total_score = random.randint(0, 15)
        else:
            raw_score = (rel * 2) + cre + cla + ent
            total_score = min(100, int(raw_score * 2))

        return AIScoreResponse(
            submission_id=player_id,
            scores=ScoreBreakdown(
                prompt_relevance=rel,
                creativity=cre,
                clarity=cla,
                entertainment=ent,
            ),
            total_score=total_score,
            comment=str(data.get("comment", "")).strip(),
            is_mock=False,
        )

    except Exception as e:
        error_msg = str(e) or type(e).__name__
        print(f"FAILED AI generation for {player_id}. Error: {error_msg}")
        traceback.print_exc()

        await asyncio.sleep(1)
        mock_res = get_mock_score(player_id, prompt_text)

        # Output the exact API error quietly in the mock string so we can debug live on Render if needed
        if "No Gemini API key found" in error_msg:
            mock_res.comment = f"[DEV: NO API KEY] {mock_res.comment}"
        else:
            mock_res.comment = f"[DEV: AI ERROR - {error_msg}] {mock_res.comment}"

        return mock_res

async def evaluate_submissions(prompt: str, submissions: Dict[str, dict]) -> List[AIScoreResponse]:
    print(f"Evaluating {len(submissions)} submissions for prompt: {prompt}")

    tasks = []
    for player_id, data in submissions.items():
        b64_img = data.get("image", "")
        tasks.append(evaluate_single(player_id, prompt, b64_img))

    results = list(await asyncio.gather(*tasks))
    results.sort(key=lambda x: x.total_score, reverse=True)
    return results
