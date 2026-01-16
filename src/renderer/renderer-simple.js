/**
 * Desktop Avatar - Simple Renderer
 * Carga y muestra el modelo GLB con Three.js
 */

const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

// Variables globales
let scene, camera, renderer, model, mixer, clock;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };

// Inicializar cuando cargue la página
window.addEventListener('DOMContentLoaded', init);

async function init() {
  console.log('Inicializando Desktop Avatar...');

  // Obtener el path correcto al modelo
  const modelsPath = path.join(__dirname, '../../assets/models');
  const modelPath = path.join(modelsPath, 'avatar.glb');

  console.log('Buscando modelo en:', modelPath);

  // Verificar si el archivo existe
  if (!fs.existsSync(modelPath)) {
    console.error('No se encontró el modelo en:', modelPath);
    showError('No se encontró avatar.glb<br>Ruta: ' + modelPath);
    return;
  }

  console.log('¡Archivo encontrado!');

  // Configurar Three.js
  setupThreeJS();

  // Cargar el modelo
  try {
    await loadModel(modelPath);
    console.log('¡Avatar cargado correctamente!');
  } catch (e) {
    console.error('Error:', e);
    showError('Error cargando modelo: ' + e.message);
  }

  // Configurar controles de arrastre
  setupDragControls();

  // Iniciar animación
  animate();
}

function setupThreeJS() {
  const canvas = document.getElementById('avatar-canvas');

  // Escena
  scene = new THREE.Scene();

  // Cámara - ajustada para ver el modelo completo
  camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
  camera.position.set(0, 0.8, 2.5);
  camera.lookAt(0, 0.8, 0);

  // Renderer con transparencia
  renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    alpha: true,
    antialias: true
  });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // Luces más intensas
  const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
  directionalLight.position.set(1, 2, 2);
  scene.add(directionalLight);

  const backLight = new THREE.DirectionalLight(0xffffff, 0.5);
  backLight.position.set(-1, 1, -1);
  scene.add(backLight);

  // Clock para animaciones
  clock = new THREE.Clock();

  console.log('Three.js configurado');
}

async function loadModel(modelPath) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();

    // Convertir path de Windows a URL file://
    let fileUrl = modelPath.replace(/\\/g, '/');
    if (!fileUrl.startsWith('/')) {
      fileUrl = '/' + fileUrl;
    }
    fileUrl = 'file://' + fileUrl;

    console.log('Cargando desde URL:', fileUrl);

    loader.load(
      fileUrl,
      (gltf) => {
        console.log('GLTF cargado:', gltf);

        model = gltf.scene;
        scene.add(model);

        // Centrar y escalar el modelo
        fitModelToView(model);

        // Configurar animaciones si existen
        if (gltf.animations && gltf.animations.length > 0) {
          mixer = new THREE.AnimationMixer(model);
          console.log('Animaciones encontradas:', gltf.animations.map(a => a.name));

          // Buscar animación idle o reproducir la primera
          let clip = gltf.animations.find(c =>
            c.name.toLowerCase().includes('idle')
          ) || gltf.animations[0];

          if (clip) {
            const action = mixer.clipAction(clip);
            action.play();
            console.log('Reproduciendo:', clip.name);
          }
        } else {
          console.log('No hay animaciones en el modelo');
        }

        resolve(gltf);
      },
      (progress) => {
        if (progress.total > 0) {
          const percent = (progress.loaded / progress.total * 100).toFixed(0);
          console.log('Progreso:', percent + '%');
        }
      },
      (error) => {
        console.error('Error en GLTFLoader:', error);
        reject(error);
      }
    );
  });
}

function fitModelToView(obj) {
  // Calcular bounding box
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  console.log('Tamaño del modelo:', size);
  console.log('Centro del modelo:', center);

  // Escalar para que quepa en la vista
  const maxDim = Math.max(size.x, size.y, size.z);
  const targetSize = 1.8;
  const scale = targetSize / maxDim;

  obj.scale.setScalar(scale);

  // Recalcular después de escalar
  box.setFromObject(obj);
  box.getCenter(center);

  // Centrar horizontalmente y poner en el suelo
  obj.position.x = -center.x;
  obj.position.y = -box.min.y;
  obj.position.z = -center.z;

  // Ajustar cámara para ver el modelo completo
  const height = size.y * scale;
  camera.position.set(0, height * 0.5, 2.5);
  camera.lookAt(0, height * 0.4, 0);

  console.log('Modelo ajustado. Escala:', scale);
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

  const pos = await ipcRenderer.invoke('get-avatar-position');
  dragOffset.x = event.screenX - pos.x;
  dragOffset.y = event.screenY - pos.y;
}

async function onMouseMove(event) {
  if (!isDragging) return;

  const newX = event.screenX - dragOffset.x;
  const newY = event.screenY - dragOffset.y;

  await ipcRenderer.invoke('set-avatar-position', { x: newX, y: newY });
}

function onMouseUp() {
  if (!isDragging) return;
  isDragging = false;
  document.body.style.cursor = 'grab';
}

function animate() {
  requestAnimationFrame(animate);

  // Actualizar animaciones
  if (mixer) {
    const delta = clock.getDelta();
    mixer.update(delta);
  }

  // Renderizar
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

function showError(message) {
  const container = document.getElementById('avatar-container');
  container.innerHTML = `
    <div style="
      color: white;
      background: rgba(200, 0, 0, 0.9);
      padding: 15px;
      font-family: Arial, sans-serif;
      font-size: 11px;
      border-radius: 8px;
      text-align: center;
      max-width: 180px;
      word-wrap: break-word;
    ">
      <strong>Error</strong><br><br>
      ${message}
    </div>
  `;
}
