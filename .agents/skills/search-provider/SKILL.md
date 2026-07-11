---
name: search-provider
description: Add search results to the GNOME Shell overview search by implementing the SearchProvider interface
license: MIT
compatibility: agents
---

# Search Provider

Guide for adding search results to the GNOME Shell overview search. Extensions
register directly with `Main.overview.searchController` — no D-Bus service needed,
unlike applications.

## Imports

```ts
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
```

## Architecture

A search provider implements an interface with 7 methods. The search controller
calls them in this order:

1. `getInitialResultSet(terms, cancellable)` → returns `string[]` of result IDs
2. `getSubsearchResultSet(results, terms, cancellable)` → filters for refined queries
3. `getResultMetas(results, cancellable)` → returns `ResultMeta[]` for display
4. `filterResults(results, maxResults)` → trims to `maxResults`
5. `activateResult(result, terms)` → called when user activates a result
6. `createResultObject(meta)` → optionally creates a custom actor (return `null` for default)
7. `launchSearch(terms)` → called if provider supports launching a full search

All async methods receive a `Gio.Cancellable` — you **must** check it and throw
if cancelled, or the search will hang.

## `ResultMeta`

The metadata object returned by `getResultMetas()`:

```ts
type ResultMeta = {
  id: string; // unique identifier
  name: string; // display name
  description?: string; // longer description (shown in list view)
  clipboardText?: string; // copied to clipboard on activation
  createIcon: (size: number) => Clutter.Actor; // icon factory
};
```

### `CreateIcon` callback

Must respect the scale factor for HiDPI displays:

```ts
const { scaleFactor } = St.ThemeContext.get_for_stage(global.stage);

createIcon: (size: number) => {
  return new St.Icon({
    icon_name: "dialog-information",
    width: size * scaleFactor,
    height: size * scaleFactor,
  });
};
```

## `SearchProvider` Interface

Full implementation with all required methods:

```ts
class MySearchProvider {
  _extension: AnvilExtension;

  constructor(extension: AnvilExtension) {
    this._extension = extension;
  }

  // Application info — extensions usually return null
  get appInfo(): Gio.AppInfo | null {
    return null;
  }

  // Whether the provider supports launching a full search
  get canLaunchSearch(): boolean {
    return false;
  }

  // Unique ID — extensions usually use their UUID
  get id(): string {
    return this._extension.uuid;
  }

  // Called when a result is activated by the user
  activateResult(result: string, terms: string[]): void {
    log(`activateResult: ${result}, [${terms}]`);
  }

  // Called when the provider is activated (only if canLaunchSearch is true)
  launchSearch(terms: string[]): void {
    log(`launchSearch: [${terms}]`);
  }

  // Optional: return a custom actor for the result (null = default)
  createResultObject(meta: ResultMeta): Clutter.Actor | null {
    return null;
  }

  // Return metadata for a list of result IDs
  async getResultMetas(results: string[], cancellable: Gio.Cancellable): Promise<ResultMeta[]> {
    const { scaleFactor } = St.ThemeContext.get_for_stage(global.stage);

    return new Promise((resolve, reject) => {
      const cancelledId = cancellable.connect(() => reject(new Error("Operation Cancelled")));

      const metas: ResultMeta[] = results.map((id) => ({
        id,
        name: `Result ${id}`,
        description: `Description for ${id}`,
        clipboardText: `Copied: ${id}`,
        createIcon: (size: number) =>
          new St.Icon({
            icon_name: "dialog-information",
            width: size * scaleFactor,
            height: size * scaleFactor,
          }),
      }));

      cancellable.disconnect(cancelledId);
      if (!cancellable.is_cancelled()) resolve(metas);
    });
  }

  // Start a new search — return result IDs
  async getInitialResultSet(terms: string[], cancellable: Gio.Cancellable): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const cancelledId = cancellable.connect(() => reject(new Error("Search Cancelled")));

      // Perform search, generate IDs
      const ids = ["result-01", "result-02", "result-03"];

      cancellable.disconnect(cancelledId);
      if (!cancellable.is_cancelled()) resolve(ids);
    });
  }

  // Refine search results with expanded terms — return subset of results
  async getSubsearchResultSet(results: string[], terms: string[], cancellable: Gio.Cancellable): Promise<string[]> {
    if (cancellable.is_cancelled()) throw new Error("Search Cancelled");

    // Simple: re-run full search. Override for efficiency.
    return this.getInitialResultSet(terms, cancellable);
  }

  // Truncate results to maxResults
  filterResults(results: string[], maxResults: number): string[] {
    if (results.length <= maxResults) return results;
    return results.slice(0, maxResults);
  }
}
```

## Cancellable Pattern

Every async method must handle `cancellable`. The pattern:

```ts
return new Promise((resolve, reject) => {
  const cancelledId = cancellable.connect(() => reject(new Error("Search Cancelled")));

  // ... do work ...

  cancellable.disconnect(cancelledId);
  if (!cancellable.is_cancelled()) resolve(result);
});
```

For synchronous methods (`getSubsearchResultSet`), check at the start:

```ts
if (cancellable.is_cancelled()) throw new Error("Search Cancelled");
```

Skipping this will cause the search UI to hang when the user types quickly.

## Registration

Register in `enable()`, unregister in `disable()`:

```ts
export default class MyExtension extends Extension {
  enable() {
    this._provider = new MySearchProvider(this);
    Main.overview.searchController.addProvider(this._provider);
  }

  disable() {
    Main.overview.searchController.removeProvider(this._provider);
    this._provider = null;
  }
}
```

## Tips

- **Keep `getInitialResultSet` fast** — it runs on every keystroke. Use it only to
  generate IDs and defer heavy work to `getResultMetas`.
- **The search terms array** contains the full list of space-separated terms from
  the search entry. Filter by all terms, not just the first one.
- **`getSubsearchResultSet`** is called when the user types more characters into
  the same query. The default implementation re-runs `getInitialResultSet`, which
  is correct but inefficient for large result sets. Override if needed.
- **Scale factor** from `St.ThemeContext.get_for_stage(global.stage)` is critical
  for sharp icons on HiDPI displays.

## Testing

Search providers cannot be tested headless — the overview and search entry are not
functional in `--headless --wayland`. The search controller and provider interface
can be mocked in unit tests.
