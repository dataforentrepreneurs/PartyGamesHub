import os
import json
import asyncio
import random
import base64
import traceback
import time
from typing import Dict, List, Optional

from models.schemas import AIScoreResponse, ScoreBreakdown, BatchEvaluationResult  # type: ignore

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

async def evaluate_submissions(prompt: str, submissions: Dict[str, dict], theme: str = "Family") -> BatchEvaluationResult:
    print(f"Evaluating {len(submissions)} submissions for prompt: {prompt} in a single batch request.")
    
    if not submissions:
        return BatchEvaluationResult(
            results=[],
            round_summary="Nobody drew anything. Is this an art strike?",
            winner_explanation="Nobody wins, because nobody played."
        )

    client = None
    try:
        client = get_gemini_client()
    except Exception as e:
        error_msg = str(e) or type(e).__name__
        print(f"FAILED to initialize AI Client. Error: {error_msg}")
        return _fallback_all_to_mock(submissions, prompt, error_msg)

    persona_map = {
        "Couples": "Sarcastic Relationship Counselor who roasts drawings based on how much they would annoy a partner.",
        "Kids": "Kind Kindergarten Teacher who gives gold stars and avoids sarcasm.",
        "Office": "Stressed-out Middle Manager who is tired of Zoom calls and broken printers.",
        "Family": "playful but strict art critic.",
    }
    persona = persona_map.get(theme, persona_map["Family"])

    instructions = f"""
You are 'The Draw Judge', a {persona}
The drawing prompt was: "{prompt}"

You are evaluating all players' drawings at once.
Below, I will provide the images in order. Each image corresponds to a specific SUBMISSION_ID.

Scoring & Persona rules:
- CRITICAL: If a drawing is completely blank or near-blank, you MUST score 0 in all fields and set "is_scribble_or_blank": true.
- If it's a random scribble wildly ignoring the prompt, penalize it heavily.
- Give high scores only if it is a verifiable attempt at the prompt.
- Score each field (prompt_relevance, creativity, clarity, entertainment) from 0 to 10.
- Keep comments UNDER 1 SENTENCE! Make it punchy and funny (aligned with your current persona: {persona}).
- Since you can see every submission, compare drawings to each other when possible for comedic effect!

Return STRICT JSON ONLY. Do not wrap in markdown blocks. Format exactly like this:
{{
  "round_summary": "One actual cat, two socks, and one existential crisis.",
  "winner_explanation": "Player 1 won because it was the only one that didn't look like a potato.",
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

    # models_to_try = [
    #     os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
    #     "gemini-3-flash-preview",
    #     "gemini-3.1-flash-lite-preview",
    #     "gemini-3.1-pro-preview",
    #     "gemini-3-flash",
    #     "gemini-3.1-flash-lite",
    #     "gemini-3.1-pro"
    # ]

    models_to_try = [
        # Check environment variable first
        os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
       
        # 2026 Stable Models (GA)
        "gemini-2.5-flash",          # Best balance of speed/cost for party games
        "gemini-2.5-pro",            # High intelligence for complex drawings
        "gemini-3-flash",
       
        # 2026 Newest Previews (Require -preview suffix)
        "gemini-3.1-flash-lite-preview",
        "gemini-3.1-pro-preview",
        "gemini-3-flash-preview"
    ]
    
    response = None
    last_error = ""
    start_time = time.perf_counter()

    for model_name in models_to_try:
        try:
            print(f"Attempting to evaluate batch using model: {model_name}")
            def _call_model():
                return client.models.generate_content(  # type: ignore
                    model=model_name,
                    contents=contents,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json"
                    )
                )
            
            # Using 12 second timeout for extreme responsiveness
            response = await asyncio.wait_for(asyncio.to_thread(_call_model), timeout=12)  # type: ignore
            break # Success!
        except Exception as e:
            last_error = str(e) or type(e).__name__
            print(f"Model {model_name} failed: {last_error}")
            continue

    latency = float(time.perf_counter() - start_time)
    if not response:
        print(f"All models failed batch evaluation. Generating Mocks. Last trace: {last_error}")
        return _fallback_all_to_mock(submissions, prompt, last_error, latency)

    try:
        text = response.text or ""  # type: ignore
        data = extract_json(text)
        
        evaluations_list = data.get("evaluations", [])
        round_summary = data.get("round_summary", "An indescribable round of chaos.")
        winner_explanation = data.get("winner_explanation", "The winner won because the AI got lazy.")
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
    
            if is_bad:
                total_score = 0
            elif rel <= 3:
                raw_score = (rel * 2) + cre + cla + ent
                total_score = min(20, int(raw_score * 0.5))
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
        return BatchEvaluationResult(
            results=final_scores,
            round_summary=round_summary,
            winner_explanation=winner_explanation,
            ai_latency_seconds=latency
        )

    except Exception as e:
        error_msg = str(e) or type(e).__name__
        print(f"FAILED AI batch parsing. Error: {error_msg}")
        traceback.print_exc()
        return _fallback_all_to_mock(submissions, prompt, error_msg, latency)

def _fallback_all_to_mock(submissions: Dict[str, dict], prompt: str, error_msg: str, latency: float = 0.0) -> BatchEvaluationResult:
    results = []
    for pid in submissions.keys():
        mock_res = get_mock_score(pid, prompt)
        if "No Gemini API key found" in error_msg:
            mock_res.comment = f"[DEV: NO API KEY] {mock_res.comment}"
        else:
            mock_res.comment = f"[DEV: AI ERROR - {error_msg}] {mock_res.comment}"
        results.append(mock_res)
        
    results.sort(key=lambda x: x.total_score, reverse=True)
    
    mock_reason = "No API Key provided" if "API key" in error_msg else "API Error"
    
    return BatchEvaluationResult(
        results=results,
        round_summary=f"The judge was asleep ({mock_reason}). Everyone gets arbitrary mock scores!",
        winner_explanation="The winner probably bribed the mock AI judge.",
        ai_latency_seconds=latency
    )

async def generate_creative_prompt(theme: str = "Family") -> str:
    try:
        client = get_gemini_client()
        model_name = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
        
        instructions = f"You are a creative party game host. Generate exactly ONE very funny, highly unique DRAWING PROMPT for a drawing game. The theme for this round is '{theme}'.\n"
        instructions += "CRITICAL RULE: The prompt MUST BE a maximum of 10-12 words long. Keep it short, punchy, and scenario-based. DO NOT WRITE PARAGRAPHS OR LONG SCENES.\n"
        if theme == "Couples":
            instructions += "Make it about relatable relationship arguments, couple tropes, or slightly petty domestic situations (e.g., 'Arguing over the TV remote', 'Who forgot to take out the trash').\n"
        elif theme == "Kids":
            instructions += "Make it extremely family friendly, silly, and appealing to young kids (e.g., 'A pizza with eyeballs', 'A superhero duck').\n"
        elif theme == "Office":
            instructions += "Make it about corporate life, annoyed coworkers, or relatable office chaos (e.g., 'The printer is jammed again', 'Zoom call in pajamas').\n"
        else:
            instructions += "Make it unexpected, slightly absurd, but very drawable. For example: 'A cat teaching a yoga class' or 'A toaster running for President'.\n"

        instructions += "ONLY return the prompt string itself, no quotes, no extra text."
        
        def _call_model():
            return client.models.generate_content(  # type: ignore
                model=model_name,
                contents=instructions
            )
        
        response = await asyncio.wait_for(asyncio.to_thread(_call_model), timeout=8) # type: ignore
        return str(response.text).strip()  # type: ignore
    except Exception as e:
        print(f"Failed AI prompt generation: {e}")
        return ""
