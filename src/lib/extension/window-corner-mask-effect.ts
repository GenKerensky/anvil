import Cogl from "gi://Cogl";
import GObject from "gi://GObject";
import Shell from "gi://Shell";

const MASK_DECLARATIONS = `
uniform vec4 anvilMaskBounds;
uniform float anvilMaskRadius;
uniform vec2 anvilMaskPixelStep;

float anvilRoundedRectCoverage(vec2 point, vec4 bounds, float radius) {
  if (point.x < bounds.x || point.x > bounds.z ||
      point.y < bounds.y || point.y > bounds.w)
    return 1.0;
  if (radius <= 0.0)
    return 1.0;
  if ((point.x >= bounds.x + radius && point.x <= bounds.z - radius) ||
      (point.y >= bounds.y + radius && point.y <= bounds.w - radius))
    return 1.0;

  vec2 center = clamp(point, bounds.xy + vec2(radius), bounds.zw - vec2(radius));
  vec2 delta = point - center;
  return 1.0 - smoothstep(radius - 0.5, radius + 0.5, length(delta));
}
`;

const MASK_CODE = `
vec2 point = cogl_tex_coord0_in.xy / anvilMaskPixelStep;
float coverage = anvilRoundedRectCoverage(point, anvilMaskBounds, anvilMaskRadius);
cogl_color_out *= coverage;
`;

/** GPU-only rounded crop. Border policy and window lifecycle stay in BorderController. */
export const WindowCornerMaskEffect = GObject.registerClass(
  { GTypeName: "AnvilWindowCornerMaskEffect" },
  class WindowCornerMaskEffect extends Shell.GLSLEffect {
    _uniforms: { bounds: number; radius: number; pixelStep: number } | null = null;

    vfunc_build_pipeline(): void {
      this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, MASK_DECLARATIONS, MASK_CODE, false);
    }

    update(bounds: [number, number, number, number], radius: number): void {
      if (!this._uniforms) {
        this._uniforms = {
          bounds: this.get_uniform_location("anvilMaskBounds"),
          radius: this.get_uniform_location("anvilMaskRadius"),
          pixelStep: this.get_uniform_location("anvilMaskPixelStep"),
        };
        if (Object.values(this._uniforms).some((location) => location < 0)) {
          throw new Error("window corner mask shader failed to compile");
        }
      }

      const width = this.actor?.get_width() ?? 0;
      const height = this.actor?.get_height() ?? 0;
      this.set_uniform_float(this._uniforms.bounds, 4, bounds);
      this.set_uniform_float(this._uniforms.radius, 1, [radius]);
      this.set_uniform_float(this._uniforms.pixelStep, 2, [
        width > 0 ? 1 / width : 1,
        height > 0 ? 1 / height : 1,
      ]);
      this.queue_repaint();
    }
  }
);

export type WindowCornerMaskEffect = InstanceType<typeof WindowCornerMaskEffect>;
