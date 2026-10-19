const PIXEL = 3;
const CREAM = "#f6f3e8";
const SHADE = "#c4ced5";
const SHADOW = "#93a9b5";

function pixelBlock(x: number, y: number, width: number, height: number, fill: string): string {
  return `<rect x="${x * PIXEL}" y="${y * PIXEL}" width="${width * PIXEL}" ` +
    `height="${height * PIXEL}" fill="${fill}"/>`;
}

/** A chunky stepped bead on the same three-pixel grid as the impact sprite. */
function droplet(x: number, bottom: number, heavy: boolean): string {
  const top = bottom - 4;
  const width = heavy ? 4 : 3;

  return pixelBlock(x, top, width - 2, 1, SHADE) +
    pixelBlock(x - 1, top + 1, width, 2, SHADE) +
    pixelBlock(x, top + 3, width - 2, 1, SHADOW) +
    pixelBlock(x, top + 1, width - 2, 2, CREAM) +
    pixelBlock(x - 1, top + 1, 1, 1, CREAM);
}

/** Fixed pixel rows keep dried streaks stable while the advancing tip grows. */
export function runoffMarkup(id: number, length: number): string {
  const trails = [
    { x: 4, width: 2, fraction: 0.44 + (id % 3) * 0.06 },
    { x: 8, width: 3, fraction: 1 },
    { x: 12, width: 1, fraction: 0.23 + (id % 4) * 0.04 },
  ];
  const bends = [0, 0, 1, 1, 0, 0, -1, -1];

  return trails.map((trail, index) => {
    const rows = Math.floor(length * trail.fraction / PIXEL);

    if (rows < 2) {
      return "";
    }

    const seed = id * 7 + index * 11;
    const blocks: string[] = [];
    const bottom = 8 + rows;
    let tipX = trail.x;

    for (let row = 0; row < rows; row++) {
      const section = Math.floor(row / 7);
      const bend = row < 4 ? 0 : bends[(section + seed) % bends.length];
      const x = trail.x + bend;
      const y = 8 + row;
      const stemWidth = Math.max(1, trail.width - 1);
      const width = row < 4 ? trail.width : stemWidth;
      blocks.push(pixelBlock(x, y, width, 1, CREAM));

      if (width > 1) {
        blocks.push(pixelBlock(x, y, 1, 1, SHADE));
      }

      // Small pools interrupt the thin stem, instead of making three uniform strips.
      if (row > 4 && (row + seed) % 23 === 0) {
        blocks.push(pixelBlock(x - 1, y, width + 1, 2, SHADE));
        blocks.push(pixelBlock(x, y, width, 1, CREAM));
      }

      tipX = x;
    }

    if (rows >= 4) {
      blocks.push(droplet(tipX, bottom, index === 1));
    }

    return `<g class="runoff-trail">${blocks.join("")}</g>`;
  })
    .join("");
}
