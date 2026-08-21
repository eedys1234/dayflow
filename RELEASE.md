# 배포 및 자동 업데이트 (GitHub Actions + GitHub Releases)

> **현재 상태**
> - 저장소: `eedys1234/dayflow`
> - 대상 OS: **Windows / macOS(Apple Silicon·Intel)** — Linux 는 제외
> - 실제 파일: [`.github/workflows/release.yml`](.github/workflows/release.yml) ·
>   [`.github/workflows/ci.yml`](.github/workflows/ci.yml) · [`scripts/release.sh`](scripts/release.sh)
> - 자동 업데이트는 **아직 꺼져 있습니다.** 서명 키를 만든 뒤 2·3절대로 켜세요.
>   (키 생성은 비밀번호 입력이 필요해 직접 하셔야 합니다.)

## 0. 버전 한 줄 요약

```bash
./scripts/release.sh 0.2.0 && git push && git push origin v0.2.0
```

`scripts/release.sh` 가 `package.json` / `tauri.conf.json` / `Cargo.toml` 세 곳의 버전을
한 번에 올리고 태그를 만듭니다. 워크플로는 태그와 이 값들이 같은지 먼저 검사하고,
다르면 빌드를 시작하지 않습니다. 앱 화면 우측 상단의 `v0.2.0` 배지는
`tauri.conf.json` 의 값을 그대로 읽으므로 **화면 버전 = 그 빌드가 나온 태그** 입니다.

---

## 원래 설계 문서

> **목표**
> 1. 태그를 푸시하면 GitHub Actions가 3개 OS용 설치 파일을 빌드해 **GitHub Releases에 자동 업로드**
> 2. 앱이 실행 중 **GitHub Repository를 조회**해 새 버전이 있으면 알림 → 다운로드 → 설치

---

## 1. 전체 흐름

```
개발자                    GitHub                          사용자 PC
  │                         │                                │
  ├─ git tag v0.2.0 ────────►                                │
  │  git push --tags        │                                │
  │                    ┌────┴─────┐                          │
  │                    │ Actions  │                          │
  │                    │  빌드    │  Windows / macOS / Linux │
  │                    └────┬─────┘                          │
  │                         │                                │
  │                    ┌────┴──────────────┐                 │
  │                    │  Releases v0.2.0  │                 │
  │                    │  ├ *.msi + .sig   │                 │
  │                    │  ├ *.dmg + .sig   │                 │
  │                    │  ├ *.AppImage+.sig│                 │
  │                    │  └ latest.json    │◄────────────────┤ 앱 시작 시 조회
  │                    └───────────────────┘                 │
  │                         │                                │
  │                         ├──── 버전 비교 (0.1.0 < 0.2.0) ─►│ "업데이트 있음"
  │                         │                                │
  │                         ├──── 설치 파일 + 서명 다운로드 ──►│ 서명 검증 후 설치
```

핵심은 **`latest.json`** 파일입니다. Tauri updater가 이 파일 하나만 보고 "새 버전이 있는가"를 판단합니다.

```json
{
  "version": "0.2.0",
  "notes": "버그 수정 및 성능 개선",
  "pub_date": "2026-08-20T10:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ6...",
      "url": "https://github.com/OWNER/REPO/releases/download/v0.2.0/app_0.2.0_x64-setup.nsis.zip"
    },
    "darwin-aarch64": { "signature": "...", "url": "..." },
    "linux-x86_64":   { "signature": "...", "url": "..." }
  }
}
```

이 파일은 **직접 만들지 않습니다.** `tauri-action`이 빌드 결과를 보고 자동 생성해 릴리스에 첨부합니다.

---

## 2. 사전 준비 — 업데이트 서명 키

Tauri updater는 **서명되지 않은 업데이트를 거부**합니다. 중간자 공격으로 악성 바이너리가 배포되는 것을 막기 위해서이며, 끌 수 없습니다.

### 2.1 키 생성 (로컬에서 1회)

```bash
npm run tauri signer generate -- -w ~/.tauri/schedule-app.key
```

- 비밀번호를 입력하면 두 개가 나옵니다
  - **개인 키** (`~/.tauri/schedule-app.key`) — 절대 커밋 금지. 분실 시 **기존 사용자에게 업데이트를 배포할 수 없습니다**
  - **공개 키** (`.key.pub`) — 앱에 내장

> ⚠️ 개인 키는 비밀번호와 함께 안전한 곳(비밀번호 관리자 등)에 별도 백업하세요.
> 이 키를 잃으면 사용자가 앱을 수동으로 재설치해야 하며, 복구 방법이 없습니다.

### 2.2 GitHub Secrets 등록

저장소 → Settings → Secrets and variables → Actions

| Secret 이름 | 값 |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | 개인 키 **파일의 내용 전체** |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 키 생성 시 입력한 비밀번호 |

---

## 3. 앱 설정

### 3.1 의존성

```bash
npm run tauri add updater
```

`src-tauri/Cargo.toml` 에 추가됨:

```toml
[dependencies]
tauri-plugin-updater = "2"
tauri-plugin-dialog  = "2"   # 업데이트 확인 다이얼로그용
tauri-plugin-process = "2"   # 설치 후 재시작용
```

### 3.2 `src-tauri/tauri.conf.json`

```json
{
  "productName": "ScheduleApp",
  "version": "0.1.0",
  "identifier": "com.example.scheduleapp",
  "bundle": {
    "active": true,
    "targets": ["nsis", "dmg", "appimage", "deb"],
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "pubkey": "여기에 .key.pub 파일 내용을 붙여넣기",
      "endpoints": [
        "https://github.com/OWNER/REPO/releases/latest/download/latest.json"
      ],
      "windows": {
        "installMode": "passive"
      }
    }
  }
}
```

**엔드포인트 URL의 두 가지 방식**

| 방식 | URL | 특징 |
|---|---|---|
| **고정 (권장)** | `.../releases/latest/download/latest.json` | 항상 최신 릴리스를 가리킴. 단순함 |
| 동적 | `.../releases/latest/download/latest-{{target}}-{{arch}}.json` | 플랫폼별 파일 분리. 대규모 배포 시 유용 |

사용 가능한 치환 변수: `{{target}}`, `{{arch}}`, `{{current_version}}`

`installMode` 옵션 (Windows):
- `passive` — 진행률 표시, 사용자 입력 불필요 ← **권장**
- `quiet` — 완전 무음 설치. UAC 권한 문제 소지 있음
- `basicUi` — 기본 설치 마법사 표시

### 3.3 `src-tauri/src/lib.rs`

```rust
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 3.4 권한 설정 — `src-tauri/capabilities/default.json`

Tauri v2는 명시적 권한 선언이 필요합니다. 빠뜨리면 런타임에 조용히 실패합니다.

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "updater:default",
    "dialog:default",
    "process:allow-restart"
  ]
}
```

---

## 4. GitHub Actions 워크플로

`.github/workflows/release.yml`

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:        # 수동 실행도 허용

jobs:
  build:
    permissions:
      contents: write       # Releases 생성/업로드에 필수
    strategy:
      fail-fast: false      # 한 OS 실패해도 나머지는 계속
      matrix:
        include:
          - platform: macos-latest
            args: '--target aarch64-apple-darwin'
            label: macOS (Apple Silicon)
          - platform: macos-latest
            args: '--target x86_64-apple-darwin'
            label: macOS (Intel)
          - platform: ubuntu-22.04
            args: ''
            label: Linux
          - platform: windows-latest
            args: ''
            label: Windows

    runs-on: ${{ matrix.platform }}
    name: ${{ matrix.label }}

    steps:
      - uses: actions/checkout@v4

      - name: Install pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: pnpm

      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}

      - name: Rust cache
        uses: swatinem/rust-cache@v2
        with:
          workspaces: './src-tauri -> target'
          key: ${{ matrix.platform }}-${{ matrix.args }}

      # Linux 빌드에만 필요한 시스템 라이브러리
      - name: Install Linux dependencies
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            libappindicator3-dev \
            librsvg2-dev \
            patchelf \
            libxdo-dev \
            libssl-dev \
            build-essential \
            file

      - name: Install frontend dependencies
        run: pnpm install --frozen-lockfile

      - name: Build and release
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'ScheduleApp __VERSION__'
          releaseBody: |
            ## 설치

            - **Windows**: `.exe` 파일 다운로드 후 실행
            - **macOS**: `.dmg` 파일 다운로드 (Apple Silicon / Intel 구분)
            - **Linux**: `.AppImage` 또는 `.deb`

            자세한 변경 내역은 아래를 참고하세요.
          releaseDraft: true      # 확인 후 수동 게시 (아래 주의사항 참고)
          prerelease: false
          args: ${{ matrix.args }}
          includeUpdaterJson: true
```

### 워크플로 동작 방식

1. 4개의 job이 **병렬로** 각 OS에서 빌드
2. 첫 job이 릴리스를 생성하고, 나머지는 **같은 릴리스에 에셋을 추가**
3. `includeUpdaterJson: true` → `latest.json` 을 자동 생성해 첨부
4. `__VERSION__` 은 `tauri.conf.json` 의 `version` 값으로 치환됨

---

## 5. 앱 내 업데이트 확인 로직

### 5.1 Rust 커맨드

```rust
use tauri_plugin_updater::UpdaterExt;

#[derive(serde::Serialize)]
pub struct UpdateInfo {
    version: String,
    notes: Option<String>,
    date: Option<String>,
}

/// 업데이트 확인만 수행 (설치는 하지 않음)
#[tauri::command]
pub async fn check_update(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;

    Ok(update.map(|u| UpdateInfo {
        version: u.version.clone(),
        notes: u.body.clone(),
        date: u.date.map(|d| d.to_string()),
    }))
}

/// 다운로드 + 설치 후 재시작
#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;

    if let Some(update) = updater.check().await.map_err(|e| e.to_string())? {
        let mut downloaded = 0usize;

        update
            .download_and_install(
                |chunk, total| {
                    downloaded += chunk;
                    // 진행률을 프론트로 전달하려면 여기서 app.emit(...)
                    tracing::info!("downloaded {downloaded} / {total:?}");
                },
                || tracing::info!("download finished, installing"),
            )
            .await
            .map_err(|e| e.to_string())?;

        app.restart();
    }

    Ok(())
}
```

### 5.2 확인 시점 정책

| 시점 | 동작 |
|---|---|
| **앱 시작 후 5초** | 백그라운드 확인. 있으면 우측 하단에 조용한 배너 표시 |
| **6시간 주기** | 상주형 앱이므로 주기적 확인 필요 |
| **설정 화면의 "업데이트 확인" 버튼** | 수동 확인. 최신이면 "최신 버전입니다" 명시 |

시작 직후 모달을 띄우는 것은 피하세요. 사용자가 일정을 확인하려고 앱을 연 것이지 업데이트하려고 연 게 아닙니다.

### 5.3 사용자 설정

- [ ] 자동으로 업데이트 확인 (기본 켜짐)
- [ ] 자동으로 다운로드 및 설치 (기본 꺼짐 — 명시적 동의 후 설치 권장)
- [ ] 프리릴리스 버전 받기 (기본 꺼짐)

---

## 6. 버전 번호 관리

버전이 적힌 곳이 여러 군데라 **불일치가 자주 발생합니다.**

| 위치 | 역할 |
|---|---|
| `src-tauri/tauri.conf.json` 의 `version` | **단일 진실 공급원(SSOT)** — 빌드 산출물과 `latest.json` 에 반영 |
| `package.json` 의 `version` | 프론트엔드용. 맞춰두는 게 좋음 |
| Git 태그 (`v0.2.0`) | 릴리스 트리거 |

### 릴리스 스크립트

`scripts/release.sh` — 세 곳을 한 번에 올립니다.

```bash
#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?사용법: ./scripts/release.sh 0.2.0}"

# 형식 검증
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "잘못된 버전 형식"; exit 1; }

# 작업 트리가 깨끗한지 확인
[[ -z "$(git status --porcelain)" ]] || { echo "커밋되지 않은 변경사항이 있습니다"; exit 1; }

# 버전 갱신
npm pkg set version="$VERSION"
node -e "
  const fs = require('fs');
  const p = 'src-tauri/tauri.conf.json';
  const c = JSON.parse(fs.readFileSync(p, 'utf8'));
  c.version = '$VERSION';
  fs.writeFileSync(p, JSON.stringify(c, null, 2) + '\n');
"

git add package.json src-tauri/tauri.conf.json
git commit -m "chore: release v$VERSION"
git tag "v$VERSION"

echo "완료. 다음 명령으로 푸시하세요:"
echo "  git push && git push --tags"
```

### 워크플로에서 버전 일치 검증

빌드 전에 태그와 설정 파일 버전이 같은지 확인하는 단계를 넣으면 사고를 막을 수 있습니다.

```yaml
      - name: Verify version matches tag
        if: startsWith(github.ref, 'refs/tags/')
        shell: bash
        run: |
          CONF=$(node -p "require('./src-tauri/tauri.conf.json').version")
          TAG="${GITHUB_REF_NAME#v}"
          if [ "$CONF" != "$TAG" ]; then
            echo "::error::tauri.conf.json ($CONF) 와 태그 ($TAG) 버전이 다릅니다"
            exit 1
          fi
```

---

## 7. 주의사항

### 7.1 `releaseDraft: true` 와 업데이트 엔드포인트의 충돌 ⚠️

엔드포인트로 쓰는 `.../releases/latest/download/latest.json` 은 **초안(draft) 릴리스에는 접근할 수 없습니다.**

- 빌드 결과를 먼저 확인하고 싶다면 → `releaseDraft: true` 유지 + **수동으로 릴리스 게시**
- 태그 푸시만으로 바로 배포하려면 → `releaseDraft: false`

초안으로 두고 게시를 잊으면 사용자에게 업데이트가 나가지 않습니다. 초기에는 `true`로 두고 검증 후 게시하는 흐름을 권합니다.

### 7.2 비공개 저장소는 자동 업데이트가 안 됩니다

`releases/latest/download/...` 는 인증되지 않은 요청입니다. 비공개 저장소라면:

- 저장소를 공개로 전환하거나
- 별도 프록시 서버를 두거나 (토큰을 앱에 넣는 것은 금물)
- 릴리스 에셋만 별도 CDN/스토리지에 올리는 방식

**공개 저장소가 압도적으로 간단합니다.**

### 7.3 macOS 공증(Notarization)

공증 없이 배포하면 사용자에게 "손상되었기 때문에 열 수 없습니다"가 뜹니다. 다운로드한 앱이라 그렇습니다.

필요한 Secrets:

| Secret | 설명 |
|---|---|
| `APPLE_CERTIFICATE` | Developer ID Application 인증서 (.p12 → base64) |
| `APPLE_CERTIFICATE_PASSWORD` | .p12 비밀번호 |
| `APPLE_SIGNING_IDENTITY` | 예: `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID` / `APPLE_PASSWORD` | Apple ID와 앱 암호 |
| `APPLE_TEAM_ID` | 팀 ID |

Apple Developer Program 연 $99가 필요합니다. **개인용이면 생략하고, 사용자에게 "우클릭 → 열기"를 안내**하는 것도 방법입니다.

### 7.4 Windows SmartScreen

코드 서명 인증서가 없으면 "Windows에서 PC를 보호했습니다" 경고가 뜹니다. 설치를 막지는 않지만("추가 정보" → "실행") 신뢰도에 영향을 줍니다. EV 인증서는 연 수십만 원 수준이라 초기에는 감수하는 경우가 많습니다.

### 7.5 빌드 시간과 캐시

`swatinem/rust-cache` 없이는 매 릴리스마다 전체 재컴파일로 OS당 15~25분이 걸립니다. 캐시를 넣으면 5~10분 수준으로 줄어듭니다. **처음부터 넣으세요.**

### 7.6 서명 키 분실

2절에서 강조했지만 다시 적습니다. `TAURI_SIGNING_PRIVATE_KEY` 를 잃으면 **기존 사용자에게 더 이상 업데이트를 보낼 수 없습니다.** 새 키로 서명한 업데이트는 구버전 앱이 검증에 실패해 거부합니다. 사용자가 직접 재설치하는 것 외에 복구 경로가 없습니다.

---

## 8. 부가 워크플로

### 8.1 PR 검증 — `.github/workflows/ci.yml`

릴리스 때 처음 빌드가 깨지는 상황을 막으려면 PR마다 검사가 필요합니다.

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: clippy, rustfmt
      - uses: swatinem/rust-cache@v2
        with:
          workspaces: './src-tauri -> target'
      - run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libxdo-dev libssl-dev

      - name: Format check
        run: cargo fmt --all --check
        working-directory: src-tauri

      - name: Clippy
        run: cargo clippy --all-targets -- -D warnings
        working-directory: src-tauri

      - name: Test
        run: cargo test --all
        working-directory: src-tauri
```

> 도메인 로직을 Rust에 두면 여기서 **Tauri 없이 순수 단위 테스트**가 돕니다.
> 반복 일정 전개나 타임존 변환처럼 버그가 잦은 부분을 CI로 지킬 수 있습니다.

### 8.2 릴리스 노트 자동 생성

`.github/release.yml` 을 두면 PR 라벨 기준으로 변경 내역이 자동 분류됩니다.

```yaml
changelog:
  categories:
    - title: 새로운 기능
      labels: [feature, enhancement]
    - title: 버그 수정
      labels: [bug, fix]
    - title: 기타
      labels: ['*']
```

---

## 9. 체크리스트

### 최초 1회 설정
- [ ] 서명 키 생성 및 **안전한 곳에 백업**
- [ ] `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` Secrets 등록
- [ ] `tauri.conf.json` 에 `pubkey` 와 `endpoints` 설정
- [ ] `bundle.createUpdaterArtifacts: true` 확인
- [ ] `capabilities/default.json` 에 updater 권한 추가
- [ ] 저장소 공개 여부 결정 (비공개면 자동 업데이트 불가)
- [ ] `.github/workflows/release.yml` 추가
- [ ] `scripts/release.sh` 추가

### 매 릴리스마다
- [ ] `./scripts/release.sh 0.x.0` 실행
- [ ] `git push && git push --tags`
- [ ] Actions 4개 job 성공 확인
- [ ] 릴리스에 `latest.json` 이 첨부됐는지 확인
- [ ] 초안이면 **릴리스 게시**
- [ ] 이전 버전을 설치한 PC에서 실제 업데이트 동작 확인

### 최초 배포 전 반드시 검증할 것
- [ ] v0.1.0 설치 → v0.1.1 릴리스 → **실제 업데이트가 도는지** 확인
  → 자동 업데이트는 한 번 잘못 배포하면 되돌릴 방법이 없으므로,
     실사용자가 생기기 전에 이 왕복을 반드시 테스트하세요
