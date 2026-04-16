import os
from posthog import Posthog

POSTHOG_KEY = os.environ.get("POSTHOG_API_KEY") or os.environ.get("VITE_POSTHOG_KEY")
POSTHOG_HOST = os.environ.get("POSTHOG_HOST") or os.environ.get("VITE_POSTHOG_HOST") or "https://us.i.posthog.com"

ph_client = None
if POSTHOG_KEY:
    ph_client = Posthog(POSTHOG_KEY, host=POSTHOG_HOST)

def track_event(event_name: str, lobby_id: str, platform: str, user_role: str, device_id: str, player_count: int = None, properties: dict = None):
    if not ph_client:
        return
    
    if properties is None:
        properties = {}
        
    final_properties = {
        "lobby_id": lobby_id,
        "platform": platform,
        "user_role": user_role,
        "env": os.environ.get("ENVIRONMENT", "development"),
        "version": "1.0.0"
    }
    
    if player_count is not None:
        final_properties["player_count"] = player_count
        
    final_properties.update(properties)
    
    try:
        ph_client.capture(
            distinct_id=device_id,
            event=event_name,
            properties=final_properties
        )
        if event_name in ["lobby_created", "game_ended"]:
            ph_client.flush()
    except Exception as e:
        print(f"Tracking failed: {e}")
