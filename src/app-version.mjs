import { readFileSync } from "node:fs";

// A hub and a leaf must agree on the snapshot shape, and nothing in the
// snapshot records which HerdRabbit produced it. The package version is the
// only thing both sides already have, so it is what they compare.
export function readAppVersion() {
  const source = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  const version = JSON.parse(source).version;
  if (typeof version !== "string" || version === "") {
    throw new Error("package.json has no version");
  }
  return version;
}
