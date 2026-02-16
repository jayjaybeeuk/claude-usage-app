#!/usr/bin/env bash
set -euo pipefail

# Generate all platform icons from Apple Icon Composer exports
# Requires: sips, iconutil (macOS built-in), python3 with Pillow

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ASSETS_DIR="$SCRIPT_DIR/../assets"
EXPORTS_DIR="$ASSETS_DIR/Claude Usage App Exports"
ICON_BUNDLE="$ASSETS_DIR/Claude Usage App.icon/Assets/Image.png"
DEFAULT_ICON="$EXPORTS_DIR/Claude Usage App-iOS-Default-1024x1024@1x.png"

# Verify source files exist
if [ ! -f "$DEFAULT_ICON" ]; then
  echo "Error: Default icon not found at:"
  echo "  $DEFAULT_ICON"
  echo ""
  echo "Export icons from Apple Icon Composer first:"
  echo "  Open assets/Claude Usage App.icon in Icon Composer"
  echo "  File > Export > save to assets/Claude Usage App Exports/"
  exit 1
fi

if [ ! -f "$ICON_BUNDLE" ]; then
  echo "Error: Raw artwork not found at:"
  echo "  $ICON_BUNDLE"
  exit 1
fi

echo "Generating icons from: $DEFAULT_ICON"
echo ""

# --- macOS .icns (via sips + iconutil) ---
echo "→ Generating icon.icns (macOS)..."
ICONSET="$ASSETS_DIR/icon.iconset"
mkdir -p "$ICONSET"
sips -z   16   16 "$DEFAULT_ICON" --out "$ICONSET/icon_16x16.png"      > /dev/null
sips -z   32   32 "$DEFAULT_ICON" --out "$ICONSET/icon_16x16@2x.png"   > /dev/null
sips -z   32   32 "$DEFAULT_ICON" --out "$ICONSET/icon_32x32.png"      > /dev/null
sips -z   64   64 "$DEFAULT_ICON" --out "$ICONSET/icon_32x32@2x.png"   > /dev/null
sips -z  128  128 "$DEFAULT_ICON" --out "$ICONSET/icon_128x128.png"    > /dev/null
sips -z  256  256 "$DEFAULT_ICON" --out "$ICONSET/icon_128x128@2x.png" > /dev/null
sips -z  256  256 "$DEFAULT_ICON" --out "$ICONSET/icon_256x256.png"    > /dev/null
sips -z  512  512 "$DEFAULT_ICON" --out "$ICONSET/icon_256x256@2x.png" > /dev/null
sips -z  512  512 "$DEFAULT_ICON" --out "$ICONSET/icon_512x512.png"    > /dev/null
sips -z 1024 1024 "$DEFAULT_ICON" --out "$ICONSET/icon_512x512@2x.png" > /dev/null
iconutil -c icns "$ICONSET" -o "$ASSETS_DIR/icon.icns"
rm -rf "$ICONSET"
echo "  ✓ assets/icon.icns"

# --- Windows .ico + Linux .png + tray icon (via Python/Pillow) ---
python3 << PYEOF
from PIL import Image

assets = "$ASSETS_DIR"

# Load Default icon (1024x1024 with iOS mask)
img = Image.open("$DEFAULT_ICON")

# Windows .ico — multi-resolution
img.save(f"{assets}/icon.ico", format="ICO",
         sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
print("  ✓ assets/icon.ico (Windows)")

# Linux .png — 512x512
img.resize((512, 512), Image.LANCZOS).save(f"{assets}/icon.png", format="PNG")
print("  ✓ assets/icon.png (Linux)")

# Tray icon — black silhouette from raw ring artwork (no iOS mask)
# macOS setTemplateImage(true) uses alpha channel only
tray_src = Image.open("$ICON_BUNDLE").convert('RGBA')
r, g, b, a = tray_src.split()
black = Image.new('L', tray_src.size, 0)
Image.merge('RGBA', (black, black, black, a)).save(f"{assets}/tray-icon.png", format="PNG")
print("  ✓ assets/tray-icon.png (tray/menu bar)")
PYEOF

echo ""
echo "Done! All icons generated."
