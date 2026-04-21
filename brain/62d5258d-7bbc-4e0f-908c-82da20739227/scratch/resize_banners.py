from PIL import Image
import os

source_path = r"C:\Users\sahai\.gemini\antigravity\brain\62d5258d-7bbc-4e0f-908c-82da20739227\tv_banner_source_1776764943033.png"
base_res_path = r"d:\DataForEntrepreneurs\PartyGamesHub\Games\Launcher\android\app\src\main\res"

sizes = {
    "mipmap-mdpi": (320, 180),
    "mipmap-hdpi": (480, 270),
    "mipmap-xhdpi": (640, 360),
    "mipmap-xxhdpi": (960, 540),
    "mipmap-xxxhdpi": (1280, 720)
}

img = Image.open(source_path)

for folder, size in sizes.items():
    target_dir = os.path.join(base_res_path, folder)
    if not os.path.exists(target_dir):
        os.makedirs(target_dir)
    
    target_path = os.path.join(target_dir, "ic_tv_banner.png")
    print(f"Resizing to {size} and saving to {target_path}")
    
    # Use LANCZOS for high quality resizing
    resized_img = img.resize(size, Image.Resampling.LANCZOS)
    resized_img.save(target_path, "PNG")

print("All banners resized and saved successfully.")
