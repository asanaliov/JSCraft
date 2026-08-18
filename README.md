# JSCraft

JSCraft is a small original voxel sandbox that runs directly in a modern browser.
It includes a deterministic world, first-person movement, terrain collision, seven placeable block types, block breaking, persistent local saves, a day clock, and touch controls.

## Run it

```bash
npm start
```

Open `http://localhost:4173` in a browser.

No package installation is required.

## Controls

- Use `W`, `A`, `S`, and `D` to move.
- Move the mouse to look around.
- Press `Space` to jump.
- Hold `Shift` to sprint.
- Left-click to break a block.
- Right-click to place the selected block.
- Use the mouse wheel or keys `1` through `7` to select a block.
- Press `R` if you get stuck and need to return to the spawn point.
- Press `Escape` to pause and release the mouse.

## Test it

```bash
npm test
```

The automated tests cover deterministic terrain, save restoration, hashing, and voxel raycasting.

The title artwork was generated specifically for this project and is not copied from Minecraft.
