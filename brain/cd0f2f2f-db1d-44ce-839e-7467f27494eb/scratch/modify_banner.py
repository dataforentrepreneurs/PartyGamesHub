from PIL import Image, ImageOps
import os

# Paths
source_banner_path = r"C:\Users\sahai\.gemini\antigravity\brain\62d5258d-7bbc-4e0f-908c-82da20739227\tv_banner_source_1776764943033.png"
dashboard_path = r"d:\DataForEntrepreneurs\PartyGamesHub\SharedAssets\Dashboard.png"
logo_path = r"d:\DataForEntrepreneurs\PartyGamesHub\SharedAssets\blue.png"
output_banner_path = r"d:\DataForEntrepreneurs\PartyGamesHub\SharedAssets\modified_banner_source.png"
feature_graphic_path = r"d:\DataForEntrepreneurs\PartyGamesHub\SharedAssets\feature_graphic_1024x500.png"

# Load images
banner = Image.open(source_banner_path).convert("RGBA")
dashboard = Image.open(dashboard_path).convert("RGBA")
logo = Image.open(logo_path).convert("RGBA")

# 1. Replace TV Screen
# Target TV screen area (roughly)
# [left, top, right, bottom]
tv_box = (664, 356, 946, 598)
tv_width = tv_box[2] - tv_box[0]
tv_height = tv_box[3] - tv_box[1]

# Resize dashboard to fit TV
dashboard_resized = dashboard.resize((tv_width, tv_height), Image.Resampling.LANCZOS)

# Paste dashboard onto banner
banner.paste(dashboard_resized, (tv_box[0], tv_box[1]), dashboard_resized)

# 2. Add Company Logo
# Resize logo to a reasonable size (e.g., 120x120)
logo_size = (120, 120)
logo_resized = logo.resize(logo_size, Image.Resampling.LANCZOS)

# Paste logo in the top-right corner area (avoiding existing UI text if possible)
# Or top-left near the "Android TV" text
logo_pos = (50, 50) 
banner.paste(logo_resized, logo_pos, logo_resized)

# Save the modified source
banner.save(output_banner_path)
print(f"Modified banner source saved to {output_banner_path}")

# 3. Generate 1024x500 Feature Graphic
# The Play Store feature graphic is 1024x500. 
# We'll crop the center-top part of our 1024x1024 banner.
# This keeps the "PartyGames Hub" title and the people/TV in view.
crop_box = (0, 70, 1024, 570) # (left, upper, right, lower)
feature_graphic = banner.crop(crop_box)
feature_graphic = feature_graphic.resize((1024, 500), Image.Resampling.LANCZOS)
feature_graphic.save(feature_graphic_path)
print(f"Feature Graphic (1024x500) saved to {feature_graphic_path}")
