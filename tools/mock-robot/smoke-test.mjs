// Protocol smoke test. Run the mock (or a real robot), then:
//   npm run smoke                      (mock on localhost:8081)
//   ROBOT=192.168.1.50:81 npm run smoke  (real robot)
// Exercises the same messages the app sends. Uses Node's built-in WebSocket.
const target = process.env.ROBOT ?? 'localhost:8081';
const ws = new WebSocket(`ws://${target}`);
let nextId = 1;
const waiters = new Map();
const events = [];
let lastStatus = null;

ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data));
  if (m.type === 'ack' && waiters.has(m.id)) {
    waiters.get(m.id)(m);
    waiters.delete(m.id);
  } else if (m.type === 'status') lastStatus = m;
  else events.push(m);
};

const req = (msg) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    const t = setTimeout(() => reject(new Error(`timeout: ${msg.type}`)), 4000);
    waiters.set(id, (m) => {
      clearTimeout(t);
      resolve(m);
    });
    ws.send(JSON.stringify({ ...msg, id }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ping = setInterval(() => ws.readyState === 1 && ws.send('{"type":"ping"}'), 1000);
let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
  if (!cond) failures++;
};

ws.onopen = async () => {
  try {
    const hello = await req({ type: 'hello', app: 'smoke', proto: 1 });
    check('hello ack', hello.ok);
    await sleep(100);
    const h = events.find((m) => m.type === 'hello');
    check('hello reply', h?.proto === 1, `${h?.robot_id} fw ${h?.fw}`);

    const profile = {
      profile_id: 'trial1',
      version: 2,
      joints: [
        { name: 'head', channel: 0, min_angle: 30, max_angle: 150, home_angle: 90, max_speed_dps: 200, enabled: true },
        { name: 'right_shoulder', channel: 1, min_angle: 20, max_angle: 160, home_angle: 90, max_speed_dps: 200, enabled: true },
        { name: 'right_elbow', channel: 2, min_angle: 20, max_angle: 160, home_angle: 90, max_speed_dps: 200, enabled: true },
      ],
    };
    const put = (path, c) => req({ type: 'put_file', path, content: JSON.stringify(c) });
    check('upload profile', (await put('/config/mech_profile.json', profile)).ok);
    const friendly = { mode_id: 'friendly', version: 1, name: 'Friendly', limits: { max_speed_pct: 60, max_accel_pct: 50 }, allowed_skills: ['nod'] };
    check('upload mode', (await put('/modes/friendly.json', friendly)).ok);
    check('set_mode', (await req({ type: 'set_mode', mode_id: 'friendly' })).ok);
    const missing = await req({ type: 'set_mode', mode_id: 'nope' });
    check('unknown mode rejected', missing.ok === false, missing.error);

    const nod = { skill_id: 'nod', version: 1, steps: [{ joint: 'head', target_angle: 70, duration_ms: 400 }, { joint: 'head', target_angle: 90, duration_ms: 400 }] };
    check('upload skill', (await put('/skills/nod.json', nod)).ok);
    const bad = await put('/../secret.json', {});
    check('bad path rejected', bad.ok === false, bad.error);
    check('upload skill not in mode', (await put('/skills/wave.json', { ...nod, skill_id: 'wave' })).ok);
    const notAllowed = await req({ type: 'play_saved', skill_id: 'wave' });
    check('saved skill not in mode rejected', notAllowed.ok === false, notAllowed.error);
    check('inline play (editor)', (await req({ type: 'play', skill: { ...nod, skill_id: 'wave' } })).ok);
    check('stop', (await req({ type: 'stop' })).ok);

    check('play_saved', (await req({ type: 'play_saved', skill_id: 'nod' })).ok);
    await sleep(150);
    check('status playing', lastStatus?.state === 'playing');
    await sleep(1500);
    check('done event', events.some((m) => m.type === 'done' && m.skill_id === 'nod'));

    check('set_joint', (await req({ type: 'set_joint', joint: 'head', angle: 200 })).ok);
    await sleep(1500);
    await req({ type: 'get_status' });
    await sleep(100);
    check('set_joint clamped to max 150', lastStatus?.angles?.head === 150, `head=${lastStatus?.angles?.head}`);

    check('estop', (await req({ type: 'estop' })).ok);
    await sleep(100);
    check('status estop', lastStatus?.state === 'estop');
    const blocked = await req({ type: 'play_saved', skill_id: 'nod' });
    check('play blocked during estop', blocked.ok === false, blocked.error);
    check('estop_release', (await req({ type: 'estop_release' })).ok);

    check('set_eyes', (await req({ type: 'set_eyes', eyes: 'sleepy' })).ok);
    await req({ type: 'get_status' });
    await sleep(100);
    check('status shows eyes', lastStatus?.eyes === 'sleepy', `eyes=${lastStatus?.eyes}`);
    check('status shows movement link', lastStatus?.movement_ok !== false, `movement_ok=${lastStatus?.movement_ok}`);

    const shortPw = await req({ type: 'set_wifi', ssid: 'Home', pass: '123' });
    check('set_wifi rejects short password', shortPw.ok === false, shortPw.error);
    check('set_wifi', (await req({ type: 'set_wifi', ssid: 'NewHome', pass: 'longenough' })).ok);
    const w = await req({ type: 'get_wifi' });
    check('get_wifi', w.ssid === 'NewHome', `ssid=${w.ssid}`);

    const files = await req({ type: 'list_files' });
    check('list_files', files.files?.some((f) => f.path === '/skills/nod.json'), `${files.files?.length} files`);
  } catch (e) {
    console.log(`FAIL  ${e.message}`);
    failures++;
  }
  clearInterval(ping);
  ws.close();
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
};
ws.onerror = () => {
  console.log(`cannot connect to ws://${target}`);
  process.exit(1);
};
