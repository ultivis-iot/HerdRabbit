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
      label: "Notifications aren't supported in this browser",
      state: "unavailable",
    };
  }
  if (permission === "denied") {
    return {
      hidden: false,
      disabled: true,
      pressed: false,
      label: "Allow notifications in your browser settings",
      state: "denied",
    };
  }
  if (subscribed) {
    return {
      hidden: false,
      disabled: busy,
      pressed: true,
      label: busy ? "Turning off notifications" : "Turn off notifications",
      state: "enabled",
    };
  }
  return {
    hidden: false,
    disabled: busy,
    pressed: false,
    label: busy ? "Turning on notifications" : "Turn on notifications",
    state: "disabled",
  };
}
