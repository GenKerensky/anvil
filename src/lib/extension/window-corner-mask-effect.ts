import Cogl from "gi://Cogl";
import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import Shell from "gi://Shell";

import { mapWindowMaskToOffscreen } from "./window-corner-mask.js";

const MASK_DECLARATIONS = `
uniform vec4 anvilMaskBounds;
uniform float anvilMaskRadius;
uniform vec2 anvilMaskPixelStep;

bool anvilPointInsideBounds(vec2 point, vec4 bounds) {
  return point.x >= bounds.x && point.x <= bounds.z &&
         point.y >= bounds.y && point.y <= bounds.w;
}

float anvilInnerFrameCoverage(vec2 point, vec4 bounds, float radius) {
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
float coverage = anvilPointInsideBounds(point, anvilMaskBounds)
  ? anvilInnerFrameCoverage(point, anvilMaskBounds, anvilMaskRadius)
  // Remove source shadow pixels; BorderController paints a rounded shadow
  // from the already-masked frame as a separate sibling below the window.
  : 0.0;
cogl_color_out *= coverage;
`;

/** GPU-only rounded crop. Border policy and window lifecycle stay in BorderController. */
export const WindowCornerMaskEffect = GObject.registerClass(
  { GTypeName: "AnvilWindowCornerMaskEffect" },
  class WindowCornerMaskEffect extends Shell.GLSLEffect {
    _uniforms: {
      bounds: number;
      radius: number;
      pixelStep: number;
    } | null = null;
    _bounds: [number, number, number, number] = [0, 0, 0, 0];
    _radius = 0;

    vfunc_build_pipeline(): void {
      this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, MASK_DECLARATIONS, MASK_CODE, false);
    }

    update(bounds: [number, number, number, number], radius: number): void {
      if (
        this._radius === radius &&
        this._bounds.every((value, index) => value === bounds[index])
      ) {
        return;
      }
      this._bounds = bounds;
      this._radius = radius;
      this.queue_repaint();
    }

    vfunc_paint_target(node: Clutter.PaintNode, paintContext: Clutter.PaintContext): void {
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

      const actor = this.actor;
      const [hasTarget, targetWidth, targetHeight] = this.get_target_size();
      if (actor && hasTarget) {
        const geometry = mapWindowMaskToOffscreen(
          this._bounds,
          { width: actor.get_width(), height: actor.get_height() },
          { width: targetWidth, height: targetHeight },
          actor.get_resource_scale()
        );
        this.set_uniform_float(this._uniforms.bounds, 4, geometry.bounds);
        this.set_uniform_float(this._uniforms.radius, 1, [this._radius]);
        this.set_uniform_float(this._uniforms.pixelStep, 2, geometry.pixelStep);
      }

      super.vfunc_paint_target(node, paintContext);
    }
  }
);

export type WindowCornerMaskEffect = InstanceType<typeof WindowCornerMaskEffect>;
