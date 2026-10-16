// The build checks both route shape and cross-field constraints before replacing
// the previous frontend snapshot. Cargo independently validates the same source.
export function validateActions(catalog) {
  const fail = (name) => {
    throw new Error(`Invalid action definition: ${name}`);
  };

  if (!catalog || Array.isArray(catalog) || typeof catalog !== "object") {
    fail("catalog");
  }

  const entries = Object.entries(catalog);

  if (!entries.length) {
    fail("empty catalog");
  }

  const aliases = new Set();
  const variants = new Set();

  for (const [name, action] of entries) {
    if (!/^[a-z_]+$/.test(name) || !action || typeof action !== "object") {
      fail(name);
    }

    if (
      typeof action.variant !== "string" ||
      !/^[A-Z][A-Za-z]*$/.test(action.variant) ||
      variants.has(action.variant)
    ) {
      fail(name);
    }

    variants.add(action.variant);

    if (!["all", "debug_macos"].includes(action.availability)) {
      fail(name);
    }

    if (!["show", "hide", "preserve"].includes(action.visibility)) {
      fail(name);
    }

    const fields = [
      "variant",
      "aliases",
      "availability",
      "visibility",
      "route",
    ];
    const route = action.route;

    if (route === "command" || route === "pointer") {
      fields.push("command");

      if (
        typeof action.command !== "string" ||
        !/^[a-z_]+$/.test(action.command)
      ) {
        fail(name);
      }
    } else if (route === "target") {
      fields.push("purpose", "preparation");

      if (
        typeof action.purpose !== "string" ||
        !/^[a-z_]+$/.test(action.purpose)
      ) {
        fail(name);
      }

      if (!["cancel", "prepare_chip", "tidy"].includes(action.preparation)) {
        fail(name);
      }

      if (
        (action.purpose === "tidy") !== (action.preparation === "tidy") ||
        (action.purpose === "feed_here") !==
          (action.preparation === "prepare_chip")
      ) {
        fail(name);
      }
    } else if (
      ![
        "hide",
        "show",
        "controls",
        "quit",
        "cursor",
        "window_probe",
        "window_spike",
      ].includes(route)
    ) {
      fail(name);
    }

    if (route !== "target" && "preparation" in action) {
      fields.push("preparation");

      if (
        !["show", "controls", "window_probe", "window_spike"].includes(route) ||
        action.preparation !== "tidy_cancel"
      ) {
        fail(name);
      }
    }

    let visibility = "show";

    if (route === "hide") {
      visibility = "hide";
    } else if (
      ["controls", "quit", "window_probe", "window_spike"].includes(route)
    ) {
      visibility = "preserve";
    } else if (route === "command") {
      visibility = action.visibility;
    }

    if (
      visibility !== action.visibility ||
      route.startsWith("window_") !== (action.availability === "debug_macos") ||
      Object.keys(action)
        .some((key) => !fields.includes(key))
    ) {
      fail(name);
    }

    if (!Array.isArray(action.aliases)) {
      fail(name);
    }

    for (const alias of action.aliases) {
      if (
        typeof alias !== "string" ||
        !/^--[a-z-]+$/.test(alias) ||
        aliases.has(alias)
      ) {
        throw new Error(`Invalid or duplicate launcher alias: ${alias}`);
      }

      aliases.add(alias);
    }
  }
}
