import * as THREE from 'three';
import './style.css';
import { PITCH } from './config';
import { BroadcastCamera } from './camera/broadcastCamera';
import { Input } from './input/input';
import { CharacterLibrary } from './player/character';
import { Player } from './player/player';
import { TEAMS, kickoffSpot } from './teams';
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

  const bounds = new THREE.Box2(
    new THREE.Vector2(-PITCH.length / 2 - PITCH.runoff + 0.5, -PITCH.width / 2 - PITCH.runoff + 0.5),
    new THREE.Vector2(PITCH.length / 2 + PITCH.runoff - 0.5, PITCH.width / 2 + PITCH.runoff - 0.5),
  );

  // Beide Teams im 4+1 aufstellen
  const library = await CharacterLibrary.load();
  const players: Player[] = [];
  let controlled: Player | undefined;
  await Promise.all(
    TEAMS.flatMap((team, ti) => {
      const side = ti === 0 ? -1 : 1;
      return team.lineup.map(async (entry) => {
        const kit = entry.position === 'TW' ? team.keeperKit : team.kit;
        const character = await library.create(entry.character, kit, entry.number, renderer);
        const player = new Player(character, { bounds, yaw: side < 0 ? Math.PI / 2 : -Math.PI / 2 });
        const spot = kickoffSpot(entry.position, side);
        player.position.set(spot.x, 0, spot.z);
        scene.add(player.root);
        players.push(player);
        if (ti === 0 && entry.position === 'ST') controlled = player;
      });
    }),
  );
  if (!controlled) throw new Error('Kein steuerbarer Spieler in der Aufstellung');
  const me = controlled;

  // Markierung unter dem gesteuerten Spieler (wie bei FIFA)
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.52, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  marker.position.y = 0.015;
  marker.renderOrder = 2;
  scene.add(marker);

  const cam = new BroadcastCamera(window.innerWidth / window.innerHeight, renderer.domElement);
  cam.snap(me.position);

  const input = new Input();

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    cam.setAspect(window.innerWidth / window.innerHeight);
  });

  // Für Tests und Debugging im Browser erreichbar
  (window as unknown as { kidsKick: object }).kidsKick = { player: me, players, cam, scene, renderer };

  const timer = new THREE.Timer();
  timer.connect(document);
  renderer.setAnimationLoop((time) => {
    timer.update(time);
    const dt = Math.min(timer.getDelta(), 1 / 20);
    const state = input.read();
    if (state.switchCamera) cam.toggleMode();
    for (const p of players) p.update(dt, p === me ? state : undefined);
    for (const p of players) if (p !== me) me.separateFrom(p);
    marker.position.x = me.position.x;
    marker.position.z = me.position.z;
    cam.update(me.position, dt);

    renderer.render(scene, cam.camera);
  });

  document.getElementById('loading')!.classList.add('done');
}

main().catch((err) => {
  console.error(err);
  document.getElementById('loading')!.textContent = `Fehler beim Laden: ${err.message ?? err}`;
});
