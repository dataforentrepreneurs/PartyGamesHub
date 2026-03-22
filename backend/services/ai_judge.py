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
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]  # type: ignore
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]  # type: ignore
        text = "\n".join(lines).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError(f"Model did not return valid JSON: {text[:300]}")  # type: ignore

    return json.loads(text[start:end + 1])  # type: ignore

async def evaluate_submissions(prompt: str, submissions: Dict[str, dict]) -> List[AIScoreResponse]:
    print(f"Evaluating {len(submissions)} submissions for prompt: {prompt} in a single batch request.")
    
    if not submissions:
        return []

    client = None
    try:
        client = get_gemini_client()
    except Exception as e:
        error_msg = str(e) or type(e).__name__
        print(f"FAILED to initialize AI Client. Error: {error_msg}")
        return _fallback_all_to_mock(submissions, prompt, error_msg)

    instructions = f"""
You are 'The Draw Judge', a playful but strict art critic for a multiplayer drawing game.
The drawing prompt was: "{prompt}"

You are evaluating multiple players' drawings at once.
Below, I will provide the images in order. Each image corresponds to a specific SUBMISSION_ID.

Scoring rules:
- If a drawing is blank, near-blank, random scribble, or ignores the prompt, score very low.
- Give high scores only if it is a recognizable attempt at the prompt.
- Score each field (prompt_relevance, creativity, clarity, entertainment) from 0 to 10.
- Comments must be short, funny, and family-friendly.

Return STRICT JSON ONLY. Do not wrap in markdown blocks. Format exactly like this:
{{
  "evaluations": [
    {{
      "submission_id": "player_1_id_here",
      "is_scribble_or_blank": true,
      "scores": {{
        "prompt_relevance": 2,
        "creativity": 3,
        "clarity": 1,
        "entertainment": 4
      }},
      "comment": "Did you draw this with your eyes closed? It looks like a potato."
    }}
  ]
}}
"""

    contents = [instructions]
    
    for player_id, data in submissions.items():
        b64_img = data.get("image", "")
        if "," in b64_img:
            b64_img = b64_img.split(",", 1)[1]
            
        try:
            img_data = base64.b64decode(b64_img)
            contents.append(f"Image for SUBMISSION_ID: {player_id}")
            contents.append(types.Part.from_bytes(data=img_data, mime_type="image/png"))
        except Exception:
            continue

    models_to_try = [
        os.environ.get("GEMINI_MODEL", "gemini-2.0-flash"),
        "gemini-1.5-pro-latest",
        "gemini-1.5-flash-latest",
        "gemini-1.5-flash",
        "gemini-1.5-pro"
    ]
    
    response = None
    last_error = ""

    for model_name in models_to_try:
        try:
            print(f"Attempting to evaluate batch using model: {model_name}")
            def _call_model():
                return client.models.generate_content(
                    model=model_name,
                    contents=contents,
                )
            
            # Using 45 timeout due to batch size requiring longer processing
            response = await asyncio.wait_for(asyncio.to_thread(_call_model), timeout=45)  # type: ignore
            break # Success!
        except Exception as e:
            last_error = str(e) or type(e).__name__
            print(f"Model {model_name} failed: {last_error}")
            continue

    if not response:
        print(f"All models failed batch evaluation. Generating Mocks. Last trace: {last_error}")
        return _fallback_all_to_mock(submissions, prompt, last_error)

    try:
        text = response.text or ""  # type: ignore
        data = extract_json(text)
        
        evaluations_list = data.get("evaluations", [])
        final_scores = []
        
        # Map back to models
        for eval_data in evaluations_list:
            pid = eval_data.get("submission_id")
            if pid not in submissions:
                continue
                
            scores_dict = eval_data.get("scores", {})
            rel = clamp_score(scores_dict.get("prompt_relevance", 0))
            cre = clamp_score(scores_dict.get("creativity", 0))
            cla = clamp_score(scores_dict.get("clarity", 0))
            ent = clamp_score(scores_dict.get("entertainment", 0))
    
            is_bad = bool(eval_data.get("is_scribble_or_blank", False))
    
            if is_bad or rel <= 3:
                total_score = random.randint(0, 15)
            else:
                raw_score = (rel * 2) + cre + cla + ent
                total_score = min(100, int(raw_score * 2))
                
            final_scores.append(AIScoreResponse(
                submission_id=pid,
                scores=ScoreBreakdown(
                    prompt_relevance=rel,
                    creativity=cre,
                    clarity=cla,
                    entertainment=ent,
                ),
                total_score=total_score,
                comment=str(eval_data.get("comment", "")).strip(),
                is_mock=False,
            ))
            
        # Ensure anyone who was skipped gets a mock score
        missing_pids = set(submissions.keys()) - set(s.submission_id for s in final_scores)
        for missing_pid in missing_pids:
            final_scores.append(get_mock_score(missing_pid, prompt))
            
        final_scores.sort(key=lambda x: x.total_score, reverse=True)
        return final_scores

    except Exception as e:
        error_msg = str(e) or type(e).__name__
        print(f"FAILED AI batch parsing. Error: {error_msg}")
        traceback.print_exc()
        return _fallback_all_to_mock(submissions, prompt, error_msg)

def _fallback_all_to_mock(submissions: Dict[str, dict], prompt: str, error_msg: str) -> List[AIScoreResponse]:
    results = []
    for pid in submissions.keys():
        mock_res = get_mock_score(pid, prompt)
        if "No Gemini API key found" in error_msg:
            mock_res.comment = f"[DEV: NO API KEY] {mock_res.comment}"
        else:
            mock_res.comment = f"[DEV: AI ERROR - {error_msg}] {mock_res.comment}"
        results.append(mock_res)
        
    results.sort(key=lambda x: x.total_score, reverse=True)
    return results
