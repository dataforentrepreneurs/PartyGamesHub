from PIL import Image
import os

# Paths
# The user provided a final source image that already contains the logo and TV screen replacement.
source_banner_path = r"C:\Users\sahai\.gemini\antigravity\brain\62d5258d-7bbc-4e0f-908c-82da20739227\tv_banner_source.png"
output_banner_path = r"d:\DataForEntrepreneurs\PartyGamesHub\SharedAssets\modified_banner_source.png"
feature_graphic_path = r"d:\DataForEntrepreneurs\PartyGamesHub\SharedAssets\feature_graphic_1024x500.png"

# Load image
banner = Image.open(source_banner_path).convert("RGBA")

# Save as the "modified" source for consistency with resize_banners.py
banner.save(output_banner_path)
print(f"Banner source saved to {output_banner_path}")

# Generate 1024x500 Feature Graphic
# We'll crop to capture the main title and the TV screen.
crop_box = (0, 70, 1024, 570) # (left, upper, right, lower)
feature_graphic = banner.crop(crop_box)
feature_graphic = feature_graphic.resize((1024, 500), Image.Resampling.LANCZOS)
feature_graphic.save(feature_graphic_path)
print(f"Feature Graphic (1024x500) generated at {feature_graphic_path}")
