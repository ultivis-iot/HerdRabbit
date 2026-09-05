# HerdrBridge

HerdrBridge는 현재 머신에서 실행 중인 [Herdr](https://herdr.dev/) 워크스페이스를 데스크톱과 모바일 브라우저에서 관리하는 작은 웹 애플리케이션입니다. 기존 Herdr 세션에 연결해 상태와 터미널 출력을 확인하고, 입력과 제한된 특수 키를 전달합니다.

런타임 의존성 없이 Node.js 표준 라이브러리와 설치된 `herdr` CLI만 사용합니다. 설치 앱 이름은 `HerdrBridge`, 내부 패키지와 systemd 서비스 이름은 `herdr-web-local`입니다.

> HerdrBridge에는 별도의 사용자 계정이나 로그인 기능이 없습니다. 공인 인터넷에 직접 공개하지 말고, 로컬 네트워크 방화벽이나 Tailscale ACL로 접근 주체를 제한하세요.

## 기능

- 기존 Herdr 워크스페이스, 탭, 패인 및 에이전트 상태 조회
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
- 데스크톱과 모바일에서 설치 가능한 PWA

패인 분할, Herdr 영구 세션명 변경, OS 푸시 알림은 현재 제공하지 않습니다.

## 구조

```text
브라우저 / 설치된 PWA
        │
        │ HTTPS (선택 사항)
        ▼
Tailscale Serve
        │
        │ http://127.0.0.1:38787
        ▼
HerdrBridge Node.js 서버
        │
        │ execFile 인자 배열
        ▼
로컬 herdr CLI ── Herdr 워크스페이스와 패인
```

프로젝트 생성은 Herdr 워크스페이스를, 세션 생성은 해당 워크스페이스의 새 탭과 기본 셸을 만듭니다. HerdrBridge 자체가 별도의 터미널 서버를 운영하지는 않으며, 화면과 입력은 Herdr 패인에 연결됩니다.

## 요구 사항

- Linux 또는 macOS
- Node.js 22 이상
- 실행 가능한 `herdr` CLI
- 실행 중인 Herdr 서버
- 원격 HTTPS 접속이 필요하면 Tailscale

버전을 확인합니다.

```bash
node --version
herdr --version
herdr status server
```

## 빠른 시작

```bash
gh repo clone ultivis-iot/herdr-bridge
cd herdr-bridge
npm start
```

기본 주소는 다음과 같습니다.

```text
http://127.0.0.1:38787
```

HerdrBridge는 외부 npm 패키지를 사용하지 않으므로 별도의 `npm install`이 필요하지 않습니다.

## 사용법

### 세션 선택과 저장

사이드바에서 에이전트 또는 패인을 선택하면 출력이 콘텐츠 영역에 표시됩니다. 마지막 선택은 브라우저 `localStorage`에 저장되며 같은 주소로 다시 접속하거나 새로고침하면 복원됩니다.

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

- `Sessions` 오른쪽의 `+` 버튼은 이름을 지정한 새 프로젝트와 기본 셸을 만듭니다.
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

입력 정책은 화면 너비나 기기 이름이 아니라 브라우저의 기본 포인터 특성으로 결정합니다. 기본 포인터가 터치이고 hover가 없는 휴대폰·태블릿은 터치 정책을 사용합니다. 브라우저는 외장 키보드 연결 여부를 안정적으로 제공하지 않으므로 자동 전환하지 않으며, 외장 키보드에서는 `Ctrl+Enter` 또는 `Cmd+Enter`로 전송합니다.

### 출력과 이전 기록

출력은 1초마다 갱신합니다. 세션 목록과 상태는 2초마다 갱신합니다. 터미널 출력 맨 위까지 스크롤하면 과거 기록을 200줄씩 추가 요청하며, 최대 100,000줄까지 요청할 수 있습니다. Herdr 터미널의 alternate screen에서 이미 사라진 내용은 복구되지 않을 수 있습니다.

## 환경 변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `HERDR_WEB_HOST` | `127.0.0.1` | `127.0.0.1` 또는 `0.0.0.0` |
| `HERDR_WEB_PORT` | `38787` | 1024–65535 범위의 수신 포트 |
| `HERDR_WEB_ALLOWED_HOSTS` | 비어 있음 | 역방향 프록시와 Tailscale용 추가 Host 이름. 쉼표로 구분 |
| `HERDR_BIN` | `herdr` | 사용할 Herdr 실행 파일 경로 |

예시:

```bash
HERDR_WEB_HOST=0.0.0.0 \
HERDR_WEB_PORT=38787 \
HERDR_WEB_ALLOWED_HOSTS=my-server.example-tailnet.ts.net \
HERDR_BIN="$HOME/.local/bin/herdr" \
npm start
```

`127.0.0.1`은 이 머신과 Tailscale Serve를 통한 접속만 허용하는 권장값입니다. `0.0.0.0`은 LAN에서도 직접 접속할 때만 사용하세요. 애플리케이션 로그인이 없으므로 신뢰할 수 없는 LAN에서 `0.0.0.0`으로 열어 두면 안 됩니다.

## systemd 사용자 서비스

저장소의 [`systemd/herdr-web-local.service`](systemd/herdr-web-local.service)는 현재 설치 환경을 보여주는 예시입니다. 다른 머신에서는 다음 항목을 실제 경로와 호스트명으로 수정해야 합니다.

- `Documentation`
- `WorkingDirectory`
- `HERDR_WEB_HOST`
- `HERDR_WEB_ALLOWED_HOSTS`
- `HERDR_BIN`
- `ExecStart`의 Node.js와 저장소 경로

실제 경로를 확인합니다.

```bash
command -v node
command -v herdr
pwd
```

서비스 파일을 설치하고 편집합니다.

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

HerdrBridge가 `127.0.0.1:38787`에서 실행 중인 상태에서 다음 명령을 실행합니다.

```bash
sudo tailscale serve --bg --yes http://127.0.0.1:38787
```

HTTPS가 tailnet에서 처음 사용되는 경우 Tailscale이 MagicDNS와 HTTPS 인증서 사용 동의를 요청할 수 있습니다. 자세한 동작은 [Serve CLI 문서](https://tailscale.com/docs/reference/tailscale-cli/serve)와 [HTTPS 인증서 문서](https://tailscale.com/docs/how-to/set-up-https-certificates)를 참고하세요.

설정 결과와 접속 URL을 확인합니다.

```bash
tailscale serve status
```

출력 예시:

```text
https://my-server.example-tailnet.ts.net (tailnet only)
|-- / proxy http://127.0.0.1:38787
```

`--bg` 설정은 Tailscale 재시작이나 머신 재부팅 후에도 유지됩니다. Serve 설정을 모두 제거하려면 다음을 실행합니다.

```bash
sudo tailscale serve reset
```

Tailscale을 연결하지 않은 기기에서는 이 HTTPS 주소에 접속할 수 없습니다. 공개 인터넷 노출 기능인 Tailscale Funnel은 로그인 기능이 없는 HerdrBridge에 사용하지 않는 것을 권장합니다.

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

### 이전 UI나 아이콘이 계속 보임

브라우저 탭이나 설치된 PWA를 완전히 종료한 뒤 다시 실행합니다. 그래도 유지되면 사이트 데이터를 지우거나 PWA를 제거 후 재설치합니다. 사이트 데이터를 지우면 마지막 선택 세션, 접힌 프로젝트, 테마 설정도 초기화됩니다.

## 보안 경계

- 기본 바인딩은 `127.0.0.1`입니다.
- 모든 Herdr 호출은 셸을 거치지 않는 `execFile` 인자 배열을 사용합니다.
- 프로젝트 ID, 탭 ID, 패인 ID, 이름, 텍스트 길이, 출력 행 수 및 명령 실행 시간을 제한합니다.
- 세션과 프로젝트 종료 API는 명시적인 확인 값도 요구합니다.
- 쓰기 API는 서버 시작 시 생성된 CSRF 토큰과 동일 출처 검사를 모두 요구합니다.
- 요청 `Host`는 로컬 인터페이스, 머신 이름 및 명시한 추가 호스트만 허용합니다.
- CORS 허용 헤더를 제공하지 않습니다.
- 엄격한 Content Security Policy, 프레임 차단 및 MIME 스니핑 차단 헤더를 사용합니다.
- 서비스 워커는 정적 앱 셸만 캐시하고 `/api/` 응답과 터미널 출력은 저장하지 않습니다.
- 브라우저 저장소에는 패인 ID, 접힌 프로젝트 ID 및 테마만 저장하며 터미널 내용은 저장하지 않습니다.

## 라이선스

[MIT](LICENSE)
