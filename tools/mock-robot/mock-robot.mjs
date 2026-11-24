#!/usr/bin/env node
// Mock MechaKin robot: speaks the same WebSocket protocol as the ESP32 firmware
// (kb/docs/app-robot-protocol.md) so the app can be tested without hardware.
//
//   cd tools/mock-robot && npm install && npm start
//   then in the app connect to <this computer's LAN IP>, port 8081
//
// Files the app uploads are stored in ./robot-storage/ (like the robot's flash).
import { WebSocketServer } from 'ws';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const PORT = Number(process.env.PORT ?? 8081); // real robot uses 81; ports <1024 need root on Linux
const PROTO = 1;
const FW = 'mock-0.1';
const TICK_MS = 20;
const HEARTBEAT_LIMIT_MS = 3000;
const HARD_MIN = 0;
const HARD_MAX = 180;
const HARD_MAX_DPS = 400;
const STORAGE = join(dirname(fileURLToPath(import.meta.url)), 'robot-storage');
mkdirSync(STORAGE, { recursive: true });

// ---- profile (same defaults as firmware) ----
let joints = [
  { name: 'head', channel: 0, min_angle: 30, max_angle: 150, home_angle: 90, max_speed_dps: 200, enabled: true },
  { name: 'right_shoulder', channel: 1, min_angle: 20, max_angle: 160, home_angle: 90, max_speed_dps: 200, enabled: true },
  { name: 'right_elbow', channel: 2, min_angle: 20, max_angle: 160, home_angle: 90, max_speed_dps: 200, enabled: true },
];
let robotId = 'robot-001';
let mode = { mode_id: 'friendly', limits: { max_speed_pct: 60 }, allowed_skills: null, eyes: 'happy' };
let eyesOverride = '';
let wifi = { ssid: 'HomeWiFi', pass: '' };
// MOVEMENT_DOWN=1 npm start  -> pretend the movement ESP32 isn't answering
const movementDown = process.env.MOVEMENT_DOWN === '1';

const state = {
  run: 'idle', // idle | playing | estop
  angle: {}, // current angle per joint
  target: {}, // target per joint (null = limp)
  speed: {}, // dps for current move per joint
  skill: null,
  segments: [],
  startedAt: 0,
  pass: 0,
  repeat: 1,
  passMs: 0,
};

function applyProfile(p) {
  if (!Array.isArray(p?.joints)) throw new Error('profile needs joints[]');
  joints = p.joints
    .filter((j) => j.enabled)
    .map((j) => {
      const min = Math.max(HARD_MIN, Math.min(j.min_angle, j.max_angle));
      const max = Math.min(HARD_MAX, Math.max(j.min_angle, j.max_angle));
      return { ...j, min_angle: min, max_angle: max, home_angle: clamp(j.home_angle, min, max), max_speed_dps: Math.min(HARD_MAX_DPS, j.max_speed_dps) };
    });
  for (const j of joints) {
    if (state.angle[j.name] === undefined) state.angle[j.name] = j.home_angle;
  }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const jointByName = (n) => joints.find((j) => j.name === n);
const maxDps = (j) => (j.max_speed_dps * clamp(mode.limits?.max_speed_pct ?? 100, 1, 100)) / 100;

function loadFromStorage() {
  try {
    applyProfile(JSON.parse(readFileSync(join(STORAGE, 'config/mech_profile.json'), 'utf8')));
    console.log('loaded profile from storage');
  } catch {
    applyProfile({ joints });
  }
  try {
    robotId = JSON.parse(readFileSync(join(STORAGE, 'training/robot_profile.json'), 'utf8')).robot_id ?? robotId;
  } catch {}
  loadMode('friendly');
}

function loadMode(id) {
  try {
    const m = JSON.parse(readFileSync(join(STORAGE, `modes/${id}.json`), 'utf8'));
    mode = { mode_id: id, limits: m.limits ?? { max_speed_pct: 60 }, allowed_skills: m.allowed_skills ?? null, eyes: m.display?.eyes ?? 'happy' };
    eyesOverride = '';
    return true;
  } catch {
    if (id === 'friendly') mode = { mode_id: 'friendly', limits: { max_speed_pct: 60 }, allowed_skills: null, eyes: 'happy' };
    return false;
  }
}

// ---- motion ----
function stopMotion(hold = true) {
  state.segments = [];
  state.skill = null;
  for (const j of joints) state.target[j.name] = hold ? state.angle[j.name] : null;
  if (state.run === 'playing') state.run = 'idle';
}

function startSkill(skill, fromStorage) {
  if (state.run === 'estop') throw new Error('E-STOP active');
  if (!Array.isArray(skill?.steps) || skill.steps.length === 0) throw new Error('skill has no steps');
  if (skill.steps.length > 64) throw new Error('too many steps');
  // The allow-list applies to saved skills; inline skills (app editor) still get all limits.
  if (fromStorage && mode.allowed_skills && !mode.allowed_skills.includes(skill.skill_id)) {
    throw new Error(`skill ${skill.skill_id} not allowed in mode ${mode.mode_id}`);
  }
  // Build the timeline exactly like the app: with_previous starts with the previous step.
  let cursor = 0;
  let prevStart = 0;
  const segs = [];
  skill.steps.forEach((s, i) => {
    const j = jointByName(s.joint);
    if (!j) throw new Error(`unknown joint ${s.joint}`);
    const dur = clamp(Math.round(s.duration_ms), 50, 10000);
    const start = i > 0 && s.with_previous ? prevStart : cursor;
    segs.push({ joint: s.joint, start, dur, to: clamp(s.target_angle, j.min_angle, j.max_angle), begun: false });
    prevStart = start;
    cursor = Math.max(cursor, start + dur);
  });
  state.segments = segs;
  state.passMs = cursor;
  state.repeat = clamp(skill.repeat ?? 1, 1, 10);
  state.pass = 0;
  state.startedAt = Date.now();
  state.skill = skill.skill_id ?? 'inline';
  state.run = 'playing';
}

function tick() {
  const now = Date.now();
  if (state.run === 'playing') {
    let t = now - state.startedAt;
    if (t >= state.passMs) {
      state.pass++;
      if (state.pass >= state.repeat) {
        const done = state.skill;
        state.segments = [];
        state.skill = null;
        state.run = 'idle';
        broadcast({ type: 'done', skill_id: done });
        broadcastStatus();
      } else {
        state.startedAt = now;
        t = 0;
        state.segments.forEach((s) => (s.begun = false));
      }
    }
    for (const s of state.segments) {
      if (!s.begun && t >= s.start) {
        s.begun = true;
        const from = state.angle[s.joint];
        state.target[s.joint] = s.to;
        state.speed[s.joint] = Math.abs(s.to - from) / (s.dur / 1000);
      }
    }
  }
  // Move every joint toward its target, never faster than its limit.
  for (const j of joints) {
    const target = state.target[j.name];
    if (target === null || target === undefined || state.run === 'estop') continue;
    const limit = maxDps(j);
    const dps = Math.min(state.speed[j.name] ?? limit, limit);
    const stepDeg = (dps * TICK_MS) / 1000;
    const cur = state.angle[j.name];
    const diff = target - cur;
    state.angle[j.name] = Math.abs(diff) <= stepDeg ? target : cur + Math.sign(diff) * stepDeg;
  }
}

// ---- files ----
const PATH_RE = /^\/(modes|skills|training|config)\/[a-z0-9_\-]{1,40}\.json$/;
function checkPath(p) {
  if (typeof p !== 'string' || !PATH_RE.test(p)) throw new Error(`bad path ${p}`);
  return join(STORAGE, p.slice(1));
}

function listFiles() {
  const out = [];
  for (const dir of ['config', 'modes', 'skills', 'training']) {
    try {
      for (const f of readdirSync(join(STORAGE, dir))) {
        out.push({ path: `/${dir}/${f}`, size: statSync(join(STORAGE, dir, f)).size });
      }
    } catch {}
  }
  return out;
}

// ---- protocol ----
const wss = new WebSocketServer({ port: PORT });
const clients = new Set();
let lastHeard = 0;

const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
const broadcast = (msg) => clients.forEach((c) => send(c, msg));
function statusMsg() {
  const angles = {};
  for (const j of joints) angles[j.name] = Math.round(state.angle[j.name]);
  return {
    type: 'status',
    state: state.run,
    mode: mode.mode_id,
    skill: state.skill,
    angles,
    estop_button: false,
    movement_ok: !movementDown,
    eyes: eyesOverride || mode.eyes,
  };
}
const broadcastStatus = () => broadcast(statusMsg());

const MOVEMENT_TYPES = new Set(['estop_release', 'stop', 'set_joint', 'play', 'play_saved']);

function handle(ws, msg) {
  lastHeard = Date.now();
  const ack = (extra = {}) => msg.id !== undefined && send(ws, { type: 'ack', id: msg.id, ok: true, ...extra });
  if (movementDown && MOVEMENT_TYPES.has(msg.type)) throw new Error('movement board not answering (check UART wires TX->RX, GND)');
  switch (msg.type) {
    case 'hello':
      send(ws, { type: 'hello', robot_id: robotId, fw: FW, movement_fw: 'mock-move-0.2', wifi: wifi.ssid, proto: PROTO, joints: joints.map((j) => j.name) });
      send(ws, statusMsg());
      return ack();
    case 'ping':
    case 'get_status':
      send(ws, statusMsg());
      return ack();
    case 'estop':
      state.run = 'estop';
      stopMotion(false);
      state.run = 'estop';
      console.log('E-STOP');
      broadcastStatus();
      return ack();
    case 'estop_release':
      if (state.run !== 'estop') return ack();
      stopMotion(true);
      state.run = 'idle';
      broadcastStatus();
      return ack();
    case 'stop':
      stopMotion(true);
      broadcastStatus();
      return ack();
    case 'set_joint': {
      if (state.run === 'estop') throw new Error('E-STOP active');
      const j = jointByName(msg.joint);
      if (!j) throw new Error(`unknown joint ${msg.joint}`);
      if (state.run === 'playing') stopMotion(true);
      state.target[j.name] = clamp(Number(msg.angle), j.min_angle, j.max_angle);
      state.speed[j.name] = maxDps(j);
      return ack();
    }
    case 'play':
      startSkill(msg.skill, false);
      console.log(`play ${state.skill}`);
      broadcastStatus();
      return ack();
    case 'play_saved': {
      const skill = JSON.parse(readFileSync(checkPath(`/skills/${msg.skill_id}.json`), 'utf8'));
      startSkill(skill, true);
      console.log(`play_saved ${state.skill}`);
      broadcastStatus();
      return ack();
    }
    case 'put_file': {
      const full = checkPath(msg.path);
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      const parsed = JSON.parse(content); // must be valid JSON
      if (content.length > 16384) throw new Error('file too large');
      if (msg.path === '/config/mech_profile.json') applyProfile(parsed);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
      if (msg.path === '/training/robot_profile.json') robotId = parsed.robot_id ?? robotId;
      if (msg.path === `/modes/${mode.mode_id}.json`) loadMode(mode.mode_id);
      console.log(`saved ${msg.path} (${content.length} B)`);
      return ack();
    }
    case 'delete_file':
      rmSync(checkPath(msg.path), { force: true });
      return ack();
    case 'list_files':
      return ack({ files: listFiles() });
    case 'get_wifi':
      return ack({ ssid: wifi.ssid, connected: true, setup_mode: false, ip: '127.0.0.1' });
    case 'set_wifi': {
      const ssid = String(msg.ssid ?? '');
      const pass = String(msg.pass ?? '');
      if (!ssid || ssid.length > 32) throw new Error('Wi-Fi name must be 1-32 characters');
      if (pass.length > 63 || (pass.length > 0 && pass.length < 8)) throw new Error('password must be 8-63 characters (or empty for an open network)');
      wifi = { ssid, pass };
      console.log(`Wi-Fi saved: "${ssid}" (a real robot would restart now)`);
      return ack();
    }
    case 'set_eyes':
      eyesOverride = String(msg.eyes ?? '');
      console.log(`display eyes: ${eyesOverride}`);
      broadcastStatus();
      return ack();
    case 'set_mode':
      if (!loadMode(msg.mode_id)) throw new Error(`mode ${msg.mode_id} not on robot, upload it first`);
      console.log(`mode ${mode.mode_id}`);
      broadcastStatus();
      return ack();
    default:
      throw new Error(`unknown type ${msg.type}`);
  }
}

wss.on('connection', (ws, req) => {
  clients.add(ws);
  lastHeard = Date.now();
  console.log(`app connected from ${req.socket.remoteAddress}`);
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return send(ws, { type: 'error', error: 'bad json' });
    }
    try {
      handle(ws, msg);
    } catch (e) {
      if (msg.id !== undefined) send(ws, { type: 'ack', id: msg.id, ok: false, error: e.message });
      else send(ws, { type: 'error', error: e.message });
    }
  });
  ws.on('close', () => {
    clients.delete(ws);
    console.log('app disconnected');
    if (clients.size === 0 && state.run === 'playing') {
      stopMotion(true); // safe behaviour on connection loss
    }
  });
});

setInterval(() => {
  tick();
  // Connection-loss safety: stop if the app goes quiet while playing.
  if (clients.size > 0 && state.run === 'playing' && Date.now() - lastHeard > HEARTBEAT_LIMIT_MS) {
    console.log('heartbeat lost, stopping');
    stopMotion(true);
    broadcastStatus();
  }
}, TICK_MS);
setInterval(() => state.run === 'playing' && broadcastStatus(), 200);

loadFromStorage();
const ips = Object.values(os.networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => i.address);
console.log(`Mock robot ${robotId} listening on port ${PORT}`);
console.log(`Connect the app to: ${ips.join(' or ') || 'this computer'} port ${PORT}`);
