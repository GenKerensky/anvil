/**
 * Transient session flags for WindowManager (B2-3).
 *
 * Groups overview / workspace / freeze lifecycle booleans so they are not a
 * loose bag of fields on the god object. Grab-specific state lives on
 * GrabResizeSession; do not put grab fields here.
 *
 * Transitions (documented, not a full state machine):
 *   - freezeRender: true during grab/minimize batches; renderTree(force) may
 *     temporarily unfreeze one pass then restore.
 *   - workspaceChanging: true for ~300ms after active-workspace-changed
 *     (pointer policy settle). Owned by SignalManager via host; read by
 *     PointerPolicy and GrabResizeSession via their hosts.
 */

export type SessionFlagsState = {
  freezeRender: boolean;
  workspaceChanging: boolean;
};

export function createSessionFlags(): SessionFlagsState {
  return {
    freezeRender: false,
    workspaceChanging: false,
  };
}
