/*
 * This file is part of the Anvil extension for GNOME
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

import Meta from "gi://Meta";

/**
 * Prevents Mutter assertions when operating on stale window references.
 * Ported from jcrussell/forge, credit: mayconrcmello/forge PR #520
 */

/**
 * Check whether a Meta window is still alive (has a compositor actor).
 * A dead window can cause Mutter assertions like "stack_position >= 0".
 */
export function isWindowAlive(metaWindow: Meta.Window | null): boolean {
  if (!metaWindow) return false;
  try {
    return metaWindow.get_compositor_private() !== null;
  } catch {
    return false;
  }
}

/**
 * Safe window.raise() — no-op if window is dead or null.
 */
export function safeRaise(metaWindow: Meta.Window | null): void {
  if (!isWindowAlive(metaWindow)) return;
  metaWindow!.raise();
}

/**
 * Safe window.focus() — no-op if window is dead or null.
 */
export function safeFocus(metaWindow: Meta.Window | null, timestamp: number): void {
  if (!isWindowAlive(metaWindow)) return;
  metaWindow!.focus(timestamp);
}

/**
 * Safe window.activate() — no-op if window is dead or null.
 */
export function safeActivate(metaWindow: Meta.Window | null, timestamp: number): void {
  if (!isWindowAlive(metaWindow)) return;
  metaWindow!.activate(timestamp);
}
