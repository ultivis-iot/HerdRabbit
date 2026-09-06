export function applicationServerKeyBytes(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replaceAll("-", "+").replaceAll("_", "/");
  const decoded = atob(base64);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export function pushButtonPresentation({
  supported,
  permission,
  subscribed,
  busy = false,
}) {
  if (!supported) {
    return {
      hidden: true,
      disabled: true,
      pressed: false,
      label: "이 브라우저에서는 상태 알림을 사용할 수 없습니다",
      state: "unavailable",
    };
  }
  if (permission === "denied") {
    return {
      hidden: false,
      disabled: true,
      pressed: false,
      label: "브라우저 설정에서 알림을 허용하세요",
      state: "denied",
    };
  }
  if (subscribed) {
    return {
      hidden: false,
      disabled: busy,
      pressed: true,
      label: busy ? "상태 알림을 끄는 중" : "상태 알림 끄기",
      state: "enabled",
    };
  }
  return {
    hidden: false,
    disabled: busy,
    pressed: false,
    label: busy ? "상태 알림을 켜는 중" : "상태 알림 켜기",
    state: "disabled",
  };
}
