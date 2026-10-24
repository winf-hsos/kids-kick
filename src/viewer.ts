// Entwickler-Ansicht für Spielerfiguren (nur Dev-Server):
// viewer.html?ids=kid01,kid03&team=0&anim=walk&t=0.3&yaw=30
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CharacterLibrary } from './player/character';
import { TEAMS } from './teams';

const params = new URLSearchParams(location.search);
const ids = (params.get('ids') ?? 'kid01').split(',');
const team = TEAMS[Number(params.get('team') ?? 0)];
const kit = params.get('keeper') ? team.keeperKit : team.kit;
const animName = params.get('anim') ?? 'idle';
const fixedTime = params.has('t') ? Number(params.get('t')) : null;
const yaw = THREE.MathUtils.degToRad(Number(params.get('yaw') ?? 20));

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x6d8a73);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 6, 4);
sun.castShadow = true;
scene.add(sun);
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(8, 48).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x3f6b30 }),
);
ground.receiveShadow = true;
scene.add(ground);

const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 100);
const spacing = 0.8;
const width = (ids.length - 1) * spacing;
camera.position.set(0, 1.0, 2.8 + width * 1.0);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.75, 0);
controls.update();

const library = await CharacterLibrary.load();
const mixers: THREE.AnimationMixer[] = [];
await Promise.all(
  ids.map(async (id, i) => {
    const { root, clips } = await library.create(id, kit, 7 + i, renderer);
    root.position.x = i * spacing - width / 2;
    root.rotation.y = yaw;
    scene.add(root);
    const clip = clips.find((c) => c.name === animName);
    if (clip) {
      const mixer = new THREE.AnimationMixer(root);
      mixer.clipAction(clip).play();
      if (fixedTime !== null) mixer.setTime(fixedTime * clip.duration);
      mixers.push(mixer);
    }
  }),
);
(window as unknown as { ready: boolean }).ready = true;

const timer = new THREE.Timer();
renderer.setAnimationLoop((time) => {
  timer.update(time);
  if (fixedTime === null) for (const m of mixers) m.update(timer.getDelta());
  renderer.render(scene, camera);
});
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
