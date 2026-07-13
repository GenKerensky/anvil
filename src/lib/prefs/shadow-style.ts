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

const LENGTH = "(-?(?:\\d+(?:\\.\\d+)?|\\.\\d+))(?:px)?";
const BOX_SHADOW = new RegExp(
  `^\\s*${LENGTH}\\s+${LENGTH}\\s+${LENGTH}\\s+${LENGTH}\\s+(.+?)\\s*$`
);

export function parseBoxShadow(value: string): ShadowStyle | null {
  const match = BOX_SHADOW.exec(value);
  if (!match) return null;

  const values = match.slice(1, 5).map(Number);
  if (values.some((component) => !Number.isFinite(component))) return null;

  return {
    xOffset: values[0],
    yOffset: values[1],
    blurRadius: values[2],
    spreadRadius: values[3],
    color: match[5],
  };
}

export function formatBoxShadow(style: ShadowStyle): string {
  return `${style.xOffset}px ${style.yOffset}px ${style.blurRadius}px ${style.spreadRadius}px ${style.color}`;
}
