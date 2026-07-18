export interface ShadowStyle {
  xOffset: number;
  yOffset: number;
  blurRadius: number;
  spreadRadius: number;
  color: string;
}

export const DEFAULT_FOCUSED_SHADOW: Readonly<ShadowStyle> = {
  xOffset: 0,
  yOffset: 4,
  blurRadius: 18,
  spreadRadius: 2,
  color: "rgba(0, 0, 0, 0.35)",
};

export const DEFAULT_UNFOCUSED_SHADOW: Readonly<ShadowStyle> = {
  xOffset: 0,
  yOffset: 3,
  blurRadius: 12,
  spreadRadius: 0,
  color: "rgba(0, 0, 0, 0.22)",
};

const CSS_LENGTH_PATTERN = "(-?(?:\\d+(?:\\.\\d+)?|\\.\\d+))(?:px)?";
const BOX_SHADOW_PATTERN = new RegExp(
  `^\\s*${CSS_LENGTH_PATTERN}\\s+${CSS_LENGTH_PATTERN}\\s+${CSS_LENGTH_PATTERN}\\s+${CSS_LENGTH_PATTERN}\\s+(.+?)\\s*$`
);
const HEX_COLOR_PATTERN = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;
const NAMED_COLOR_PATTERN = /^[a-z]+$/i;
const FUNCTION_COLOR_PATTERN = /^(?:rgb|rgba|hsl|hsla)\([^()]+\)$/i;

function isSupportedColor(value: string): boolean {
  return (
    HEX_COLOR_PATTERN.test(value) ||
    NAMED_COLOR_PATTERN.test(value) ||
    FUNCTION_COLOR_PATTERN.test(value)
  );
}

export function parseBoxShadow(value: string): ShadowStyle | null {
  const match = BOX_SHADOW_PATTERN.exec(value);
  if (!match) return null;

  const values = match.slice(1, 5).map(Number);
  const color = match[5];
  if (
    values.some((component) => !Number.isFinite(component)) ||
    values[2] < 0 ||
    !isSupportedColor(color)
  )
    return null;

  return {
    xOffset: values[0],
    yOffset: values[1],
    blurRadius: values[2],
    spreadRadius: values[3],
    color,
  };
}

export function formatBoxShadow(style: ShadowStyle): string {
  return `${style.xOffset}px ${style.yOffset}px ${style.blurRadius}px ${style.spreadRadius}px ${style.color}`;
}
