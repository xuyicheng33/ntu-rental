#!/bin/zsh
cd "$(dirname "$0")" || exit 1

./update.sh
status=$?

echo
if [ "$status" -eq 0 ]; then
  echo "Update finished successfully."
else
  echo "Update failed with exit code $status."
fi
echo "Press Enter to close this window."
read _
exit "$status"
