# HerdRabbit

[English](README.md) | 한국어

HerdRabbit은 현재 머신에서 실행 중인 [Herdr](https://herdr.dev/) 워크스페이스를 데스크톱과 모바일 브라우저에서 관리하는 개인용 웹 애플리케이션입니다. 기존 Herdr 세션에 연결해 상태와 터미널 출력을 확인하고, 입력과 제한된 특수 키를 전달합니다.

> [!IMPORTANT]
> HerdRabbit은 한 사람이 자신의 Herdr 세션에 접속하기 위한 **개인용 도구**입니다. 다중 사용자 계정, 권한 분리 또는 공개 호스팅을 위한 서비스가 아닙니다. 공인 인터넷에 직접 노출하지 말고 Tailscale 같은 사설 네트워크 안에서 사용하세요.

서버는 Node.js 표준 라이브러리, Web Push 전송용 `web-push`, WebAuthn 검증용 SimpleWebAuthn과 설치된 `herdr` CLI를 사용합니다. 앱과 저장소 이름은 `HerdRabbit`이며, 기존 설치와의 호환성을 위해 내부 systemd 서비스 이름은 `herdr-web-local`을 유지합니다.

HerdRabbit은 OS 사용자별로 실행하며, 선택적으로 인스턴스 비밀번호를 설정할 수 있습니다. 별도의 계정명은 사용하지 않습니다.

## 권장 접속 방식: Tailscale부터

HerdRabbit은 `127.0.0.1`에서만 수신하고, 원격 기기에서는 [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)를 통해 접속하는 구성을 기준으로 설계했습니다.

```text
휴대폰·태블릿·PC의 PWA
        │ tailnet 내부 HTTPS
        ▼
Tailscale Serve
        │ 127.0.0.1:3xxxx로 HTTP 전달
        ▼
Herdr 머신의 HerdRabbit
```

Herdr가 실행되는 머신과 HerdRabbit을 여는 기기가 모두 같은 tailnet에 로그인되어 있어야 합니다. 생성되는 HTTPS 주소는 공개 웹사이트가 아니라 tailnet 전용 주소입니다. HerdRabbit 비밀번호는 추가 보호 수단이며 Tailscale을 대체하지 않습니다. 이 앱에는 Tailscale Funnel을 사용하지 마세요.

Tailscale이 설치되어 실행 중이면 [한 줄 자동 설치](#한-줄-자동-설치)가 머신의 Tailscale DNS 이름을 감지하고 허용 호스트와 같은 포트의 HTTPS Serve 규칙을 자동 등록합니다. 수동 설정과 문제 해결은 [Tailscale Serve로 HTTPS 제공](#tailscale-serve로-https-제공)을 참고하세요.

## 기능

- 기존 Herdr 워크스페이스, 탭, 패인 및 에이전트 상태 조회
- 현재 OS 사용자에게 등록된 여러 Herdr 영구 세션을 한 화면에서 조회
- 선택한 패인의 ANSI 터미널 출력 표시 및 Claude 같은 alternate-screen 에이전트의 과거 기록 재구성
- 출력 맨 위에서 스크롤할 때 이전 기록을 200줄씩 추가 로딩
- 선택한 패인에 텍스트 또는 셸 명령 전송
- 브라우저가 앱으로 전달하는 환경에서 `Ctrl+Tab`, `Ctrl+Shift+Tab`, `Ctrl+1`–`Ctrl+9`로 사이드바 항목 이동
- 앱 재실행 후에도 터미널 글자 크기와 패인별 최근 100개 전송 프롬프트 복원, 입력창의 위/아래 방향키로 기록 탐색
- `Esc`, `Ctrl+C`, `Tab`, `Shift+Tab`, 방향키 및 `Enter` 전송
- 기본 셸로 프로젝트와 세션 생성
- 확인 후 세션 또는 프로젝트 종료
- 프로젝트 이름 변경
- 프로젝트별 하위 세션 접기와 접힘 상태 저장
- 마지막으로 선택한 세션을 저장하고 새로고침 후 복원
- Herdr 상태 기호(`×`, `◐`, `✓`, `○`, `·`) 표시
- 완료(`✓`) 세션을 열어 확인하면 현재 브라우저에서 idle(`○`)로 전환
- 아직 확인하지 않은 완료 세션과 접힌 프로젝트를 사이드바에서 강조
- 프로젝트명·탭 이름과 짧은 상태만 표시하는 PWA 알림
- 데스크톱 접이식 사이드바와 모바일 오버레이 탐색기
- 라이트·다크 모드
- 터미널 출력과 입력창의 글자 크기 조절 및 설정 저장
- 데스크톱과 모바일에서 설치 가능한 PWA
- 선택형 인스턴스 비밀번호, Passkey 로그인, 7일 고정 만료 및 PWA를 새로 열 때 재로그인
- 사용자별 systemd 서비스 및 충돌하지 않는 `30000–39999` 포트 자동 설치
- 설치 과정에서 Tailscale Serve HTTPS 자동 등록

패인 분할과 Herdr 영구 세션명 변경은 현재 제공하지 않습니다.

## 기술 구성

- Node.js 22 이상, ESM 및 표준 라이브러리 기반 HTTP 서버
- 프레임워크 없는 HTML, CSS, Vanilla JavaScript UI
- Web App Manifest와 Service Worker를 사용하는 설치형 PWA
- Push API, Service Worker와 VAPID 기반의 상태 알림
- `execFile` 인자 배열로 호출하는 로컬 Herdr CLI 어댑터
- 사용자별 `systemd --user` 서비스와 자동 포트 선택
- Tailscale Serve를 통한 tailnet 전용 HTTPS 프록시
- SimpleWebAuthn 기반 WebAuthn Passkey, `scrypt` 비밀번호 해시, HMAC 서명 세션, `HttpOnly` 쿠키, 창 단위 실행 토큰 및 CSRF/동일 출처 검증
- Node.js 내장 `node:test`, 가짜 Herdr 실행 파일을 사용한 단위·통합 테스트

실시간 연결에 WebSocket을 사용하지 않습니다. 일반 HTTP polling을 유지하되 두 번째 요청부터 터미널 출력의 revision delta만 응답하고, 변경이 없으면 본문 없는 `204`를 반환합니다. 일반 터미널은 1초마다 확인하고, 작업 중에는 확인된 Wi-Fi·유선에서 1초, 모바일 데이터·데이터 절약 모드에서 5초마다 확인하며(네트워크 종류 확인 불가 시 터치 환경 5초, PC 1초), 작업이 끝나거나 차단·입력 대기 상태가 되면 즉시 갱신합니다. 입력 전송 직후에는 250ms 후 한 번 더 확인하고 잠시 1초 주기로 확인해 터미널 반향을 빠르게 표시합니다. 세션 상태는 2초마다 갱신합니다.

## SSH 서버 추가

로컬 Herdr는 기본으로 유지합니다. 사이드바 상단의 **+ → Connect SSH Server**에서 이름과 호스트 또는 기존 SSH 별칭을 입력하면, 등록한 모든 서버가 **서버 → Herdr 세션 → 프로젝트 → 탭/패인**으로 함께 표시됩니다. 원격 서버에는 Herdr만 설치·실행하면 되며 HerdRabbit은 필요하지 않습니다.

사용자명과 포트는 생략하면 서비스 계정의 SSH 설정을 따릅니다. **Authentication**에서 **Existing SSH settings**(기존 SSH 설정), **Private key**(HerdRabbit 서버에 있는 개인키 절대 경로), **Password** 중 하나를 선택합니다. 키 업로드 방식은 아닙니다. **Advanced**에는 원격 Herdr 실행 파일의 절대 경로를 지정할 수 있습니다. 기본값 `herdr`는 원격 PATH에서 찾고 없으면 `$HOME/.local/bin/herdr`를 사용합니다. **Test connection**으로 확인한 뒤 **Save**하면 됩니다. 프로필 수정·삭제도 가능하며, 삭제해도 원격 세션은 종료하지 않습니다. 프로젝트 생성 시 대상 서버/Herdr 세션을 선택할 수 있습니다.

SSH는 HerdRabbit 서비스를 실행한 Linux 계정으로 실행합니다. 기존 설정 모드는 해당 계정의 키와 SSH agent를 사용합니다. 비밀번호 모드는 입력한 비밀번호를 명령줄 인수에 넣지 않고 OpenSSH에 전달하며, 원격 서버에서 SSH 비밀번호 인증을 허용해야 합니다. MFA/keyboard-interactive 입력은 지원하지 않으며 암호화된 키는 서비스의 SSH agent에 미리 잠금 해제해야 합니다. 처음 연결하는 서버는 해당 계정의 터미널에서 SSH 접속하여 호스트 키를 확인해야 합니다. 알 수 없거나 변경된 호스트 키는 거부합니다. SSH 별칭과 점프 호스트를 사용할 수 있지만 점프 호스트 자체의 비대화형 인증은 별도로 설정해야 합니다. 서버 간 SSH 통신은 원격 주소에 도달할 수 있으면 Tailscale 외의 경로도 가능합니다.

SSH 비밀번호는 서버의 프로필 파일에 저장하여 업데이트·서비스 재시작 후 자동 복원합니다. 별도 암호화 없이 해당 Linux 계정만 접근 가능한 0600 권한으로 저장하므로 관리자나 백업 접근자는 읽을 수 있습니다. 프로필 API 응답에는 비밀번호를 포함하지 않습니다. 연결 수정 시에는 다시 입력합니다. 이전 메모리 전용 버전에서 만든 연결은 업그레이드 후 한 번 다시 입력하고 저장해야 합니다. 자격 증명 입력에는 Tailscale Serve 같은 HTTPS 연결을 사용하세요.

프로필은 인증 파일과 같은 디렉터리의 `ssh-profiles.json`에 `0600` 권한으로 저장합니다. 기본 경로는 `~/.config/herdr-bridge/ssh-profiles.json`이며 `HERDR_WEB_SSH_PROFILES_FILE`로 변경할 수 있습니다. 개인키 내용은 저장하지 않으며 SSH 비밀번호는 이 비공개 파일에 저장합니다. 같은 HerdRabbit 인스턴스를 사용하는 기기들은 이 프로필을 공유합니다. 원격 계정을 조작할 수 있으므로 인스턴스의 비밀번호/Passkey 로그인을 설정해서 사용하세요.

SSH 연결은 유휴 상태에서 최대 60초간 재사용합니다. 원격 서버별 조회를 독립적으로 실행하고 연결 실패 시 재시도 간격을 늘립니다. 서버가 끊기면 마지막으로 확인한 패인 목록을 유지하고 오프라인으로 표시합니다. 터미널 출력은 기존 폴링/delta 정책을 따르며, 서버가 여러 개이면 알림에도 서버명이 포함됩니다.

선택적 통합 검증: `node scripts/check-ssh-transport.mjs`는 임시 로컬 SSH 서버를 사용하며 OpenSSH 서버·클라이언트가 필요합니다. `node scripts/check-ssh-ui.mjs`는 Firefox·geckodriver로 프로필 UI를 검사합니다. 두 검증 모두 실제 프로필과 Herdr 세션을 변경하지 않습니다.

## 구조

```text
브라우저 / 설치된 PWA
        │
        │ HTTPS (선택 사항)
        ▼
Tailscale Serve
        │
        │ http://127.0.0.1:3xxxx
        ▼
HerdRabbit Node.js 서버
        │
        │ execFile 인자 배열
        ▼
로컬 herdr CLI ── default 및 이름 있는 Herdr 영구 세션
                         └─ 워크스페이스와 패인
```

프로젝트 생성은 Herdr 워크스페이스를, 세션 생성은 해당 워크스페이스의 새 탭과 기본 셸을 만듭니다. HerdRabbit 자체가 별도의 터미널 서버를 운영하지는 않으며, 화면과 입력은 Herdr 패인에 연결됩니다.

### 여러 Herdr 영구 세션

HerdRabbit은 `herdr session list --json`으로 **서비스를 실행한 OS 사용자의** 영구 세션을 찾습니다. 실행 중인 `default` 및 이름 있는 세션의 snapshot을 각각 가져와 합치며, 같은 `w1:p1` 로컬 ID가 여러 세션에 있어도 충돌하지 않도록 내부적으로 세션 범위 ID를 붙입니다. 입력, 출력, 이름 변경, 생성과 종료 명령은 원래 Herdr 세션으로 다시 라우팅됩니다.

- Herdr 영구 세션이 하나뿐이면 기존처럼 별도 구분 없이 표시됩니다.
- 둘 이상이거나 접근할 수 없는 세션이 있으면 사이드바에 Herdr 세션별 그룹과 상태가 표시됩니다.
- 중지된 영구 세션은 상태만 표시하고 snapshot은 요청하지 않습니다.
- 새 프로젝트는 현재 선택한 패인이 속한 Herdr 세션에 생성됩니다. 선택이 없으면 실행 중인 기본 세션, 그다음 첫 실행 세션 순으로 선택합니다.
- 다른 OS 사용자의 세션과 `herdr --no-session`으로 실행한 일회성 인스턴스는 가져오지 않습니다.

### 여러 OS 사용자

각 Linux 사용자는 자신의 계정에서 설치 스크립트를 실행합니다. `systemd --user` 서비스 이름은 사용자 영역별로 분리되므로 모두 `herdr-web-local.service`를 사용해도 충돌하지 않습니다. 설치 스크립트는 로컬 수신 포트와 기존 Tailscale Serve HTTPS 포트를 검사한 뒤 `30000–39999` 범위에서 비어 있는 포트를 선택합니다.

```text
alice → 127.0.0.1:38787 → https://server.example.ts.net:38787
bob   → 127.0.0.1:30000 → https://server.example.ts.net:30000
```

각 서비스는 서비스를 실행한 Linux 사용자의 Herdr와 설정 파일만 사용합니다. 기존 서비스를 다시 설치하면 이미 배정된 포트를 유지합니다.

## 요구 사항

- Linux 또는 macOS
- Node.js 22 이상
- 실행 가능한 `herdr` CLI. 없으면 자동 설치 스크립트가 설치합니다.
- 실행 중인 Herdr 영구 세션 하나 이상
- 원격 HTTPS 접속이 필요하면 Tailscale
- 백그라운드 상태 알림을 사용하려면 브라우저 푸시 서비스로 나가는 인터넷 연결

버전을 확인합니다.

```bash
node --version
herdr --version
herdr status server
```

Herdr만 먼저 직접 설치하려면 공식 설치 스크립트를 실행합니다.

```bash
curl -fsSL https://herdr.dev/install.sh | sh
```

기본 설치 위치는 `~/.local/bin/herdr`입니다. 새 터미널을 열어도 명령을 찾지 못한다면 셸 설정에 다음을 추가합니다.

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## 빠른 시작

### 한 줄 자동 설치

Linux에서 실행합니다. macOS에서는 아래의 직접 실행 방법을 사용해야 합니다.

```bash
curl -fsSL https://raw.githubusercontent.com/ultivis-iot/HerdRabbit/main/install.sh | sh
```

스크립트는 `~/.local/share/herd-rabbit`에 저장소를 복제하거나 업데이트한 뒤 아래의 서비스 설치 절차를 실행합니다. 기존 설치 경로에 수정 사항이 있으면 덮어쓰지 않고 중단합니다. `HERD_RABBIT_INSTALL_DIR`로 설치 경로를 바꿀 수 있습니다.

### 저장소에서 수동 설치

```bash
gh repo clone ultivis-iot/HerdRabbit
cd HerdRabbit
npm ci --omit=dev
npm run install-service
```

설치 중 HerdRabbit 비밀번호를 숨김 입력으로 묻습니다.

```text
HerdRabbit 비밀번호 (비워 두면 사용 안 함):
비밀번호 확인:
```

- 비밀번호를 입력하면 웹 접속 시 비밀번호 화면이 표시됩니다.
- 아무것도 입력하지 않고 `Enter`를 누르면 비밀번호 인증 없이 설치됩니다.
- `herdr` 명령이 없으면 공식 `https://herdr.dev/install.sh`를 내려받아 `~/.local/bin/herdr`에 자동 설치합니다.
- Tailscale이 실행 중이면 DNS 이름을 자동으로 허용하고 같은 포트의 HTTPS Serve를 등록합니다.
- `sudo tailscale serve` 실행을 위해 설치 도중 sudo 비밀번호를 물을 수 있습니다.
- 설치 완료 시 선택된 포트와 최종 HTTPS 주소를 출력합니다.

Tailscale이 없거나 실행 중이 아니면 서비스 설치까지만 완료하고 HTTPS 등록은 건너뜁니다.

### 직접 실행

서비스 설치 없이 현재 터미널에서 실행할 수도 있습니다.

```bash
npm ci --omit=dev
npm start
```

직접 실행의 기본 주소는 다음과 같습니다.

```text
http://127.0.0.1:38787
```

한 줄 설치 스크립트는 Web Push와 WebAuthn 런타임 의존성을 자동 설치합니다. 저장소를 직접 복제했거나 업데이트했다면 `npm ci --omit=dev`를 실행하세요.

## 비밀번호와 Passkey 인증

비밀번호는 HerdRabbit 인스턴스별로 하나만 사용하며 계정명은 입력하지 않습니다. Linux 계정은 서비스를 실행한 사용자로 결정됩니다.

비밀번호를 변경하거나 잊어버렸다면 해당 Linux 계정으로 SSH 접속한 뒤 저장소에서 실행합니다.

```bash
cd ~/.local/share/herd-rabbit
npm run password
```

새 비밀번호를 두 번 입력하면 즉시 교체됩니다. 첫 입력을 비워 두면 비밀번호 인증이 해제됩니다. 설치된 서비스가 실행 중이면 자동으로 재시작하므로 기존 로그인 세션과 등록된 Passkey도 모두 무효화됩니다.

비밀번호 원문은 저장하지 않습니다. `scrypt`로 만든 해시, 브라우저 세션 서명용 난수와 Passkey 공개 정보만 다음 파일에 `0600` 권한으로 저장합니다.

```text
~/.config/herdr-bridge/auth.json
```

로그인 세션의 고정 만료 시간은 7일입니다. 브라우저의 `HttpOnly`, `SameSite=Strict` 쿠키와 현재 창의 `sessionStorage`에 분리된 서명 토큰이 모두 있어야 API를 사용할 수 있으며, HTTPS 접속에서는 쿠키에 `Secure` 속성도 적용됩니다. PWA나 탭을 완전히 닫았다가 새로 열면 창 토큰이 없어 Passkey 또는 비밀번호로 다시 로그인해야 합니다. 같은 창의 새로고침과 백그라운드 복귀에서는 로그인이 유지됩니다. 인증 파일이 없으면 인증을 요구하지 않습니다.

브라우저가 WebAuthn을 지원하면 첫 비밀번호 로그인 뒤 Passkey 등록을 안내합니다. 등록 후 로그인 화면에는 비밀번호와 **Passkey로 로그인**이 함께 표시됩니다. 기기에 따라 Face ID, 지문, Windows Hello, 기기 PIN, 보안 키 또는 다른 기기의 QR 인증을 사용할 수 있습니다. 생체 정보와 개인키는 기기 인증장치 밖으로 나오지 않으며 HerdRabbit은 credential ID, 공개키, 서명 카운터와 전송 정보만 저장합니다. Passkey는 등록할 때 사용한 호스트 이름에 묶이므로 주소를 번갈아 쓰지 말고 고정된 Tailscale HTTPS 주소를 사용하세요.

## 사용법

### 세션 선택과 저장

사이드바에서 에이전트 또는 패인을 선택하면 출력이 콘텐츠 영역에 표시됩니다. 마지막 선택은 브라우저 `localStorage`에 저장되며 같은 주소로 다시 접속하거나 새로고침하면 복원됩니다.

여러 Herdr 영구 세션이 등록되어 있으면 사이드바에서 먼저 Herdr 세션명으로 구분한 뒤, 그 아래에 프로젝트와 탭을 표시합니다. 여기서 Herdr **영구 세션**은 독립 서버/소켓 단위이고, 프로젝트 아래의 **세션**은 Herdr 탭 단위입니다.

브라우저 저장소는 출처별로 분리되므로 `http://192.168.x.x:38787`과 `https://server.example.ts.net`은 서로 다른 선택 상태를 가집니다. 저장된 패인이 더 이상 존재하지 않으면 첫 번째 패인을 선택합니다.

백그라운드 작업이 완료된 세션은 `✓`로 표시됩니다. 해당 세션을 열어 출력을 확인하면 현재 브라우저에서는 확인한 완료 이벤트를 기록하고 `○`로 바꿉니다. 이후 같은 세션에서 새로운 작업이 완료되면 `state_change_seq`가 달라지므로 다시 `✓`가 표시됩니다. 이 동작은 데스크톱 Herdr의 포커스를 강제로 바꾸지 않습니다.

### 상태 알림

사이드바 하단의 종 버튼을 눌러 현재 브라우저나 설치된 PWA의 상태 알림을 켜거나 끕니다. 알림 권한은 이 버튼을 눌렀을 때만 요청합니다.

- 알림 제목은 `프로젝트명 · 탭 이름`입니다.
- 완료, 확인·입력 필요, 작업 종료 후 대기, 상태 확인 불가에 따라 짧은 상태 문구가 달라집니다.
- 같은 상태 이벤트는 한 번만 알리고, 같은 세션의 이전 알림은 최신 상태로 교체합니다. 알림을 누르면 설치된 PWA를 열거나 활성화한 뒤 해당 세션을 복원합니다.

PWA나 탭을 닫은 상태에서도 알림을 받기 위해 표준 Web Push를 사용합니다. Firebase 프로젝트나 FCM SDK는 필요하지 않습니다. iPhone과 iPad에서는 iOS/iPadOS 16.4 이상에서 HerdRabbit을 홈 화면에 추가한 뒤 알림을 허용해야 합니다.

VAPID 키와 기기별 Push 구독은 다음 파일에 `0600` 권한으로 저장됩니다.

```text
~/.config/herdr-bridge/push.json
```

프로젝트명과 탭 이름은 잠금 화면 알림에 표시될 수 있습니다. 이전 명령과 작업 요청 내용은 표시하지 않습니다. 개인 기기에서만 알림을 허용하세요.

### 프로젝트 이름 변경과 접기

- 프로젝트명 오른쪽 `⋯` 메뉴에서 **이름 변경**을 누르면 이름을 편집합니다.
- `Enter` 또는 체크 버튼으로 저장합니다.
- `Esc` 또는 X 버튼으로 취소합니다.
- 프로젝트명 왼쪽 화살표로 하위 세션을 접거나 펼칩니다.
- 프로젝트를 접어도 현재 보고 있는 세션은 변경되지 않습니다.
- 접힘 상태는 같은 브라우저 주소의 `localStorage`에 저장됩니다.

프로젝트 이름 변경은 Herdr의 `workspace rename` 명령에 전달됩니다.

### 프로젝트와 세션 생성·종료

- 사이드바 상단의 `+` 버튼은 이름을 지정한 새 프로젝트와 기본 셸을 만듭니다.
- 프로젝트명 오른쪽 `⋯` 메뉴의 **새 세션**은 그 프로젝트에 기본 셸 세션을 하나 추가합니다.
- 세션 오른쪽 `⋯` 메뉴의 **세션 종료**는 해당 Herdr 탭을 종료합니다.
- 프로젝트의 `⋯` 메뉴에 있는 **프로젝트 종료**는 그 아래의 모든 세션을 종료합니다.
- 종료는 실행 중인 프로세스에도 영향을 주므로 확인 대화상자를 거친 뒤 실행합니다.

생성된 셸에서는 `cd`, `codex`, `claude` 등 필요한 명령을 직접 실행하면 됩니다. 생성 명령은 현재 데스크톱 Herdr의 포커스를 바꾸지 않도록 `--no-focus`로 호출되며, 웹 화면에서는 새로 생성한 세션을 선택합니다.

### 입력

| 동작 | 키 |
| --- | --- |
| 마우스 중심 환경에서 입력 전송 | `Enter` |
| 마우스 중심 환경에서 줄바꿈 | `Ctrl+Enter` |
| 터치 중심 환경에서 줄바꿈 | `Enter` |
| 터치 중심 환경에서 입력 전송 | 오른쪽 화살표 버튼 |
| 터치 기기에 연결한 외장 키보드로 전송 | `Ctrl+Enter` 또는 `Cmd+Enter` |
| 이전에 전송한 입력 불러오기 | `↑` |
| 이후 입력 또는 작성 중이던 초안으로 이동 | `↓` |

선택한 패인이 셸 프롬프트를 받고 있다면 입력한 문자열은 해당 패인의 명령으로 실행됩니다. 제출은 Herdr의 `pane run`으로 텍스트와 Enter를 원자적으로 전달합니다. 서버에는 패인과 무관한 임의 셸 실행 API가 없습니다.

입력창은 기본 한 줄 높이이며 줄바꿈이나 자동 줄바꿈에 맞춰 최대 5줄까지 늘어납니다. 5줄을 넘으면 입력창 내부에서 스크롤합니다.

입력 정책은 기기 이름이 아니라 브라우저의 터치 정보를 조합해 결정합니다. 기본 포인터 판정뿐 아니라 보조 포인터와 터치 포인트 수도 확인하며, 터치 포인트 기반 fallback은 1024px 이하 화면에서만 사용해 창이 좁은 일반 PC를 터치 기기로 오인하지 않도록 합니다. 브라우저는 외장 키보드 연결 여부를 안정적으로 제공하지 않으므로 자동 전환하지 않으며, 외장 키보드에서는 `Ctrl+Enter` 또는 `Cmd+Enter`로 전송합니다.

### 출력과 이전 기록

출력은 revision 기반 HTTP delta polling으로 갱신합니다. 일반 터미널은 1초마다 확인하며, `working` 상태의 에이전트는 확인된 Wi-Fi·유선에서 1초, 모바일 데이터·데이터 절약 모드에서 5초마다 확인한 뒤(네트워크 종류 확인 불가 시 터치 환경 5초, PC 1초) 작업 완료·차단·입력 대기 전환 시 즉시 갱신합니다. 입력을 전송하면 즉시 갱신하고 250ms 후 한 번 더 확인하며, 짧은 시간 동안 1초 주기로 확인해 `working` 주기 때문에 터미널 반향이 늦어지지 않게 합니다. 출력이 같으면 응답 본문을 보내지 않고, 달라지면 일반적으로 변경 patch만 전송합니다. 브라우저와 일치하는 revision이 없으면 전체 출력 창을 보내 새로고침이나 재연결 후에도 자동 복구합니다. Claude처럼 alternate screen에서 동작하는 에이전트는 Herdr에 스크롤백이 전혀 남지 않습니다. `pane read`는 몇 줄을 요청하든 두 format 모두 현재 화면만 반환합니다. 이런 패인은 HerdRabbit이 과거 기록을 직접 재구성합니다. polling으로 받은 화면 frame을 직전 frame과 정렬해, 위로 밀려나 사라진 행만 패인별 버퍼에 누적합니다(최근에 본 패인 32개, 각 4,000행까지). 아직 화면에 남아 있는 부분은 누적하지 않으므로 하단에 고정된 입력 박스가 반복해서 쌓이지 않습니다. 누적은 해당 패인을 보고 있는 동안 메모리에 쌓이며, 서비스를 다시 시작하면 비어 있는 상태에서 시작합니다. plain snapshot과 ANSI snapshot이 정렬되면 현재 화면의 ANSI 스타일을 유지하고, 정렬할 수 없으면 기록 중복이나 누락을 피하기 위해 전체 plain text를 우선합니다. 세션 목록과 상태는 2초마다 갱신합니다. 터미널 출력 맨 위까지 스크롤하면 과거 기록을 200줄씩 추가 요청하며, 최대 100,000줄까지 요청할 수 있습니다. Herdr의 두 기록 source 모두에 남아 있지 않은 내용은 복구할 수 없습니다.

### 화면 설정

사이드바 하단 버튼으로 라이트·다크 모드를 전환합니다. 터미널 영역 위에서 `Ctrl+휠`을 사용하거나 트랙패드를 확대·축소하면 터미널 글자 크기가 바뀝니다. 모바일에서는 터미널 출력 위에서 두 손가락을 모으거나 벌려 글자 크기를 조절합니다. 한 손가락 스크롤은 그대로 동작합니다. 글자 크기는 터미널 출력과 입력창에 함께 적용되며 브라우저 `localStorage`에 저장됩니다.

## 환경 변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `HERDR_WEB_HOST` | `127.0.0.1` | `127.0.0.1` 또는 `0.0.0.0` |
| `HERDR_WEB_PORT` | `38787` | 1024–65535 범위의 수신 포트 |
| `HERDR_WEB_ALLOWED_HOSTS` | 비어 있음 | 역방향 프록시와 Tailscale용 추가 Host 이름. 쉼표로 구분 |
| `HERDR_WEB_AUTH_FILE` | `~/.config/herdr-bridge/auth.json` | 비밀번호 해시와 세션 서명 키를 저장한 인증 파일 |
| `HERDR_WEB_PUSH_FILE` | `~/.config/herdr-bridge/push.json` | VAPID 키와 브라우저 Push 구독을 저장한 파일 |
| `HERDR_BIN` | `herdr` | 사용할 Herdr 실행 파일 경로 |

예시:

```bash
HERDR_WEB_HOST=0.0.0.0 \
HERDR_WEB_PORT=38787 \
HERDR_WEB_ALLOWED_HOSTS=my-server.example-tailnet.ts.net \
HERDR_BIN="$HOME/.local/bin/herdr" \
npm start
```

`127.0.0.1`은 이 머신과 Tailscale Serve를 통한 접속만 허용하는 권장값입니다. `0.0.0.0`은 LAN에서도 직접 접속할 때만 사용하세요. 비밀번호를 설정했더라도 Herdr 패인 입력 권한이 제공되므로 공인 인터넷에 직접 노출하면 안 됩니다.

## systemd 사용자 서비스

권장 설치 방법은 저장소 경로, Node.js와 Herdr 실행 파일, Tailscale DNS 이름, 사용 가능한 포트를 자동으로 반영하는 설치 스크립트입니다.

```bash
npm run install-service
```

새 설치는 `38787`을 먼저 확인하고, 사용 중이면 `30000`부터 빈 포트를 찾습니다. 다른 Linux 계정의 서비스나 기존 Tailscale HTTPS가 사용하는 포트도 제외합니다. 기존 사용자 서비스를 다시 설치할 때는 현재 배정된 `30000–39999` 포트를 그대로 사용합니다.

저장소의 [`systemd/herdr-web-local.service`](systemd/herdr-web-local.service)는 수동 설치용 예시입니다. 다른 머신에서는 다음 항목을 실제 경로와 호스트명으로 수정해야 합니다.

- `Documentation`
- `WorkingDirectory`
- `HERDR_WEB_HOST`
- `HERDR_WEB_ALLOWED_HOSTS`
- `HERDR_WEB_AUTH_FILE`
- `HERDR_BIN`
- `ExecStart`의 Node.js와 저장소 경로

실제 경로를 확인합니다.

```bash
command -v node
command -v herdr
pwd
```

수동으로 서비스 파일을 설치하고 편집하려면 다음을 실행합니다.

```bash
mkdir -p ~/.config/systemd/user
cp systemd/herdr-web-local.service ~/.config/systemd/user/
systemctl --user edit --full herdr-web-local.service
systemctl --user daemon-reload
systemctl --user enable --now herdr-web-local.service
```

상태와 로그를 확인합니다.

```bash
systemctl --user status herdr-web-local.service
journalctl --user -u herdr-web-local.service -f
```

로그아웃 후에도 사용자 서비스를 계속 실행해야 한다면 배포 환경 정책을 확인한 뒤 linger를 활성화할 수 있습니다.

```bash
sudo loginctl enable-linger "$USER"
```

## Tailscale Serve로 HTTPS 제공

[Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)는 tailnet 안의 요청을 로컬 서비스로 프록시합니다. Serve 주소는 공인 인터넷 주소가 아니며, 접속하는 서버와 클라이언트 모두 같은 tailnet에 연결되어 있어야 합니다.

`npm run install-service`는 아래 과정을 자동으로 수행합니다. 이 절은 수동 설정이나 문제 해결이 필요할 때 사용합니다.

### 1. Tailscale 연결 확인

서버와 접속할 휴대폰·PC에서 Tailscale에 로그인한 뒤 서버에서 확인합니다.

```bash
tailscale status
```

노드의 전체 DNS 이름은 다음처럼 확인할 수 있습니다. `jq`가 없다면 `tailscale status --json` 출력의 `Self.DNSName` 값을 확인하세요.

```bash
tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")'
```

예시는 `my-server.example-tailnet.ts.net` 형태입니다.

### 2. Tailscale Host 허용

HerdRabbit 서비스의 `HERDR_WEB_ALLOWED_HOSTS`에 위 DNS 이름을 포트나 `https://` 없이 넣습니다.

```ini
Environment=HERDR_WEB_ALLOWED_HOSTS=my-server.example-tailnet.ts.net
```

설정을 바꿨다면 다시 로드합니다.

```bash
systemctl --user daemon-reload
systemctl --user restart herdr-web-local.service
```

Host가 허용되지 않으면 브라우저에서 `421 Request host rejected`가 반환됩니다.

### 3. HTTPS Serve 활성화

HerdRabbit이 선택된 포트에서 실행 중인 상태에서 로컬 포트와 같은 HTTPS 포트를 등록합니다. 예를 들어 포트가 `38787`이면 다음과 같습니다.

```bash
sudo tailscale serve --bg --yes --https=38787 http://127.0.0.1:38787
```

HTTPS가 tailnet에서 처음 사용되는 경우 Tailscale이 MagicDNS와 HTTPS 인증서 사용 동의를 요청할 수 있습니다. 자세한 동작은 [Serve CLI 문서](https://tailscale.com/docs/reference/tailscale-cli/serve)와 [HTTPS 인증서 문서](https://tailscale.com/docs/how-to/set-up-https-certificates)를 참고하세요.

설정 결과와 접속 URL을 확인합니다.

```bash
tailscale serve status
```

출력 예시:

```text
https://my-server.example-tailnet.ts.net:38787 (tailnet only)
|-- / proxy http://127.0.0.1:38787
```

`--bg` 설정은 Tailscale 재시작이나 머신 재부팅 후에도 유지됩니다. Serve 설정을 모두 제거하려면 다음을 실행합니다.

```bash
sudo tailscale serve reset
```

Tailscale을 연결하지 않은 기기에서는 이 HTTPS 주소에 접속할 수 없습니다. 비밀번호 유무와 관계없이 공개 인터넷 노출 기능인 Tailscale Funnel에는 연결하지 않는 것을 권장합니다.

## PWA 설치

### 데스크톱 Chrome 또는 Edge

Tailscale HTTPS 주소를 연 뒤 주소창 또는 브라우저 메뉴의 앱 설치 기능을 사용합니다. 앱 내부에는 별도의 설치 버튼이 없습니다.

### iPhone과 iPad

Safari에서 Tailscale HTTPS 주소를 열고 공유 메뉴에서 **홈 화면에 추가**를 선택합니다.

### Android

Chrome에서 Tailscale HTTPS 주소를 열고 메뉴에서 **앱 설치** 또는 **홈 화면에 추가**를 선택합니다.

PWA 아이콘이나 앱 셸이 이전 버전으로 보이면 앱을 완전히 종료한 뒤 다시 열어 보세요. 설치 아이콘 캐시가 계속 남으면 기존 앱을 제거하고 다시 설치해야 할 수 있습니다.

## 업데이트

```bash
cd ~/.local/share/herd-rabbit  # 실제 설치 경로
sh ./update.sh
```

서비스를 설치한 Linux 계정으로 실행하세요. 스크립트 자신의 경로(또는 `HERD_RABBIT_INSTALL_DIR`)에서 공식 origin과 수정 없는 `main` 브랜치인지 확인한 뒤 최신 코드 반영·의존성 설치·검증·해당 경로의 사용자 서비스 재시작을 수행합니다. 중복 실행 잠금이 있으며, 로컬 수정·분기된 커밋·설치나 검증 실패 시 재시작 전에 중단합니다. 제자리 업데이트이므로 실패 시에도 코드나 의존성은 이미 변경될 수 있고 자동 롤백은 하지 않습니다. 포트·인증·Tailscale 설정과 저장된 SSH 연결은 유지합니다. 이전 설치에 `update.sh`가 없다면 처음 한 번 `git pull --ff-only`로 받아오세요.

서비스 워커가 새 앱 셸을 감지하면 페이지를 한 번 다시 로드합니다. 장시간 열려 있던 탭은 직접 새로고침하는 것이 좋습니다.

## 검증과 개발

전체 정적 검사와 테스트를 실행합니다.

```bash
npm run verify
```

개발 중 파일 변경을 감지해 서버를 다시 시작합니다.

```bash
npm run dev
```

테스트는 가짜 Herdr 실행 파일과 임시 상태를 사용하므로 실제 Herdr 패인에 입력하거나 프로젝트·세션을 생성 또는 종료하지 않습니다.

주요 디렉터리:

```text
public/   브라우저 UI, PWA manifest, service worker, 아이콘
src/      HTTP 서버, 입력 검증, Herdr CLI 어댑터
systemd/  사용자 서비스 예시
test/     단위·통합 테스트와 가짜 Herdr
```

## 문제 해결

### `421 Request host rejected`

접속 중인 DNS 이름을 `HERDR_WEB_ALLOWED_HOSTS`에 추가한 뒤 서비스를 다시 시작합니다. 값에는 프로토콜과 포트를 넣지 않습니다.

### 연결 상태 점이 오류 색상으로 표시됨

```bash
systemctl --user status herdr-web-local.service
herdr status server
herdr api snapshot
journalctl --user -u herdr-web-local.service -n 100 --no-pager
```

### `Herdr returned invalid JSON`

HerdRabbit이 `api snapshot`, `workspace rename`처럼 JSON을 반환해야 하는 Herdr 명령에서 JSON이 아닌 출력을 받은 경우입니다. `HERDR_BIN`이 올바른 실행 파일인지 확인하고 `herdr api snapshot`을 직접 실행해 JSON 응답 여부를 확인하세요.

### Tailscale HTTPS가 열리지 않음

```bash
tailscale status
tailscale serve status
systemctl --user status herdr-web-local.service
```

서버와 클라이언트가 같은 tailnet인지, MagicDNS와 HTTPS 인증서가 활성화됐는지, ACL이 해당 기기의 접근을 허용하는지 확인합니다. [Tailscale Serve 문서](https://tailscale.com/docs/features/tailscale-serve)도 참고하세요.

### 비밀번호를 잊어버림

해당 Linux 계정으로 SSH 접속해 `npm run password`를 실행합니다. 기존 비밀번호는 필요하지 않습니다. 새 비밀번호를 입력하거나 빈 값으로 인증을 해제하면 서비스가 재시작되고 기존 로그인 세션과 Passkey가 무효화됩니다.

### 설치 스크립트가 포트를 찾지 못함

설치 스크립트는 `30000–39999` 전체가 로컬 서비스 또는 Tailscale Serve에서 사용 중일 때 중단됩니다. 사용 상태를 확인합니다.

```bash
ss -ltn
tailscale serve status
```

### 이전 UI나 아이콘이 계속 보임

브라우저 탭이나 설치된 PWA를 완전히 종료한 뒤 다시 실행합니다. 그래도 유지되면 사이트 데이터를 지우거나 PWA를 제거 후 재설치합니다. 사이트 데이터를 지우면 마지막 선택 세션, 접힌 프로젝트, 테마 설정도 초기화됩니다.

## 보안 경계

- 기본 바인딩은 `127.0.0.1`입니다.
- HerdRabbit 로그인 비밀번호는 `scrypt` 해시로만 저장하며 인증 설정 파일은 해당 OS 사용자만 읽을 수 있습니다. SSH 연결 비밀번호는 재시작 후 사용을 위해 별도 프로필 파일에 암호화 없이 `0600` 권한으로 저장합니다.
- Passkey 개인키와 생체 정보는 HerdRabbit으로 전달되지 않고 공개 credential 정보만 저장합니다.
- 로그인 쿠키에는 `HttpOnly`, `SameSite=Strict`를 적용하고 HTTPS에서는 `Secure`도 적용합니다.
- 비밀번호 변경과 해제 시 서비스를 재시작해 기존 세션과 등록된 Passkey를 무효화합니다.
- 모든 Herdr 호출은 셸을 거치지 않는 `execFile` 인자 배열을 사용합니다.
- Herdr 세션 ID, 프로젝트 ID, 탭 ID, 패인 ID, 이름, 텍스트 길이, 출력 행 수 및 명령 실행 시간을 제한합니다.
- 브라우저가 조합한 임의의 Herdr 세션은 실행하지 않으며, 최근 조회에서 확인된 실행 중 세션만 명령 대상으로 허용합니다.
- 세션과 프로젝트 종료 API는 명시적인 확인 값도 요구합니다.
- 쓰기 API는 서버 시작 시 생성된 CSRF 토큰과 동일 출처 검사를 모두 요구합니다.
- 요청 `Host`는 로컬 인터페이스, 머신 이름 및 명시한 추가 호스트만 허용합니다.
- CORS 허용 헤더를 제공하지 않습니다.
- 엄격한 Content Security Policy, 프레임 차단 및 MIME 스니핑 차단 헤더를 사용합니다.
- 서비스 워커는 정적 앱 셸만 캐시하고 `/api/` 응답과 터미널 출력은 저장하지 않습니다.
- VAPID 비밀 키와 Push 구독 URL은 해당 OS 사용자만 읽을 수 있는 `0600` 파일에 저장합니다.
- 브라우저 저장소에는 UI 설정과 현재 창의 서명된 실행 토큰만 저장하며 비밀번호와 터미널 내용은 저장하지 않습니다.

## 라이선스

[MIT](LICENSE)
