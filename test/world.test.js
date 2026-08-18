import test from "node:test";
import assert from "node:assert/strict";
import {
  VoxelWorld,
  blockKey,
  raycast,
  seededHash,
  terrainHeight,
} from "../src/world.js";

test("terrain generation is deterministic for a seed", () => {
  const samples = [[0, 0], [7, -3], [-14, 12], [20, 20]];
  const first = samples.map(([x, z]) => terrainHeight(x, z, 917));
  const second = samples.map(([x, z]) => terrainHeight(x, z, 917));
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, samples.map(([x, z]) => terrainHeight(x, z, 918)));
});

test("seeded hash stays within its expected range", () => {
  for (let index = -20; index <= 20; index += 1) {
    const value = seededHash(index, index * 3, 44);
    assert.ok(value >= 0 && value <= 1);
  }
});

test("world edits can be serialized and restored", () => {
  const world = new VoxelWorld(100);
  world.set(0, 14, 0, "brick");
  world.set(1, 14, 0, null);

  const restored = new VoxelWorld(100, world.serializeChanges());
  assert.equal(restored.get(0, 14, 0), "brick");
  assert.equal(restored.get(1, 14, 0), undefined);
  assert.equal(restored.changes.has(blockKey(0, 14, 0)), true);
});

test("raycast reports the struck block and placement normal", () => {
  const blocks = new Map([[blockKey(2, 1, 0), "stone"]]);
  const world = { get: (x, y, z) => blocks.get(blockKey(x, y, z)) };
  const hit = raycast(
    world,
    { x: 0.5, y: 1.5, z: 0.5 },
    { x: 1, y: 0, z: 0 },
    5,
  );

  assert.deepEqual(hit.block, { x: 2, y: 1, z: 0 });
  assert.deepEqual(hit.normal, { x: -1, y: 0, z: 0 });
  assert.equal(hit.type, "stone");
});
