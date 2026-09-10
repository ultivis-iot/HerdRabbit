import { InputValidationError } from "./herdr-client.mjs";

export function validateSshProfile(input, { allowMissingPassword = false } = {}) {
  const text = (key, limit, fallback = "") => {
    const value = input?.[key] ?? fallback;
    if (typeof value !== "string" || value.length > limit || /[\u0000-\u001f\u007f]/u.test(value)) {
      throw new InputValidationError(`Invalid SSH ${key}`);
    }
    return value.trim();
  };
  const name = text("name", 80);
  const host = text("host", 253);
  const username = text("username", 64);
  const authMethod = text("authMethod", 20, input?.identityFile ? "key" : "config");
  const identityFile = authMethod === "key" ? text("identityFile", 512) : "";
  const password = authMethod === "password" ? (input?.password ?? "") : "";
  if (!["config", "key", "password"].includes(authMethod) ||
      (authMethod === "key" && !identityFile) || typeof password !== "string" ||
      password.length > 1024 || /[\u0000\r\n]/u.test(password)) {
    throw new InputValidationError("Choose an authentication method and provide valid credentials.");
  }
  if (authMethod === "password" && !password && !allowMissingPassword) throw new InputValidationError("Enter the SSH password.");
  const herdrBin = text("herdrBin", 512, "herdr") || "herdr";
  const port = input?.port === "" || input?.port == null ? null : Number(input.port);
  if (!name || !/^[A-Za-z0-9][A-Za-z0-9.:-]*$/u.test(host) ||
      (username && !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/u.test(username)) ||
      (identityFile && !identityFile.startsWith("/")) ||
      (herdrBin !== "herdr" && !herdrBin.startsWith("/")) ||
      (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535))) {
    throw new InputValidationError("Enter a valid SSH host, user, port, and absolute file paths.");
  }
  return { name, host, username, port, identityFile, herdrBin, authMethod, password };
}
