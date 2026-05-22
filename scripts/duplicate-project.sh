#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: bash scripts/duplicate-project.sh <target-directory> [new-project-name]"
  echo "Example: bash scripts/duplicate-project.sh ../bakery-client-2 bakery-client-2"
  exit 1
fi

TARGET_DIR="$1"
NEW_PROJECT_NAME="${2:-}"
SOURCE_DIR="$(pwd)"

if [[ ! -f "$SOURCE_DIR/package.json" ]]; then
  echo "Error: run this command from the project root (where package.json exists)."
  exit 1
fi

if [[ "$TARGET_DIR" != /* ]]; then
  TARGET_DIR="$(cd "$SOURCE_DIR" && pwd)/$TARGET_DIR"
fi

if [[ -e "$TARGET_DIR" ]]; then
  echo "Error: target path already exists: $TARGET_DIR"
  exit 1
fi

mkdir -p "$TARGET_DIR"

rsync -a \
  --exclude ".git" \
  --exclude ".gitignore" \
  --exclude "node_modules" \
  --exclude ".vercel" \
  --exclude ".env" \
  --exclude ".env.*" \
  --exclude "bakery.db" \
  --exclude "bakery.db-shm" \
  --exclude "bakery.db-wal" \
  "$SOURCE_DIR/" "$TARGET_DIR/"

cp "$SOURCE_DIR/.gitignore" "$TARGET_DIR/.gitignore"

if [[ -f "$TARGET_DIR/vercel.json" ]]; then
  rm -f "$TARGET_DIR/vercel.json"
fi

if [[ -n "$NEW_PROJECT_NAME" ]]; then
  TARGET_PACKAGE="$TARGET_DIR/package.json"
  if command -v node >/dev/null 2>&1; then
    node -e '
      const fs = require("fs");
      const filePath = process.argv[1];
      const newName = process.argv[2];
      const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
      json.name = newName;
      fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + "\n");
    ' "$TARGET_PACKAGE" "$NEW_PROJECT_NAME"
  fi
fi

cat > "$TARGET_DIR/.env.example" << 'EOF'
JWT_SECRET=change-this-to-a-long-random-secret
ADMIN_ACCESS_CODE=CHANGE-ME
DATABASE_URL=
ALERT_EMAIL_TO=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
EOF

cat << EOF
Done. Clean project copy created at:
$TARGET_DIR

Next steps:
1. cd "$TARGET_DIR"
2. npm install
3. Fill .env.example values into your environment (.env locally or host env vars)
4. npm start
EOF
