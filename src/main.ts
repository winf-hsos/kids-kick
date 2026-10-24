import * as THREE from 'three';
import './style.css';
import { Ball } from './ball/ball';
import { BroadcastCamera } from './camera/broadcastCamera';
import { PITCH } from './config';
import { Match } from './game/match';
import { loadSettings } from './ai/settings';
import { Hud } from './hud/hud';
import { Input } from './input/input';
import { createPhysics } from './physics/world';
import { CharacterLibrary } from './player/character';
import { Player } from './player/player';
import { TEAMS } from './teams';
import { SettingsPanel } from './ui/settingsPanel';
import { createSurroundings, setupSkyAndLight } from './world/environment';
import { createGoals } from './world/goal';
import { createPitch } from './world/pitch';

async function main() {
  const container = document.getElementById('app')!;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  setupSkyAndLight(scene, renderer);
  scene.add(createPitch(renderer));
  scene.add(createGoals());
  scene.add(createSurroundings(renderer));

  const physics = await createPhysics();
  const ball = new Ball(physics);
  scene.add(ball.mesh);

  const bounds = new THREE.Box2(
    new THREE.Vector2(-PITCH.length / 2 - PITCH.runoff + 0.5, -PITCH.width / 2 - PITCH.runoff + 0.5),
    new THREE.Vector2(PITCH.length / 2 + PITCH.runoff - 0.5, PITCH.width / 2 + PITCH.runoff - 0.5),
  );

  // Beide Teams im 4+1
  const library = await CharacterLibrary.load();
  const players = (
    await Promise.all(
      TEAMS.flatMap((team, ti) =>
        team.lineup.map(async (entry) => {
          const kit = entry.position === 'TW' ? team.keeperKit : team.kit;
          const character = await library.create(entry.character, kit, entry.number, renderer);
          return new Player(character, {
            team: ti as 0 | 1,
            role: entry.position,
            number: entry.number,
            bounds,
            physics,
          });
        }),
      ),
    )
  ).flat();
  for (const p of players) scene.add(p.root);

  const hud = new Hud(TEAMS);
  const match = new Match(players, ball, TEAMS, hud, loadSettings());
  let paused = false;
  const panel = new SettingsPanel(
    match.settings,
    (s) => match.setSettings(s),
    () => togglePause(),
  );
  const togglePause = () => {
    paused = !paused;
    panel.setPaused(paused);
  };

  // Markierung unter dem gesteuerten Spieler (wie bei FIFA)
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.52, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  marker.position.y = 0.015;
  marker.renderOrder = 2;
  scene.add(marker);

  const cam = new BroadcastCamera(window.innerWidth / window.innerHeight, renderer.domElement);
  const focus = new THREE.Vector3();
  const updateFocus = () => {
    focus.copy(ball.position).setY(0);
    if (match.controlled) focus.lerp(match.controlled.position, 0.35);
  };
  updateFocus();
  cam.snap(focus);

  const input = new Input();

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    cam.setAspect(window.innerWidth / window.innerHeight);
  });

  // Für Tests und Debugging im Browser erreichbar (timeScale < 1 = Zeitlupe)
  const debug = { match, ball, players, cam, scene, renderer, timeScale: 1 };
  (window as unknown as { kidsKick: object }).kidsKick = debug;

  const timer = new THREE.Timer();
  timer.connect(document);
  renderer.setAnimationLoop((time) => {
    timer.update(time);
    const state = input.read();
    if (state.switchCamera) cam.toggleMode();
    if (state.pause) togglePause();
    const dt = paused ? 0 : Math.min(timer.getDelta(), 1 / 20) * debug.timeScale;

    if (dt > 0) {
      match.update(dt, state);
      physics.step(dt, (h) => {
        ball.preStep(h);
        match.preStep();
      });
      ball.sync();
      match.postStep();
      hud.update(dt);
    }

    marker.visible = match.controlled !== null;
    if (match.controlled) marker.position.set(match.controlled.position.x, 0.015, match.controlled.position.z);
    updateFocus();
    cam.update(focus, dt);

    renderer.render(scene, cam.camera);
  });

  document.getElementById('loading')!.classList.add('done');
}

main().catch((err) => {
  console.error(err);
  document.getElementById('loading')!.textContent = `Fehler beim Laden: ${err.message ?? err}`;
});
