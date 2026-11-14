#!/bin/zsh
# Build the app and install it on an iPhone connected to this Mac, signed with a free Apple ID.
#
# A free Apple ID (Xcode's "Personal Team") can install on your own phone, but the app expires after 7 days
# and can't use Sign in with Apple, so this build leaves that capability out. Everything that needs no
# account works: listening, Discover and downloads.
#
# Once:
#   1. Xcode → Settings → Accounts → + → Apple ID (your own).
#   2. Connect the iPhone with a cable, unlock it, tap "Trust This Computer". After that, the same Wi-Fi as
#      the Mac is enough (keep the iPhone unlocked while it installs).
#   3. iPhone: Settings → Privacy & Security → Developer Mode → on (it restarts).
# Then:
#   ios/scripts/run-on-phone.sh            (or TEAM=XXXXXXXXXX ios/scripts/run-on-phone.sh)
# The first time, the iPhone asks you to trust the developer:
#   Settings → General → VPN & Device Management → your Apple ID → Trust. Then open Eksigo.
set -euo pipefail
cd "$(dirname "$0")/.."

# A phone on the cable ("connected") first, otherwise one paired before that is on the same Wi-Fi ("available").
find_device() {
  xcrun devicectl list devices 2>/dev/null \
    | awk -v want="$1" '$0 ~ want && /physical/ {for (i = 1; i <= NF; i++) if ($i ~ /^[0-9A-F-]{25,}$/) {print $i; exit}}'
}
device=$(find_device "connected")
[[ -z $device ]] && device=$(find_device "available")
if [[ -z $device ]]; then
  echo "No iPhone found. Connect it with a cable (or put it on the same Wi-Fi after connecting it once),"
  echo "unlock it and trust this Mac, then run this again."
  exit 1
fi

team=${TEAM:-$(defaults read com.apple.dt.Xcode IDEProvisioningTeamByIdentifier 2>/dev/null \
  | grep -Eo 'teamID = [A-Z0-9]{10}' | head -1 | awk '{print $3}')}
if [[ -z $team ]]; then
  echo "No Apple ID team found in Xcode. Add your Apple ID in Xcode → Settings → Accounts,"
  echo "or pass it: TEAM=XXXXXXXXXX ios/scripts/run-on-phone.sh (the 10-character ID shown there)."
  exit 1
fi

# A Personal Team can't register com.eksigo.app if it's taken, so the phone build gets its own ID.
bundle=com.eksigo.app.dev.$team
echo "Building for device $device with team $team…"
xcodebuild build -project Eksigo.xcodeproj -scheme Eksigo -configuration Debug \
  -destination "id=$device" -derivedDataPath /tmp/eksigo-phone -allowProvisioningUpdates -quiet \
  DEVELOPMENT_TEAM="$team" CODE_SIGN_STYLE=Automatic CODE_SIGN_ENTITLEMENTS=Config/Phone.entitlements PRODUCT_BUNDLE_IDENTIFIER="$bundle"

app=/tmp/eksigo-phone/Build/Products/Debug-iphoneos/Eksigo.app
xcrun devicectl device install app --device "$device" "$app"
xcrun devicectl device process launch --device "$device" "$bundle" \
  || echo "Installed. If it doesn't open: Settings → General → VPN & Device Management → trust your Apple ID, then open Eksigo."
