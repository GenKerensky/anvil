export type TilingEngineMode = "shadow" | "core";

export function selectTilingEngineMode(value: string | null): TilingEngineMode {
  return value === "core" ? "core" : "shadow";
}
