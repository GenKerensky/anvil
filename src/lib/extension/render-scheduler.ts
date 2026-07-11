/**
 * RenderScheduler — idle-coalesced render/reload scheduling + freeze protocol.
 *
 * Extracted from WindowManager.renderTree / reloadTree. Owns the
 * _renderTreeSrcId / _reloadTreeSrcId GLib sources. Freeze state remains
 * on SessionFlags (WM); this module is a caller via host.
 *
 * Lifecycle rules: `.agents/rules/architecture.md` (§1 every enable has a
 * disable inverse — see RenderScheduler.dispose). Extraction rationale:
 * `.agents/memory/decisions.md`.
 */

import GLib from "gi://GLib";

export interface RenderSchedulerHost {
  isRenderFrozen(): boolean;
  freezeRender(): void;
  unfreezeRender(): void;
  updateDecorationLayout(): void;
  updateBorderLayout(): void;
  tilingRenderRender(from: string): void;
  trackCurrentWindows(): void;
  treeReinitializeWorkspaces(): void;
  treeResetRoot(): void;
  disableDecorations(): void;
  get tilingModeEnabled(): boolean;
}

export class RenderScheduler {
  private _renderSrcId = 0;
  private _reloadSrcId = 0;

  constructor(private host: RenderSchedulerHost) {}

  renderTree(from: string, force: boolean = false): void {
    const wasFrozen = this.host.isRenderFrozen();
    if (force && wasFrozen) this.host.unfreezeRender();
    if (this.host.isRenderFrozen() || !this.host.tilingModeEnabled) {
      this.host.updateDecorationLayout();
      this.host.updateBorderLayout();
    } else {
      if (!this._renderSrcId) {
        this._renderSrcId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
          this.host.tilingRenderRender(from);
          this._renderSrcId = 0;
          this.host.updateDecorationLayout();
          this.host.updateBorderLayout();
          if (wasFrozen) this.host.freezeRender();
          return false;
        });
      }
    }
  }

  reloadTree(from: string): void {
    if (!this._reloadSrcId) {
      this._reloadSrcId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
        this.host.disableDecorations();
        this.host.treeResetRoot();
        this.host.treeReinitializeWorkspaces();
        this.host.trackCurrentWindows();
        this.renderTree(from);
        this._reloadSrcId = 0;
        return false;
      });
    }
  }

  dispose(): void {
    if (this._renderSrcId) {
      GLib.Source.remove(this._renderSrcId);
      this._renderSrcId = 0;
    }
    if (this._reloadSrcId) {
      GLib.Source.remove(this._reloadSrcId);
      this._reloadSrcId = 0;
    }
  }
}
