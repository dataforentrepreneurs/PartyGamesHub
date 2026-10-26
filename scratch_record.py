
import os
import sys
import time
import subprocess
from playwright.sync_api import sync_playwright
import imageio_ffmpeg

OUTPUT_DIR = r"D:\DataForEntrepreneurs\PartyGamesHub"
TEMP_VIDEO_DIR = r"D:\DataForEntrepreneurs\PartyGamesHub\scratch_video"
os.makedirs(TEMP_VIDEO_DIR, exist_ok=True)

ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
print(f"Using FFmpeg: {ffmpeg_exe}", flush=True)

def record_session():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--enable-gpu", "--no-sandbox", "--disable-dev-shm-usage"]
        )

        context = browser.new_context(
            viewport={"width": 1920, "height": 1080},
            record_video_dir=TEMP_VIDEO_DIR,
            record_video_size={"width": 1920, "height": 1080}
        )
        page = context.new_page()

        # Scene 1: Party Games Hub Launcher
        print("Scene 1: Loading Party Games Hub...", flush=True)
        page.goto("http://localhost:4173/", wait_until="domcontentloaded")
        page.wait_for_timeout(2500)

        try:
            draw_card = page.locator(".game-card").first
            if draw_card.is_visible():
                draw_card.hover()
                page.wait_for_timeout(1500)
            
            cc_card = page.locator(".game-card").nth(1)
            if cc_card.is_visible():
                cc_card.hover()
                page.wait_for_timeout(1500)
        except Exception as e:
            print(f"Hover notice: {e}", flush=True)

        # Scene 2: Drawing Canvas
        print("Scene 2: Drawing Canvas in Draw Judge...", flush=True)
        page.goto("http://localhost:4173/drawjudge/index.html?test=draw", wait_until="domcontentloaded")
        page.wait_for_timeout(2000)

        try:
            canvas = page.locator("canvas")
            if canvas.is_visible():
                box = canvas.bounding_box()
                if box:
                    cx = box["x"] + box["width"] / 2
                    cy = box["y"] + box["height"] / 2

                    page.mouse.move(cx - 60, cy - 60)
                    page.mouse.down()
                    for angle in range(0, 360, 30):
                        import math
                        rad = math.radians(angle)
                        page.mouse.move(cx + math.cos(rad) * 45, cy + math.sin(rad) * 45)
                        page.wait_for_timeout(20)
                    page.mouse.up()
                    page.wait_for_timeout(300)

                    # Smile
                    page.mouse.move(cx - 20, cy + 10)
                    page.mouse.down()
                    for step in range(-20, 25, 8):
                        page.mouse.move(cx + step, cy + 10 + (step**2) / 35)
                        page.wait_for_timeout(20)
                    page.mouse.up()
                    page.wait_for_timeout(300)
        except Exception as e:
            print(f"Canvas drawing notice: {e}", flush=True)

        page.wait_for_timeout(1500)

        # Scene 3: Host Grand Champion Podium Ceremony
        print("Scene 3: Host Grand Champion Ceremony...", flush=True)
        page.goto("http://localhost:4173/drawjudge/index.html?test=winner_host_2p", wait_until="domcontentloaded")
        page.wait_for_timeout(4000)

        try:
            champ_card = page.locator(".champion-card-first")
            if champ_card.is_visible():
                champ_card.hover()
                page.wait_for_timeout(1500)

            second_card = page.locator(".champion-card-second")
            if second_card.is_visible():
                second_card.hover()
                page.wait_for_timeout(2000)
        except Exception as e:
            print(f"Cards hover notice: {e}", flush=True)

        # Scene 4: Mobile Player Experience & Interactive Standings
        print("Scene 4: Mobile Player Standings & Art Gallery...", flush=True)
        page.set_viewport_size({"width": 430, "height": 932})
        page.goto("http://localhost:4173/drawjudge/index.html?test=results_player", wait_until="domcontentloaded")
        page.wait_for_timeout(2000)

        # Tab 2: All Drawings
        try:
            tab2 = page.locator("button:has-text('All Drawings')")
            if tab2.is_visible():
                tab2.click()
                page.wait_for_timeout(2000)
        except Exception as e:
            print(f"Tab 2 notice: {e}", flush=True)

        # Tab 3: Standings & Click Bob Wonder
        try:
            tab3 = page.locator("button:has-text('Standings')")
            if tab3.is_visible():
                tab3.click()
                page.wait_for_timeout(1800)

            bob_row = page.locator(".leaderboard-row:has-text('Bob Wonder')")
            if bob_row.is_visible():
                bob_row.hover()
                page.wait_for_timeout(600)
                bob_row.click()
                page.wait_for_timeout(3500)

                close_btn = page.locator(".player-history-close-btn")
                if close_btn.is_visible():
                    close_btn.click()
                    page.wait_for_timeout(1500)
        except Exception as e:
            print(f"Standings interaction notice: {e}", flush=True)

        page.wait_for_timeout(1500)

        # Finalizing video
        print("Finalizing video recording...", flush=True)
        video = page.video
        page.close()
        context.close()
        raw_video_path = video.path() if video else None
        browser.close()

        print(f"Raw video path: {raw_video_path}", flush=True)
        return raw_video_path

if __name__ == "__main__":
    raw_video = record_session()
    if raw_video and os.path.exists(raw_video):
        output_mp4 = os.path.join(OUTPUT_DIR, "linkedin_demo.mp4")
        print(f"Encoding to MP4: {output_mp4}...", flush=True)
        cmd = [
            ffmpeg_exe,
            "-y",
            "-i", raw_video,
            "-c:v", "libx264",
            "-profile:v", "high",
            "-level", "4.2",
            "-pix_fmt", "yuv420p",
            "-crf", "20",
            "-preset", "fast",
            "-movflags", "+faststart",
            output_mp4
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode == 0:
            file_size_mb = os.path.getsize(output_mp4) / (1024 * 1024)
            print(f"SUCCESS! LinkedIn demo video created: {output_mp4} ({file_size_mb:.2f} MB)", flush=True)
        else:
            print(f"FFmpeg error: {res.stderr}", flush=True)
    else:
        print("No raw video was generated.", flush=True)
