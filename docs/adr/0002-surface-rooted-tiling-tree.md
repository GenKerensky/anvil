---
status: proposed
---

# Root each Tiling Tree at a Tiling Surface

The platform-independent model will give every available Tiling Surface one root container, with
only containers and participating windows in its Tiling Tree. A Surface is the core's sole
placement-space identity; workspaces, monitors, outputs, and their composition remain entirely in
the window-manager adapter. Selection and stacking remain separate from structural child order.
This avoids reproducing the existing GNOME, output-topology, and presentation coupling in the
replacement model.

Each Surface supplies one rectangular, surface-local layout canvas and directional adjacency to
other Surfaces. An adapter may define a Surface as one workspace/output pair, a workspace spanning
multiple outputs, or any other stable placement space. If a platform cannot normalize a genuinely
non-rectangular region to one valid layout canvas, it exposes multiple Surfaces until the core
explicitly supports region-set geometry.
