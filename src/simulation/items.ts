import { dialogue } from "./dialogue.js";

export const ITEMS = dialogue.gullbert.gifts.items;

export type Item = keyof typeof ITEMS;
export type Collectible = Exclude<Item, "chip">;
export function isItem(value: unknown): value is Item {
  return typeof value === "string" && Object.hasOwn(ITEMS, value);
}
export function isCollectible(value: unknown): value is Collectible {
  return isItem(value) && value !== "chip";
}
