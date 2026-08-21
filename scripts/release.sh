#!/usr/bin/env bash
#
# 버전을 올리고 태그를 만든다.
#
#   ./scripts/release.sh 0.2.0
#
# 버전이 적힌 곳이 package.json / tauri.conf.json 두 군데라 손으로 맞추면
# 반드시 어긋난다. 릴리스 워크플로가 태그와의 일치를 검사하므로,
# 어긋난 채 푸시하면 빌드가 시작하자마자 멈춘다.
set -euo pipefail

VERSION="${1:-}"

if [[ -z "$VERSION" ]]; then
  echo "사용법: ./scripts/release.sh 0.2.0" >&2
  exit 1
fi

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "버전 형식이 잘못됐습니다: $VERSION (예: 0.2.0)" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

if [[ -n "$(git status --porcelain)" ]]; then
  echo "커밋되지 않은 변경사항이 있습니다. 먼저 정리하세요." >&2
  git status --short >&2
  exit 1
fi

if git rev-parse "v$VERSION" >/dev/null 2>&1; then
  echo "태그 v$VERSION 이 이미 있습니다." >&2
  exit 1
fi

echo "==> 버전 갱신: $VERSION"

npm pkg set version="$VERSION"

node -e "
  const fs = require('fs');
  const p = 'src-tauri/tauri.conf.json';
  const c = JSON.parse(fs.readFileSync(p, 'utf8'));
  c.version = '$VERSION';
  fs.writeFileSync(p, JSON.stringify(c, null, 2) + '\n');
"

# Cargo.toml 의 version 도 맞춰 둔다. 빌드 산출물 이름에 쓰이지는 않지만
# cargo 명령이 보여주는 값이 화면 버전과 달라지면 혼란스럽다.
node -e "
  const fs = require('fs');
  const p = 'src-tauri/Cargo.toml';
  const s = fs.readFileSync(p, 'utf8').replace(/^version = \".*\"/m, 'version = \"$VERSION\"');
  fs.writeFileSync(p, s);
"

# Cargo.lock 의 dayflow 항목도 함께 갱신한다.
cargo update --manifest-path src-tauri/Cargo.toml -p dayflow --quiet 2>/dev/null || true

git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: release v$VERSION"
git tag "v$VERSION"

echo
echo "완료했습니다. 다음 명령으로 배포를 시작하세요:"
echo
echo "    git push && git push origin v$VERSION"
echo
echo "Actions 가 Windows / macOS(ARM·Intel) 빌드를 만들어 초안 Release 에 올립니다."
echo "확인한 뒤 GitHub 에서 릴리스를 게시하세요."
