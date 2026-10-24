import * as THREE from 'three';
import './style.css';
import { PITCH } from './config';
import { BroadcastCamera } from './camera/broadcastCamera';
import { Input } from './input/input';
import { Player } from './player/player';
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

  const player = await Player.load(`${import.meta.env.BASE_URL}models/Xbot.glb`, {
    shirtColor: 0xd62839,
    bounds: new THREE.Box2(
      new THREE.Vector2(-PITCH.length / 2 - PITCH.runoff + 0.5, -PITCH.width / 2 - PITCH.runoff + 0.5),
      new THREE.Vector2(PITCH.length / 2 + PITCH.runoff - 0.5, PITCH.width / 2 + PITCH.runoff - 0.5),
    ),
  });
  player.position.set(-3, 0, 2);
  scene.add(player.root);

  const cam = new BroadcastCamera(window.innerWidth / window.innerHeight, renderer.domElement);
  cam.snap(player.position);

  const input = new Input();

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    cam.setAspect(window.innerWidth / window.innerHeight);
  });

  // Für Tests und Debugging im Browser erreichbar
  (window as unknown as { kidsKick: object }).kidsKick = { player, cam, scene, renderer };

  const timer = new THREE.Timer();
  timer.connect(document);
  renderer.setAnimationLoop((time) => {
    timer.update(time);
    const dt = Math.min(timer.getDelta(), 1 / 20);
    const state = input.read();
    if (state.switchCamera) cam.toggleMode();
    player.update(dt, state);
    cam.update(player.position, dt);

    renderer.render(scene, cam.camera);
  });

  document.getElementById('loading')!.classList.add('done');
}

main().catch((err) => {
  console.error(err);
  document.getElementById('loading')!.textContent = `Fehler beim Laden: ${err.message ?? err}`;
});
