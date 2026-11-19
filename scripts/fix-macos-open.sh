#!/bin/zsh
# Clears Gatekeeper quarantine and ad-hoc signs Meeting Cue so macOS
# stops saying the app is "damaged" (unsigned download).

set -e
APP="/Applications/Meeting Cue.app"

if [ ! -d "$APP" ]; then
  echo "Meeting Cue not found at: $APP"
  echo "Drag it to Applications from the DMG first, then run this again."
  exit 1
fi

echo "Removing quarantine attributes..."
xattr -cr "$APP"

echo "Ad-hoc signing..."
codesign --force --deep --sign - "$APP"

echo "Opening Meeting Cue..."
open "$APP"
echo "Done."
