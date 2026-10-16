/** Validate author-facing content before publishing a frontend build. */
export function validateDialogue(catalog) {
  function visit(value, path) {
    if (typeof value === "string") {
      const speaker = /^guests\.[^.]+\.[^.]+\.\d+\.(gullbert|visitor)$/.test(
        path,
      );
      if (!value.trim() && !(speaker && value === "")) {
        throw new Error(`Dialogue ${path}: expected nonblank text`);
      }
      const placeholders = value.match(/\{[^{}]*\}/g) ?? [];
      const treasure = path.startsWith("gullbert.greetings.treasure.");
      if (placeholders.some((token) => token !== "{item}" || !treasure)) {
        throw new Error(`Dialogue ${path}: unknown placeholder`);
      }
      if (treasure && !placeholders.includes("{item}")) {
        throw new Error(`Dialogue ${path}: treasure greetings need {item}`);
      }
      return;
    }
    if (
      !value ||
      typeof value !== "object" ||
      Object.keys(value).length === 0
    ) {
      throw new Error(`Dialogue ${path}: expected text or a nonempty group`);
    }
    if (Array.isArray(value)) {
      if (
        new Set(value.map((entry) => JSON.stringify(entry))).size !==
        value.length
      ) {
        throw new Error(`Dialogue ${path}: duplicate alternatives`);
      }
      if (path.startsWith("guests.")) {
        for (const pair of value) {
          if (
            typeof pair?.gullbert !== "string" ||
            typeof pair?.visitor !== "string"
          ) {
            throw new Error(
              `Dialogue ${path}: each exchange needs both speakers and at least one line`,
            );
          }
          if (!pair.gullbert.trim() && !pair.visitor.trim()) {
            throw new Error(
              `Dialogue ${path}: each exchange needs both speakers and at least one line`,
            );
          }
        }
      } else if (!value.every((line) => typeof line === "string")) {
        throw new Error(`Dialogue ${path}: alternatives must be strings`);
      }
    }
    for (const [key, child] of Object.entries(value)) {
      visit(child, path ? `${path}.${key}` : key);
    }
  }
  visit(catalog, "");
}
