import {
  BLOCKS,
  PLACEABLE_BLOCKS,
  VoxelWorld,
  WORLD_RADIUS,
  raycast,
  seededHash,
} from "./world.js";

const STORAGE_KEY = "jscraft-world-v1";
const LEGACY_STORAGE_KEY = "blockbound-world-v1";
const PLAYER_HEIGHT = 1.76;
const PLAYER_RADIUS = 0.29;
const CAMERA_HEIGHT = 1.62;
const MAX_REACH = 7;

const canvas = document.querySelector("#game");
const titleScreen = document.querySelector("#title-screen");
const pauseScreen = document.querySelector("#pause-screen");
const unsupportedScreen = document.querySelector("#unsupported");
const hud = document.querySelector("#hud");
const hotbar = document.querySelector("#hotbar");
const selectedName = document.querySelector("#selected-name");
const targetLabel = document.querySelector("#target-label");
const positionLabel = document.querySelector("#position-label");
const dayLabel = document.querySelector("#day-label");
const timeLabel = document.querySelector("#time-label");
const worldSummary = document.querySelector("#world-summary");
const toastElement = document.querySelector("#toast");
const saveIndicator = document.querySelector("#save-indicator");
const playButton = document.querySelector("#play-button");
const newWorldButton = document.querySelector("#new-world-button");
const continueButton = document.querySelector("#continue-button");
const saveQuitButton = document.querySelector("#save-quit-button");

const isTouchDevice = window.matchMedia("(pointer: coarse)").matches;
const keys = new Set();
let audioContext;
let toastTimer;
let saveTimer;
let lastInteraction = 0;
let currentTarget = null;
let worldTime = 0;

function loadSave() {
  try {
    const savedWorld = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    const parsed = JSON.parse(savedWorld);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

const existingSave = loadSave();
let hasWorldProgress = Boolean(existingSave);
let world = new VoxelWorld(existingSave?.seed ?? 1847, existingSave?.changes ?? []);
const spawn = world.findSpawn();
const player = {
  x: Number.isFinite(existingSave?.player?.x) ? existingSave.player.x : spawn.x,
  y: Number.isFinite(existingSave?.player?.y) ? existingSave.player.y : spawn.y,
  z: Number.isFinite(existingSave?.player?.z) ? existingSave.player.z : spawn.z,
  velocity: { x: 0, y: 0, z: 0 },
  yaw: Number.isFinite(existingSave?.player?.yaw) ? existingSave.player.yaw : Math.PI * 0.15,
  pitch: Number.isFinite(existingSave?.player?.pitch) ? existingSave.player.pitch : -0.1,
  grounded: false,
  bob: 0,
};

const game = {
  active: false,
  paused: false,
  selected: Math.max(0, Math.min(PLACEABLE_BLOCKS.length - 1, existingSave?.selected ?? 0)),
};

const FACE_DEFINITIONS = [
  { normal: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], shade: 0.86 },
  { normal: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], shade: 0.74 },
  { normal: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.08 },
  { normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.56 },
  { normal: [0, 0, 1], corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], shade: 0.93 },
  { normal: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], shade: 0.8 },
];
const QUAD_INDICES = [0, 1, 2, 0, 2, 3];

const VERTEX_SHADER = `#version 300 es
  precision highp float;
  layout(location = 0) in vec3 aPosition;
  layout(location = 1) in vec3 aColor;
  uniform mat4 uProjection;
  uniform mat4 uView;
  out vec3 vColor;
  out float vDistance;
  void main() {
    vec4 viewPosition = uView * vec4(aPosition, 1.0);
    gl_Position = uProjection * viewPosition;
    vColor = aColor;
    vDistance = length(viewPosition.xyz);
  }
`;

const FRAGMENT_SHADER = `#version 300 es
  precision highp float;
  in vec3 vColor;
  in float vDistance;
  uniform vec3 uFogColor;
  out vec4 outColor;
  void main() {
    float fog = smoothstep(27.0, 54.0, vDistance);
    vec3 color = mix(vColor, uFogColor, fog);
    color = pow(color, vec3(0.92));
    outColor = vec4(color, 1.0);
  }
`;

class VoxelRenderer {
  constructor(targetCanvas) {
    this.canvas = targetCanvas;
    this.gl = targetCanvas.getContext("webgl2", {
      alpha: false,
      antialias: true,
      powerPreference: "high-performance",
    });
    if (!this.gl) throw new Error("WebGL 2 is unavailable");

    this.program = this.createProgram(VERTEX_SHADER, FRAGMENT_SHADER);
    this.vertexBuffer = this.gl.createBuffer();
    this.selectionBuffer = this.gl.createBuffer();
    this.vertexCount = 0;
    this.selectionCount = 0;
    this.projectionLocation = this.gl.getUniformLocation(this.program, "uProjection");
    this.viewLocation = this.gl.getUniformLocation(this.program, "uView");
    this.fogLocation = this.gl.getUniformLocation(this.program, "uFogColor");

    this.gl.enable(this.gl.DEPTH_TEST);
    this.gl.enable(this.gl.CULL_FACE);
    this.gl.cullFace(this.gl.BACK);
    this.gl.clearColor(0.43, 0.7, 0.86, 1);
  }

  createShader(type, source) {
    const shader = this.gl.createShader(type);
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const message = this.gl.getShaderInfoLog(shader);
      this.gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  createProgram(vertexSource, fragmentSource) {
    const vertex = this.createShader(this.gl.VERTEX_SHADER, vertexSource);
    const fragment = this.createShader(this.gl.FRAGMENT_SHADER, fragmentSource);
    const program = this.gl.createProgram();
    this.gl.attachShader(program, vertex);
    this.gl.attachShader(program, fragment);
    this.gl.linkProgram(program);
    this.gl.deleteShader(vertex);
    this.gl.deleteShader(fragment);
    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      throw new Error(this.gl.getProgramInfoLog(program));
    }
    return program;
  }

  shouldDrawFace(type, neighborType) {
    if (!neighborType) return true;
    if (type === "water") return false;
    return neighborType === "water";
  }

  buildMesh(voxelWorld) {
    const vertices = [];

    for (const [key, type] of voxelWorld.blocks) {
      const [x, y, z] = key.split(",").map(Number);
      const material = BLOCKS[type];

      for (let faceIndex = 0; faceIndex < FACE_DEFINITIONS.length; faceIndex += 1) {
        const face = FACE_DEFINITIONS[faceIndex];
        if (y === 0 && face.normal[1] === -1) continue;
        const neighborType = voxelWorld.get(
          x + face.normal[0],
          y + face.normal[1],
          z + face.normal[2],
        );
        if (!this.shouldDrawFace(type, neighborType)) continue;

        const baseColor = face.normal[1] > 0
          ? material.top
          : face.normal[1] < 0
            ? material.bottom
            : material.side;
        const variation = (seededHash(x * 7 + faceIndex, z * 11 + y, voxelWorld.seed) - 0.5) * 0.09;
        const color = baseColor.map((channel) => Math.max(0, Math.min(1, channel * face.shade + variation)));

        for (const cornerIndex of QUAD_INDICES) {
          const corner = face.corners[cornerIndex];
          const waterDrop = type === "water" && corner[1] === 1 ? 0.16 : 0;
          vertices.push(
            x + corner[0],
            y + corner[1] - waterDrop,
            z + corner[2],
            color[0],
            color[1],
            color[2],
          );
        }
      }
    }

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(vertices), this.gl.STATIC_DRAW);
    this.vertexCount = vertices.length / 6;
  }

  updateSelection(target) {
    if (!target) {
      this.selectionCount = 0;
      return;
    }

    const { x, y, z } = target.block;
    const inset = -0.003;
    const low = [x + inset, y + inset, z + inset];
    const high = [x + 1 - inset, y + 1 - inset, z + 1 - inset];
    const corners = [
      [low[0], low[1], low[2]], [high[0], low[1], low[2]],
      [high[0], low[1], high[2]], [low[0], low[1], high[2]],
      [low[0], high[1], low[2]], [high[0], high[1], low[2]],
      [high[0], high[1], high[2]], [low[0], high[1], high[2]],
    ];
    const edges = [
      0, 1, 1, 2, 2, 3, 3, 0,
      4, 5, 5, 6, 6, 7, 7, 4,
      0, 4, 1, 5, 2, 6, 3, 7,
    ];
    const vertices = [];
    for (const index of edges) vertices.push(...corners[index], 1, 1, 0.78);

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.selectionBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(vertices), this.gl.DYNAMIC_DRAW);
    this.selectionCount = vertices.length / 6;
  }

  bindBuffer(buffer) {
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
    this.gl.enableVertexAttribArray(0);
    this.gl.vertexAttribPointer(0, 3, this.gl.FLOAT, false, 24, 0);
    this.gl.enableVertexAttribArray(1);
    this.gl.vertexAttribPointer(1, 3, this.gl.FLOAT, false, 24, 12);
  }

  resize() {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
    const width = Math.floor(this.canvas.clientWidth * pixelRatio);
    const height = Math.floor(this.canvas.clientHeight * pixelRatio);
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.gl.viewport(0, 0, width, height);
  }

  render(camera, target, daylight) {
    this.resize();
    const sky = [
      0.3 + daylight * 0.16,
      0.46 + daylight * 0.26,
      0.62 + daylight * 0.26,
    ];
    this.gl.clearColor(sky[0], sky[1], sky[2], 1);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
    this.gl.useProgram(this.program);

    const projection = perspectiveMatrix(
      Math.PI / 2.7,
      this.canvas.width / Math.max(1, this.canvas.height),
      0.06,
      90,
    );
    const view = viewMatrix(camera);
    this.gl.uniformMatrix4fv(this.projectionLocation, false, projection);
    this.gl.uniformMatrix4fv(this.viewLocation, false, view);
    this.gl.uniform3fv(this.fogLocation, sky);

    this.bindBuffer(this.vertexBuffer);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, this.vertexCount);

    this.updateSelection(target);
    if (this.selectionCount) {
      this.gl.disable(this.gl.CULL_FACE);
      this.bindBuffer(this.selectionBuffer);
      this.gl.drawArrays(this.gl.LINES, 0, this.selectionCount);
      this.gl.enable(this.gl.CULL_FACE);
    }
  }
}

function perspectiveMatrix(fieldOfView, aspect, near, far) {
  const scale = 1 / Math.tan(fieldOfView / 2);
  const range = 1 / (near - far);
  return new Float32Array([
    scale / aspect, 0, 0, 0,
    0, scale, 0, 0,
    0, 0, (near + far) * range, -1,
    0, 0, near * far * 2 * range, 0,
  ]);
}

function viewMatrix(camera) {
  const cosinePitch = Math.cos(camera.pitch);
  const forward = [
    Math.sin(camera.yaw) * cosinePitch,
    Math.sin(camera.pitch),
    -Math.cos(camera.yaw) * cosinePitch,
  ];
  const right = [Math.cos(camera.yaw), 0, Math.sin(camera.yaw)];
  const up = [
    -Math.sin(camera.yaw) * Math.sin(camera.pitch),
    cosinePitch,
    Math.cos(camera.yaw) * Math.sin(camera.pitch),
  ];
  const position = [camera.x, camera.y, camera.z];
  const dot = (left, rightValue) => left[0] * rightValue[0] + left[1] * rightValue[1] + left[2] * rightValue[2];

  return new Float32Array([
    right[0], up[0], -forward[0], 0,
    right[1], up[1], -forward[1], 0,
    right[2], up[2], -forward[2], 0,
    -dot(right, position), -dot(up, position), dot(forward, position), 1,
  ]);
}

function lookDirection() {
  const cosinePitch = Math.cos(player.pitch);
  return {
    x: Math.sin(player.yaw) * cosinePitch,
    y: Math.sin(player.pitch),
    z: -Math.cos(player.yaw) * cosinePitch,
  };
}

function cameraPosition() {
  const moving = Math.hypot(player.velocity.x, player.velocity.z) > 0.4 && player.grounded;
  const bobAmount = moving ? Math.sin(player.bob) * 0.035 : 0;
  return {
    x: player.x,
    y: player.y + CAMERA_HEIGHT + bobAmount,
    z: player.z,
    yaw: player.yaw,
    pitch: player.pitch,
  };
}

let renderer;
try {
  renderer = new VoxelRenderer(canvas);
  renderer.buildMesh(world);
} catch (error) {
  console.error(error);
  unsupportedScreen.classList.remove("hidden");
  titleScreen.classList.add("hidden");
}

function buildHotbar() {
  hotbar.replaceChildren();
  PLACEABLE_BLOCKS.forEach((type, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "slot";
    button.setAttribute("aria-label", `Select ${BLOCKS[type].name}`);
    button.innerHTML = `<span class="slot-number">${index + 1}</span><span class="block-swatch"></span>`;
    button.querySelector(".block-swatch").style.background = BLOCKS[type].swatch;
    button.addEventListener("click", () => selectBlock(index));
    hotbar.append(button);
  });
  updateHotbar();
}

function selectBlock(index) {
  game.selected = (index + PLACEABLE_BLOCKS.length) % PLACEABLE_BLOCKS.length;
  updateHotbar();
  playTone(260 + game.selected * 24, 0.025, 0.025);
}

function updateHotbar() {
  [...hotbar.children].forEach((slot, index) => {
    slot.classList.toggle("active", index === game.selected);
    slot.setAttribute("aria-pressed", String(index === game.selected));
  });
  selectedName.textContent = BLOCKS[PLACEABLE_BLOCKS[game.selected]].name;
}

function updateWorldSummary() {
  const edited = world.changes.size > 0;
  worldSummary.textContent = `Seed ${world.seed}${edited ? ` · ${world.changes.size} edits saved` : " · untouched frontier"}`;
  playButton.querySelector("strong").textContent = hasWorldProgress || edited ? "Continue world" : "Enter world";
}

function showToast(message) {
  toastElement.textContent = message;
  toastElement.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastElement.classList.remove("visible"), 1800);
}

function saveWorld(showFeedback = true) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      seed: world.seed,
      changes: world.serializeChanges(),
      selected: game.selected,
      player: {
        x: player.x,
        y: player.y,
        z: player.z,
        yaw: player.yaw,
        pitch: player.pitch,
      },
    }));
    hasWorldProgress = true;
    updateWorldSummary();
    if (showFeedback) {
      saveIndicator.classList.add("visible");
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => saveIndicator.classList.remove("visible"), 1400);
    }
  } catch {
    showToast("Could not save this world");
  }
}

function startGame() {
  if (!renderer) return;
  game.active = true;
  game.paused = false;
  titleScreen.classList.add("hidden");
  pauseScreen.classList.add("hidden");
  hud.classList.remove("hidden");
  ensureAudio();
  if (!isTouchDevice) canvas.requestPointerLock();
  canvas.focus();
}

function pauseGame() {
  if (!game.active || isTouchDevice) return;
  game.paused = true;
  keys.clear();
  pauseScreen.classList.remove("hidden");
  saveWorld(false);
}

function quitToTitle() {
  saveWorld(false);
  game.active = false;
  game.paused = false;
  keys.clear();
  if (document.pointerLockElement) document.exitPointerLock();
  pauseScreen.classList.add("hidden");
  hud.classList.add("hidden");
  titleScreen.classList.remove("hidden");
  updateWorldSummary();
}

function resetWorld() {
  if (world.changes.size && !window.confirm("Leave this world behind and generate a new one?")) return;
  const seed = Math.floor(Date.now() % 900000) + 100000;
  world = new VoxelWorld(seed);
  const newSpawn = world.findSpawn();
  Object.assign(player, newSpawn, {
    velocity: { x: 0, y: 0, z: 0 },
    yaw: Math.PI * 0.15,
    pitch: -0.1,
    grounded: false,
    bob: 0,
  });
  game.selected = 0;
  localStorage.removeItem(STORAGE_KEY);
  hasWorldProgress = false;
  renderer.buildMesh(world);
  updateHotbar();
  updateWorldSummary();
  startGame();
  showToast(`New world · Seed ${seed}`);
}

function ensureAudio() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioContext = new AudioContextClass();
  }
  if (audioContext?.state === "suspended") audioContext.resume();
}

function playTone(frequency, duration = 0.05, volume = 0.04, wave = "square") {
  if (!audioContext) return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
  gain.gain.setValueAtTime(volume, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration);
}

function playerIntersectsBlock(x, y, z) {
  return player.x + PLAYER_RADIUS > x
    && player.x - PLAYER_RADIUS < x + 1
    && player.y + PLAYER_HEIGHT > y
    && player.y < y + 1
    && player.z + PLAYER_RADIUS > z
    && player.z - PLAYER_RADIUS < z + 1;
}

function interact(action) {
  const now = performance.now();
  if (!game.active || game.paused || now - lastInteraction < 120) return;
  lastInteraction = now;
  const target = raycast(world, cameraPosition(), lookDirection(), MAX_REACH);
  if (!target) return;

  if (action === "break") {
    if (target.block.y <= 0) {
      showToast("The deepstone will not budge");
      playTone(90, 0.08, 0.035);
      return;
    }
    world.set(target.block.x, target.block.y, target.block.z, null);
    renderer.buildMesh(world);
    playTone(112, 0.065, 0.045);
    saveWorld();
    return;
  }

  const placement = {
    x: target.block.x + target.normal.x,
    y: target.block.y + target.normal.y,
    z: target.block.z + target.normal.z,
  };
  if (placement.y < 0 || placement.y > 24 || Math.abs(placement.x) > WORLD_RADIUS + 4 || Math.abs(placement.z) > WORLD_RADIUS + 4) {
    showToast("That spot is beyond the frontier");
    return;
  }
  if (playerIntersectsBlock(placement.x, placement.y, placement.z)) {
    showToast("You are standing there");
    return;
  }

  world.set(placement.x, placement.y, placement.z, PLACEABLE_BLOCKS[game.selected]);
  renderer.buildMesh(world);
  playTone(178, 0.055, 0.04);
  saveWorld();
}

function collides() {
  if (player.y < 0) return true;
  if (Math.abs(player.x) > WORLD_RADIUS + 1 || Math.abs(player.z) > WORLD_RADIUS + 1) return true;
  const minimumX = Math.floor(player.x - PLAYER_RADIUS);
  const maximumX = Math.floor(player.x + PLAYER_RADIUS - 0.0001);
  const minimumY = Math.floor(player.y);
  const maximumY = Math.floor(player.y + PLAYER_HEIGHT - 0.0001);
  const minimumZ = Math.floor(player.z - PLAYER_RADIUS);
  const maximumZ = Math.floor(player.z + PLAYER_RADIUS - 0.0001);

  for (let x = minimumX; x <= maximumX; x += 1) {
    for (let y = minimumY; y <= maximumY; y += 1) {
      for (let z = minimumZ; z <= maximumZ; z += 1) {
        if (world.isSolid(x, y, z)) return true;
      }
    }
  }
  return false;
}

function moveOnAxis(axis, amount) {
  const steps = Math.max(1, Math.ceil(Math.abs(amount) / 0.08));
  const increment = amount / steps;
  for (let step = 0; step < steps; step += 1) {
    player[axis] += increment;
    if (!collides()) continue;
    player[axis] -= increment;
    player.velocity[axis] = 0;
    if (axis === "y" && increment < 0) player.grounded = true;
    return false;
  }
  return true;
}

function respawn(showFeedback = true) {
  const newSpawn = world.findSpawn();
  player.x = newSpawn.x;
  player.y = newSpawn.y;
  player.z = newSpawn.z;
  player.velocity = { x: 0, y: 0, z: 0 };
  if (showFeedback) showToast("Returned to the trailhead");
}

function updatePlayer(delta) {
  const forwardInput = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
  const rightInput = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
  const inputLength = Math.hypot(forwardInput, rightInput) || 1;
  const forwardX = Math.sin(player.yaw);
  const forwardZ = -Math.cos(player.yaw);
  const rightX = Math.cos(player.yaw);
  const rightZ = Math.sin(player.yaw);
  const speed = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 7.2 : 4.5;
  const targetX = (forwardX * forwardInput + rightX * rightInput) / inputLength * speed;
  const targetZ = (forwardZ * forwardInput + rightZ * rightInput) / inputLength * speed;
  const response = 1 - Math.exp(-delta * (player.grounded ? 14 : 5));
  player.velocity.x += (targetX - player.velocity.x) * response;
  player.velocity.z += (targetZ - player.velocity.z) * response;

  if (keys.has("Space") && player.grounded) {
    player.velocity.y = 7.25;
    player.grounded = false;
    playTone(205, 0.04, 0.025);
  }

  player.velocity.y = Math.max(-18, player.velocity.y - 20 * delta);
  player.grounded = false;
  moveOnAxis("x", player.velocity.x * delta);
  moveOnAxis("z", player.velocity.z * delta);
  moveOnAxis("y", player.velocity.y * delta);

  const horizontalSpeed = Math.hypot(player.velocity.x, player.velocity.z);
  if (horizontalSpeed > 0.4 && player.grounded) player.bob += delta * horizontalSpeed * 2.5;
  if (player.y < -3) respawn();
}

function updateHud() {
  positionLabel.textContent = `${Math.floor(player.x)} / ${Math.floor(player.y)} / ${Math.floor(player.z)}`;
  const totalMinutes = Math.floor(8 * 60 + worldTime * 3);
  const day = Math.floor(totalMinutes / 1440) + 1;
  const minuteOfDay = totalMinutes % 1440;
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  dayLabel.textContent = `Day ${day}`;
  timeLabel.textContent = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

  if (currentTarget) {
    targetLabel.textContent = BLOCKS[currentTarget.type].name;
    targetLabel.classList.add("visible");
  } else {
    targetLabel.classList.remove("visible");
  }
}

function daylightLevel() {
  const minute = (8 * 60 + worldTime * 3) % 1440;
  const angle = minute / 1440 * Math.PI * 2 - Math.PI / 2;
  return Math.max(0.18, Math.min(1, Math.sin(angle) * 0.55 + 0.62));
}

let lastFrame = performance.now();
function frame(now) {
  const delta = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  if (game.active && !game.paused) {
    worldTime += delta;
    updatePlayer(delta);
  }

  if (renderer) {
    const camera = cameraPosition();
    currentTarget = raycast(world, camera, lookDirection(), MAX_REACH);
    renderer.render(camera, game.active ? currentTarget : null, daylightLevel());
  }
  if (game.active) updateHud();
  requestAnimationFrame(frame);
}

playButton.addEventListener("click", startGame);
newWorldButton.addEventListener("click", resetWorld);
continueButton.addEventListener("click", startGame);
saveQuitButton.addEventListener("click", quitToTitle);

document.addEventListener("pointerlockchange", () => {
  if (!game.active || isTouchDevice) return;
  if (document.pointerLockElement === canvas) {
    game.paused = false;
    pauseScreen.classList.add("hidden");
  } else {
    pauseGame();
  }
});

document.addEventListener("mousemove", (event) => {
  if (document.pointerLockElement !== canvas || game.paused) return;
  player.yaw += event.movementX * 0.0022;
  player.pitch = Math.max(-1.52, Math.min(1.52, player.pitch - event.movementY * 0.0022));
});

document.addEventListener("keydown", (event) => {
  if (!game.active || game.paused) return;
  if (/^Digit[1-7]$/.test(event.code)) selectBlock(Number(event.code.at(-1)) - 1);
  if (event.code === "KeyR") respawn();
  keys.add(event.code);
  if (["Space", "ArrowUp", "ArrowDown"].includes(event.code)) event.preventDefault();
});

document.addEventListener("keyup", (event) => keys.delete(event.code));
window.addEventListener("blur", () => keys.clear());

canvas.addEventListener("mousedown", (event) => {
  if (!game.active || game.paused) return;
  if (!isTouchDevice && document.pointerLockElement !== canvas) {
    canvas.requestPointerLock();
    return;
  }
  if (event.button === 0) interact("break");
  if (event.button === 2) interact("place");
});

canvas.addEventListener("contextmenu", (event) => event.preventDefault());
canvas.addEventListener("wheel", (event) => {
  if (!game.active || game.paused) return;
  selectBlock(game.selected + (event.deltaY > 0 ? 1 : -1));
  event.preventDefault();
}, { passive: false });

let touchLook = null;
canvas.addEventListener("pointerdown", (event) => {
  if (!isTouchDevice || !game.active) return;
  touchLook = { id: event.pointerId, x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!touchLook || event.pointerId !== touchLook.id) return;
  const deltaX = event.clientX - touchLook.x;
  const deltaY = event.clientY - touchLook.y;
  player.yaw += deltaX * 0.006;
  player.pitch = Math.max(-1.52, Math.min(1.52, player.pitch - deltaY * 0.006));
  touchLook.x = event.clientX;
  touchLook.y = event.clientY;
});

canvas.addEventListener("pointerup", () => {
  touchLook = null;
});

document.querySelectorAll("[data-key]").forEach((button) => {
  const key = button.dataset.key;
  const press = (event) => {
    event.preventDefault();
    keys.add(key);
  };
  const release = (event) => {
    event.preventDefault();
    keys.delete(key);
  };
  button.addEventListener("pointerdown", press);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("pointerleave", release);
});

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    interact(button.dataset.action);
  });
});

window.addEventListener("beforeunload", () => {
  if (game.active) saveWorld(false);
});

buildHotbar();
if (collides()) respawn(false);
updateWorldSummary();
requestAnimationFrame(frame);
