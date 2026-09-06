# HerdrBridge

HerdrBridge는 현재 머신에서 실행 중인 [Herdr](https://herdr.dev/) 워크스페이스를 데스크톱과 모바일 브라우저에서 관리하는 작은 웹 애플리케이션입니다. 기존 Herdr 세션에 연결해 상태와 터미널 출력을 확인하고, 입력과 제한된 특수 키를 전달합니다.

런타임 의존성 없이 Node.js 표준 라이브러리와 설치된 `herdr` CLI만 사용합니다. 설치 앱 이름은 `HerdrBridge`, 내부 패키지와 systemd 서비스 이름은 `herdr-web-local`입니다.

HerdrBridge는 OS 사용자별로 실행하며, 선택적으로 인스턴스 비밀번호를 설정할 수 있습니다. 별도의 계정명은 사용하지 않습니다. 공인 인터넷에 직접 공개하지 말고 Tailscale 안에서 사용하는 것을 권장합니다.

## 기능

- 기존 Herdr 워크스페이스, 탭, 패인 및 에이전트 상태 조회
- 현재 OS 사용자에게 등록된 여러 Herdr 영구 세션을 한 화면에서 조회
- 선택한 패인의 ANSI 터미널 출력 표시
- 출력 맨 위에서 스크롤할 때 이전 기록을 200줄씩 추가 로딩
- 선택한 패인에 텍스트 또는 셸 명령 전송
- `Esc`, `Ctrl+C`, `Tab`, `Shift+Tab`, 방향키 및 `Enter` 전송
- 기본 셸로 프로젝트와 세션 생성
- 확인 후 세션 또는 프로젝트 종료
- 프로젝트 이름 변경
- 프로젝트별 하위 세션 접기와 접힘 상태 저장
- 마지막으로 선택한 세션을 저장하고 새로고침 후 복원
- Herdr 상태 기호(`×`, `◐`, `✓`, `○`, `·`) 표시
- 데스크톱 접이식 사이드바와 모바일 오버레이 탐색기
- 라이트·다크 모드
- 터미널 출력과 입력창의 글자 크기 조절 및 설정 저장
- 데스크톱과 모바일에서 설치 가능한 PWA
- 선택형 인스턴스 비밀번호와 30일 로그인 세션
- 사용자별 systemd 서비스 및 충돌하지 않는 `30000–39999` 포트 자동 설치
- 설치 과정에서 Tailscale Serve HTTPS 자동 등록

패인 분할, Herdr 영구 세션명 변경, OS 푸시 알림은 현재 제공하지 않습니다.

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
HerdrBridge Node.js 서버
        │
        │ execFile 인자 배열
        ▼
로컬 herdr CLI ── default 및 이름 있는 Herdr 영구 세션
                         └─ 워크스페이스와 패인
```

프로젝트 생성은 Herdr 워크스페이스를, 세션 생성은 해당 워크스페이스의 새 탭과 기본 셸을 만듭니다. HerdrBridge 자체가 별도의 터미널 서버를 운영하지는 않으며, 화면과 입력은 Herdr 패인에 연결됩니다.

### 여러 Herdr 영구 세션

HerdrBridge는 `herdr session list --json`으로 **서비스를 실행한 OS 사용자의** 영구 세션을 찾습니다. 실행 중인 `default` 및 이름 있는 세션의 snapshot을 각각 가져와 합치며, 같은 `w1:p1` 로컬 ID가 여러 세션에 있어도 충돌하지 않도록 내부적으로 세션 범위 ID를 붙입니다. 입력, 출력, 이름 변경, 생성과 종료 명령은 원래 Herdr 세션으로 다시 라우팅됩니다.

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
- 실행 가능한 `herdr` CLI
- 실행 중인 Herdr 영구 세션 하나 이상
- 원격 HTTPS 접속이 필요하면 Tailscale

버전을 확인합니다.

```bash
node --version
herdr --version
herdr status server
```

## 빠른 시작

### 서비스와 Tailscale HTTPS 자동 설치

Linux에서 실행합니다. macOS에서는 아래의 직접 실행 방법을 사용해야 합니다.

```bash
gh repo clone ultivis-iot/herdr-bridge
cd herdr-bridge
npm run install-service
```

설치 중 HerdrBridge 비밀번호를 숨김 입력으로 묻습니다.

```text
HerdrBridge 비밀번호 (비워 두면 사용 안 함):
비밀번호 확인:
```

- 비밀번호를 입력하면 웹 접속 시 비밀번호 화면이 표시됩니다.
- 아무것도 입력하지 않고 `Enter`를 누르면 비밀번호 인증 없이 설치됩니다.
- Tailscale이 실행 중이면 DNS 이름을 자동으로 허용하고 같은 포트의 HTTPS Serve를 등록합니다.
- `sudo tailscale serve` 실행을 위해 설치 도중 sudo 비밀번호를 물을 수 있습니다.
- 설치 완료 시 선택된 포트와 최종 HTTPS 주소를 출력합니다.

Tailscale이 없거나 실행 중이 아니면 서비스 설치까지만 완료하고 HTTPS 등록은 건너뜁니다.

### 직접 실행

서비스 설치 없이 현재 터미널에서 실행할 수도 있습니다.

```bash
npm start
```

직접 실행의 기본 주소는 다음과 같습니다.

```text
http://127.0.0.1:38787
```

HerdrBridge는 외부 npm 패키지를 사용하지 않으므로 별도의 `npm install`이 필요하지 않습니다.

## 비밀번호 설정과 재설정

비밀번호는 HerdrBridge 인스턴스별로 하나만 사용하며 계정명은 입력하지 않습니다. Linux 계정은 서비스를 실행한 사용자로 결정됩니다.

비밀번호를 변경하거나 잊어버렸다면 해당 Linux 계정으로 SSH 접속한 뒤 저장소에서 실행합니다.

```bash
cd ~/path/to/herdr-bridge
npm run password
```

새 비밀번호를 두 번 입력하면 즉시 교체됩니다. 첫 입력을 비워 두면 비밀번호 인증이 해제됩니다. 설치된 서비스가 실행 중이면 자동으로 재시작하므로 기존 로그인 세션도 모두 무효화됩니다.

비밀번호 원문은 저장하지 않습니다. `scrypt`로 만든 해시와 브라우저 세션 서명용 난수만 다음 파일에 `0600` 권한으로 저장합니다.

```text
~/.config/herdr-bridge/auth.json
```

로그인 세션은 브라우저의 `HttpOnly`, `SameSite=Strict` 쿠키로 유지되며 HTTPS 접속에서는 `Secure` 속성도 적용됩니다. 인증 파일이 없으면 인증을 요구하지 않습니다.

## 사용법

### 세션 선택과 저장

사이드바에서 에이전트 또는 패인을 선택하면 출력이 콘텐츠 영역에 표시됩니다. 마지막 선택은 브라우저 `localStorage`에 저장되며 같은 주소로 다시 접속하거나 새로고침하면 복원됩니다.

여러 Herdr 영구 세션이 등록되어 있으면 사이드바에서 먼저 Herdr 세션명으로 구분한 뒤, 그 아래에 프로젝트와 탭을 표시합니다. 여기서 Herdr **영구 세션**은 독립 서버/소켓 단위이고, 프로젝트 아래의 **세션**은 Herdr 탭 단위입니다.

브라우저 저장소는 출처별로 분리되므로 `http://192.168.x.x:38787`과 `https://server.example.ts.net`은 서로 다른 선택 상태를 가집니다. 저장된 패인이 더 이상 존재하지 않으면 첫 번째 패인을 선택합니다.

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

입력 정책은 기기 이름이 아니라 브라우저의 터치 정보를 조합해 결정합니다. 기본 포인터 판정뿐 아니라 보조 포인터와 터치 포인트 수도 확인하며, 터치 포인트 기반 fallback은 1024px 이하 화면에서만 사용해 창이 좁은 일반 PC를 터치 기기로 오인하지 않도록 합니다. 브라우저는 외장 키보드 연결 여부를 안정적으로 제공하지 않으므로 자동 전환하지 않으며, 외장 키보드에서는 `Ctrl+Enter` 또는 `Cmd+Enter`로 전송합니다.

### 출력과 이전 기록

출력은 1초마다 갱신합니다. 세션 목록과 상태는 2초마다 갱신합니다. 터미널 출력 맨 위까지 스크롤하면 과거 기록을 200줄씩 추가 요청하며, 최대 100,000줄까지 요청할 수 있습니다. Herdr 터미널의 alternate screen에서 이미 사라진 내용은 복구되지 않을 수 있습니다.

### 화면 설정

사이드바 하단 버튼으로 라이트·다크 모드를 전환합니다. 터미널 영역 위에서 `Ctrl+휠`을 사용하거나 트랙패드를 확대·축소하면 터미널 글자 크기가 바뀝니다. 글자 크기는 터미널 출력과 입력창에 함께 적용되며 브라우저 `localStorage`에 저장됩니다. 모바일의 두 손가락 확대·축소는 브라우저 기본 동작대로 화면 전체를 확대합니다.

## 환경 변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `HERDR_WEB_HOST` | `127.0.0.1` | `127.0.0.1` 또는 `0.0.0.0` |
| `HERDR_WEB_PORT` | `38787` | 1024–65535 범위의 수신 포트 |
| `HERDR_WEB_ALLOWED_HOSTS` | 비어 있음 | 역방향 프록시와 Tailscale용 추가 Host 이름. 쉼표로 구분 |
| `HERDR_WEB_AUTH_FILE` | `~/.config/herdr-bridge/auth.json` | 비밀번호 해시와 세션 서명 키를 저장한 인증 파일 |
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

HerdrBridge 서비스의 `HERDR_WEB_ALLOWED_HOSTS`에 위 DNS 이름을 포트나 `https://` 없이 넣습니다.

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

HerdrBridge가 선택된 포트에서 실행 중인 상태에서 로컬 포트와 같은 HTTPS 포트를 등록합니다. 예를 들어 포트가 `38787`이면 다음과 같습니다.

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
git pull --ff-only
npm run verify
systemctl --user restart herdr-web-local.service
```

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

HerdrBridge가 `api snapshot`, `workspace rename`처럼 JSON을 반환해야 하는 Herdr 명령에서 JSON이 아닌 출력을 받은 경우입니다. `HERDR_BIN`이 올바른 실행 파일인지 확인하고 `herdr api snapshot`을 직접 실행해 JSON 응답 여부를 확인하세요.

### Tailscale HTTPS가 열리지 않음

```bash
tailscale status
tailscale serve status
systemctl --user status herdr-web-local.service
```

서버와 클라이언트가 같은 tailnet인지, MagicDNS와 HTTPS 인증서가 활성화됐는지, ACL이 해당 기기의 접근을 허용하는지 확인합니다. [Tailscale Serve 문서](https://tailscale.com/docs/features/tailscale-serve)도 참고하세요.

### 비밀번호를 잊어버림

해당 Linux 계정으로 SSH 접속해 `npm run password`를 실행합니다. 기존 비밀번호는 필요하지 않습니다. 새 비밀번호를 입력하거나 빈 값으로 인증을 해제하면 서비스가 재시작되고 기존 로그인 세션이 무효화됩니다.

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
- 비밀번호는 `scrypt` 해시로만 저장하며 인증 설정 파일은 해당 OS 사용자만 읽을 수 있습니다.
- 로그인 쿠키에는 `HttpOnly`, `SameSite=Strict`를 적용하고 HTTPS에서는 `Secure`도 적용합니다.
- 비밀번호 변경과 해제 시 서비스를 재시작해 기존 세션을 무효화합니다.
- 모든 Herdr 호출은 셸을 거치지 않는 `execFile` 인자 배열을 사용합니다.
- Herdr 세션 ID, 프로젝트 ID, 탭 ID, 패인 ID, 이름, 텍스트 길이, 출력 행 수 및 명령 실행 시간을 제한합니다.
- 브라우저가 조합한 임의의 Herdr 세션은 실행하지 않으며, 최근 조회에서 확인된 실행 중 세션만 명령 대상으로 허용합니다.
- 세션과 프로젝트 종료 API는 명시적인 확인 값도 요구합니다.
- 쓰기 API는 서버 시작 시 생성된 CSRF 토큰과 동일 출처 검사를 모두 요구합니다.
- 요청 `Host`는 로컬 인터페이스, 머신 이름 및 명시한 추가 호스트만 허용합니다.
- CORS 허용 헤더를 제공하지 않습니다.
- 엄격한 Content Security Policy, 프레임 차단 및 MIME 스니핑 차단 헤더를 사용합니다.
- 서비스 워커는 정적 앱 셸만 캐시하고 `/api/` 응답과 터미널 출력은 저장하지 않습니다.
- 브라우저 저장소에는 패인 ID, 접힌 프로젝트 ID 및 테마만 저장하며 터미널 내용은 저장하지 않습니다.

## 라이선스

[MIT](LICENSE)
