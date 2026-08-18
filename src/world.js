export const WORLD_RADIUS = 22;
export const SEA_LEVEL = 4;

export const BLOCKS = Object.freeze({
  grass: {
    name: "Meadow Grass",
    swatch: "linear-gradient(#6faa3b 0 26%, #795234 27% 100%)",
    top: [0.38, 0.68, 0.2],
    side: [0.42, 0.45, 0.2],
    bottom: [0.42, 0.28, 0.16],
  },
  dirt: {
    name: "Rich Soil",
    swatch: "#795234",
    top: [0.48, 0.31, 0.18],
    side: [0.48, 0.31, 0.18],
    bottom: [0.39, 0.24, 0.14],
  },
  stone: {
    name: "River Stone",
    swatch: "#7d8589",
    top: [0.52, 0.55, 0.56],
    side: [0.46, 0.49, 0.5],
    bottom: [0.36, 0.39, 0.4],
  },
  wood: {
    name: "Cedar Log",
    swatch: "repeating-linear-gradient(90deg, #714225 0 4px, #8e5930 4px 8px)",
    top: [0.62, 0.43, 0.24],
    side: [0.45, 0.25, 0.12],
    bottom: [0.52, 0.34, 0.18],
  },
  leaves: {
    name: "Cedar Leaves",
    swatch: "#397534",
    top: [0.25, 0.5, 0.2],
    side: [0.19, 0.42, 0.17],
    bottom: [0.15, 0.34, 0.14],
  },
  sand: {
    name: "Golden Sand",
    swatch: "#d8bd72",
    top: [0.82, 0.72, 0.43],
    side: [0.72, 0.62, 0.36],
    bottom: [0.63, 0.54, 0.31],
  },
  brick: {
    name: "Sunbaked Brick",
    swatch: "repeating-linear-gradient(0deg, #a6573d 0 7px, #713c31 7px 9px)",
    top: [0.67, 0.35, 0.25],
    side: [0.58, 0.27, 0.2],
    bottom: [0.45, 0.21, 0.16],
  },
  water: {
    name: "Spring Water",
    swatch: "#318bc2",
    top: [0.18, 0.55, 0.76],
    side: [0.12, 0.43, 0.67],
    bottom: [0.08, 0.33, 0.56],
    liquid: true,
  },
});

export const PLACEABLE_BLOCKS = Object.freeze([
  "grass",
  "dirt",
  "stone",
  "wood",
  "leaves",
  "sand",
  "brick",
]);

export function blockKey(x, y, z) {
  return `${x},${y},${z}`;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function fade(value) {
  return value * value * (3 - 2 * value);
}

export function seededHash(x, z, seed = 1) {
  let value = Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 982451653);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x, z, scale, seed) {
  const scaledX = x / scale;
  const scaledZ = z / scale;
  const x0 = Math.floor(scaledX);
  const z0 = Math.floor(scaledZ);
  const tx = fade(scaledX - x0);
  const tz = fade(scaledZ - z0);
  const top = seededHash(x0, z0, seed) * (1 - tx) + seededHash(x0 + 1, z0, seed) * tx;
  const bottom = seededHash(x0, z0 + 1, seed) * (1 - tx) + seededHash(x0 + 1, z0 + 1, seed) * tx;
  return top * (1 - tz) + bottom * tz;
}

export function terrainHeight(x, z, seed = 1) {
  const broad = valueNoise(x, z, 15, seed);
  const detail = valueNoise(x, z, 6, seed + 41);
  const ridge = Math.sin((x + seed % 13) * 0.11) * 0.45;
  let height = Math.floor(2.3 + broad * 6 + detail * 2 + ridge);

  const riverCenter = Math.sin((z + seed % 17) * 0.16) * 4 - 3;
  const riverDistance = Math.abs(x - riverCenter);
  if (riverDistance < 2.1) {
    height = Math.min(height, 2 + Math.floor(riverDistance * 0.5));
  }

  return clamp(height, 2, 11);
}

export class VoxelWorld {
  constructor(seed = 1847, savedChanges = []) {
    this.seed = Number.isFinite(Number(seed)) ? Number(seed) : 1847;
    this.blocks = new Map();
    this.changes = new Map();
    this.generate();
    this.applyChanges(savedChanges);
  }

  generate() {
    this.blocks.clear();

    for (let x = -WORLD_RADIUS; x <= WORLD_RADIUS; x += 1) {
      for (let z = -WORLD_RADIUS; z <= WORLD_RADIUS; z += 1) {
        const height = terrainHeight(x, z, this.seed);
        const beach = height <= SEA_LEVEL + 1;

        for (let y = 0; y <= height; y += 1) {
          let type = "stone";
          if (y === height) type = beach ? "sand" : "grass";
          else if (y >= height - 2) type = beach ? "sand" : "dirt";
          this.blocks.set(blockKey(x, y, z), type);
        }

        for (let y = height + 1; y <= SEA_LEVEL; y += 1) {
          this.blocks.set(blockKey(x, y, z), "water");
        }
      }
    }

    this.growTrees();
  }

  growTrees() {
    for (let x = -WORLD_RADIUS + 3; x <= WORLD_RADIUS - 3; x += 1) {
      for (let z = -WORLD_RADIUS + 3; z <= WORLD_RADIUS - 3; z += 1) {
        const ground = terrainHeight(x, z, this.seed);
        const roll = seededHash(x * 3, z * 3, this.seed + 109);
        const insideStarterClearing = Math.abs(x) < 7 && Math.abs(z) < 7;
        if (ground <= SEA_LEVEL + 1 || roll < 0.965 || insideStarterClearing) continue;

        const trunkHeight = 3 + Math.floor(seededHash(x, z, this.seed + 251) * 2);
        for (let y = ground + 1; y <= ground + trunkHeight; y += 1) {
          this.blocks.set(blockKey(x, y, z), "wood");
        }

        const crownY = ground + trunkHeight;
        for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
          for (let offsetZ = -2; offsetZ <= 2; offsetZ += 1) {
            for (let offsetY = -1; offsetY <= 2; offsetY += 1) {
              const distance = Math.abs(offsetX) + Math.abs(offsetZ) + Math.max(0, offsetY);
              if (distance > 4 || offsetX === 0 && offsetZ === 0 && offsetY <= 0) continue;
              if (seededHash(x + offsetX * 7, z + offsetZ * 11 + offsetY, this.seed) < 0.12) continue;
              this.blocks.set(blockKey(x + offsetX, crownY + offsetY, z + offsetZ), "leaves");
            }
          }
        }
      }
    }
  }

  get(x, y, z) {
    return this.blocks.get(blockKey(x, y, z));
  }

  isSolid(x, y, z) {
    const block = BLOCKS[this.get(x, y, z)];
    return Boolean(block && !block.liquid);
  }

  set(x, y, z, type) {
    const key = blockKey(x, y, z);
    if (type && BLOCKS[type]) this.blocks.set(key, type);
    else this.blocks.delete(key);
    this.changes.set(key, type || null);
  }

  applyChanges(changes) {
    if (!Array.isArray(changes)) return;
    for (const change of changes) {
      if (!Array.isArray(change) || change.length !== 4) continue;
      const [x, y, z, type] = change;
      if (![x, y, z].every(Number.isInteger) || type !== null && !BLOCKS[type]) continue;
      const key = blockKey(x, y, z);
      if (type) this.blocks.set(key, type);
      else this.blocks.delete(key);
      this.changes.set(key, type);
    }
  }

  serializeChanges() {
    return [...this.changes.entries()].map(([key, type]) => [
      ...key.split(",").map(Number),
      type,
    ]);
  }

  findSpawn() {
    for (let radius = 0; radius < 8; radius += 1) {
      for (let x = -radius; x <= radius; x += 1) {
        for (let z = -radius; z <= radius; z += 1) {
          let top = 15;
          while (top > 0 && !this.isSolid(x, top, z)) top -= 1;
          const hasHeadroom = !this.get(x, top + 1, z)
            && !this.get(x, top + 2, z)
            && !this.get(x, top + 3, z);
          if (this.get(x, top, z) === "grass" && hasHeadroom) {
            return { x: x + 0.5, y: top + 1.01, z: z + 0.5 };
          }
        }
      }
    }
    return { x: 0.5, y: 14, z: 0.5 };
  }
}

export function raycast(world, origin, direction, maxDistance = 7) {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);
  const stepX = direction.x >= 0 ? 1 : -1;
  const stepY = direction.y >= 0 ? 1 : -1;
  const stepZ = direction.z >= 0 ? 1 : -1;
  const deltaX = direction.x === 0 ? Infinity : Math.abs(1 / direction.x);
  const deltaY = direction.y === 0 ? Infinity : Math.abs(1 / direction.y);
  const deltaZ = direction.z === 0 ? Infinity : Math.abs(1 / direction.z);
  let maxX = direction.x === 0 ? Infinity : ((stepX > 0 ? x + 1 - origin.x : origin.x - x) * deltaX);
  let maxY = direction.y === 0 ? Infinity : ((stepY > 0 ? y + 1 - origin.y : origin.y - y) * deltaY);
  let maxZ = direction.z === 0 ? Infinity : ((stepZ > 0 ? z + 1 - origin.z : origin.z - z) * deltaZ);
  let distance = 0;
  let normal = { x: 0, y: 0, z: 0 };

  while (distance <= maxDistance) {
    const type = world.get(x, y, z);
    if (type && type !== "water") {
      return { block: { x, y, z }, distance, normal, type };
    }

    if (maxX < maxY && maxX < maxZ) {
      x += stepX;
      distance = maxX;
      maxX += deltaX;
      normal = { x: -stepX, y: 0, z: 0 };
    } else if (maxY < maxZ) {
      y += stepY;
      distance = maxY;
      maxY += deltaY;
      normal = { x: 0, y: -stepY, z: 0 };
    } else {
      z += stepZ;
      distance = maxZ;
      maxZ += deltaZ;
      normal = { x: 0, y: 0, z: -stepZ };
    }
  }

  return null;
}
