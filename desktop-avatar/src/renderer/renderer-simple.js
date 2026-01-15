/**
 * Desktop Avatar - Simple Renderer
 * Carga y muestra el modelo GLB con Three.js
 */

// Variables globales
let scene, camera, renderer, model, mixer, clock;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };

// Inicializar cuando cargue la página
window.addEventListener('DOMContentLoaded', init);

async function init() {
  console.log('Inicializando Desktop Avatar...');

  // Obtener el path correcto al modelo
  const modelsPath = window.avatarAPI.modelsPath;
  const modelPath = nodePath.join(modelsPath, 'avatar.glb');

  console.log('Buscando modelo en:', modelPath);

  // Verificar si el archivo existe
  const fs = require('fs');
  if (!fs.existsSync(modelPath)) {
    console.error('No se encontró el modelo en:', modelPath);
    showError('No se encontró avatar.glb en la carpeta models');
    return;
  }

  // Configurar Three.js
  setupThreeJS();

  // Cargar el modelo
  await loadModel(modelPath);

  // Configurar controles de arrastre
  setupDragControls();

  // Iniciar animación
  animate();

  console.log('¡Avatar cargado correctamente!');
}

function setupThreeJS() {
  const canvas = document.getElementById('avatar-canvas');

  // Escena
  scene = new THREE.Scene();

  // Cámara
  camera = new THREE.PerspectiveCamera(30, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
  camera.position.set(0, 1, 3);
  camera.lookAt(0, 1, 0);

  // Renderer con transparencia
  renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    alpha: true,
    antialias: true
  });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x000000, 0);

  // Luces
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(1, 2, 2);
  scene.add(directionalLight);

  const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
  backLight.position.set(-1, 1, -1);
  scene.add(backLight);

  // Clock para animaciones
  clock = new THREE.Clock();

  // Manejar resize
  window.addEventListener('resize', onResize);
}

async function loadModel(modelPath) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();

    // Convertir path de Windows a URL file://
    const fileUrl = 'file:///' + modelPath.replace(/\\/g, '/');

    console.log('Cargando desde:', fileUrl);

    loader.load(
      fileUrl,
      (gltf) => {
        model = gltf.scene;
        scene.add(model);

        // Centrar y escalar el modelo
        fitModelToView(model);

        // Configurar animaciones si existen
        if (gltf.animations && gltf.animations.length > 0) {
          mixer = new THREE.AnimationMixer(model);

          // Buscar animación idle o reproducir la primera
          let idleClip = gltf.animations.find(clip =>
            clip.name.toLowerCase().includes('idle')
          ) || gltf.animations[0];

          if (idleClip) {
            const action = mixer.clipAction(idleClip);
            action.play();
            console.log('Reproduciendo animación:', idleClip.name);
          }

          console.log('Animaciones encontradas:', gltf.animations.map(a => a.name));
        }

        console.log('Modelo cargado exitosamente');
        resolve(gltf);
      },
      (progress) => {
        const percent = (progress.loaded / progress.total * 100).toFixed(0);
        console.log('Cargando modelo:', percent + '%');
      },
      (error) => {
        console.error('Error cargando modelo:', error);
        showError('Error cargando el modelo: ' + error.message);
        reject(error);
      }
    );
  });
}

function fitModelToView(model) {
  // Calcular bounding box
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  // Escalar para que quepa en la vista
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = 2 / maxDim;
  model.scale.setScalar(scale);

  // Centrar horizontalmente, alinear abajo
  model.position.x = -center.x * scale;
  model.position.y = -box.min.y * scale;
  model.position.z = -center.z * scale;

  // Ajustar cámara
  camera.position.set(0, 1, 3);
  camera.lookAt(0, 0.8, 0);
}

function setupDragControls() {
  const container = document.getElementById('avatar-container');

  container.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

async function onMouseDown(event) {
  if (event.button !== 0) return;

  isDragging = true;
  document.body.style.cursor = 'grabbing';

  const pos = await window.avatarAPI.getPosition();
  dragOffset.x = event.screenX - pos.x;
  dragOffset.y = event.screenY - pos.y;
}

async function onMouseMove(event) {
  if (!isDragging) return;

  const newX = event.screenX - dragOffset.x;
  const newY = event.screenY - dragOffset.y;

  await window.avatarAPI.setPosition(newX, newY);
}

function onMouseUp() {
  if (!isDragging) return;
  isDragging = false;
  document.body.style.cursor = 'grab';
}

function onResize() {
  const canvas = document.getElementById('avatar-canvas');
  camera.aspect = canvas.clientWidth / canvas.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
}

function animate() {
  requestAnimationFrame(animate);

  // Actualizar animaciones
  if (mixer) {
    const delta = clock.getDelta();
    mixer.update(delta);
  }

  // Renderizar
  renderer.render(scene, camera);
}

function showError(message) {
  const container = document.getElementById('avatar-container');
  container.innerHTML = `
    <div style="
      color: white;
      background: rgba(255,0,0,0.8);
      padding: 10px;
      font-family: sans-serif;
      font-size: 12px;
      border-radius: 5px;
      text-align: center;
    ">
      ${message}
    </div>
  `;
}
