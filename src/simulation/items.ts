export const ITEMS = {
  bottle_cap: {
    name: "Bottle cap",
    description: "A crown. For a very small king.",
    reveal: "royal treasure.",
  },
  bent_spoon: {
    name: "Bent spoon",
    description: "A shovel with ambition issues.",
    reveal: "cutlery. improved.",
  },
  sock: {
    name: "One sock",
    description: "The other one lacked vision.",
    reveal: "a sleeping bag. probably.",
  },
  glass_diamond: {
    name: "Glass ‘diamond’",
    description: "Priceless. According to me.",
    reveal: "a completely real diamond.",
  },
  parking_ticket: {
    name: "Parking ticket",
    description: "An official invitation to pay me in chips.",
    reveal: "you have won a fine.",
  },
  chip: {
    name: "Chip",
    description: "I brought lunch. My lunch.",
    reveal: "for you. actually, for me.",
  },
};

export type Item = keyof typeof ITEMS;
export type Collectible = Exclude<Item, "chip">;
export function isItem(value: unknown): value is Item {
  return typeof value === "string" && Object.hasOwn(ITEMS, value);
}
export function isCollectible(value: unknown): value is Collectible {
  return isItem(value) && value !== "chip";
}
