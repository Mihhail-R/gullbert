import definition from "./catalog.json" with { type: "json" };

export type ActionName = keyof typeof definition;
export const catalog = definition;
