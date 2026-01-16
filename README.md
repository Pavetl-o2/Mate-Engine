# Desktop Avatar

Un compañero animado de escritorio que puede sentarse en tus ventanas y barra de tareas. Multiplataforma (Windows y macOS).

![Desktop Avatar Preview](assets/preview.png)

## Características

- **Avatar animado** - Soporta modelos 3D (GLB/GLTF) y sprites 2D
- **Sentarse en ventanas** - El avatar detecta ventanas abiertas y puede sentarse en sus bordes
- **Sentarse en taskbar** - También puede sentarse en la barra de tareas
- **Arrastrar y soltar** - Arrastra el avatar a cualquier parte del escritorio
- **Multiplataforma** - Funciona en Windows y macOS
- **Extensible** - Arquitectura preparada para futuras integraciones (IA, TTS, etc.)

## Requisitos

- [Node.js](https://nodejs.org/) 18 o superior
- [npm](https://www.npmjs.com/) o [yarn](https://yarnpkg.com/)

## Instalación

```bash
# Navegar a la carpeta del proyecto
cd desktop-avatar

# Instalar dependencias
npm install

# Ejecutar en modo desarrollo
npm run dev

# O ejecutar normalmente
npm start
```

## Agregar tu Propio Avatar

### Opción 1: Modelo 3D (GLB/GLTF)

1. Exporta tu modelo desde Blender como `.glb`
2. Renómbralo a `avatar.glb`
3. Colócalo en `assets/models/avatar.glb`

**Recomendaciones para el modelo:**
- Orientación: Mirando hacia el eje Z positivo
- Escala: Aproximadamente 1-2 metros de altura
- Animaciones incluidas con nombres: `idle`, `sitting`, `walking`, `dragging`

### Opción 2: Sprites 2D

1. Crea tus sprites animados (PNG con fondo transparente)
2. Colócalos en `assets/sprites/`
3. Nombres esperados:
   - `idle.png` - Animación idle (puede ser spritesheet)
   - `sitting.png` - Sentado
   - `dragging.png` - Siendo arrastrado
   - `walking.png` - Caminando (opcional)

**Formato de Spritesheet:**
- Frames horizontales
- Crea un archivo JSON con el mismo nombre (ej: `idle.json`):

```json
{
  "frameWidth": 100,
  "frameHeight": 150,
  "frameCount": 8,
  "frameRate": 10
}
```

## Estructura del Proyecto

```
desktop-avatar/
├── src/
│   ├── main/                 # Proceso principal de Electron
│   │   ├── index.js          # Entry point
│   │   ├── window-manager.js # Detección de ventanas
│   │   └── tray.js           # System tray
│   ├── renderer/             # Proceso de renderizado
│   │   ├── index.html        # HTML principal
│   │   ├── renderer.js       # Coordinador principal
│   │   ├── avatar-renderer.js # Renderizado 3D (Three.js)
│   │   ├── sprite-renderer.js # Renderizado 2D
│   │   ├── drag-controller.js # Sistema de arrastre
│   │   ├── window-sitter.js  # Sistema de sentarse
│   │   └── styles.css        # Estilos
│   └── preload/
│       └── preload.js        # Bridge de seguridad
├── assets/
│   ├── models/               # Modelos 3D (.glb, .gltf)
│   ├── sprites/              # Sprites 2D (.png)
│   └── animations/           # Animaciones adicionales
├── config/
│   └── default.json          # Configuración
└── package.json
```

## Controles

| Acción | Control |
|--------|---------|
| Mover avatar | Arrastra con el mouse |
| Menú de opciones | Doble clic en icono del system tray |
| Debug mode | `Ctrl + D` |
| Salir | Click derecho en tray → Quit |

## Compilar para Distribución

```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Ambos
npm run build:all
```

Los ejecutables se generan en la carpeta `dist/`.

## Configuración

Edita `config/default.json` para personalizar:

```json
{
  "avatar": {
    "width": 200,      // Ancho de la ventana del avatar
    "height": 300,     // Alto de la ventana del avatar
    "scale": 1.0       // Escala del avatar
  },
  "behavior": {
    "alwaysOnTop": true,           // Siempre visible
    "snapThreshold": 30,           // Píxeles para "snap" a ventanas
    "followWindowsOnMove": true,   // Seguir ventanas al moverse
    "enableTaskbarSitting": true   // Permitir sentarse en taskbar
  }
}
```

## Roadmap - Futuras Características

### Fase 2: Interacción
- [ ] Click para menú contextual
- [ ] Animaciones reactivas al pasar el mouse
- [ ] Sonidos opcionales

### Fase 3: Chat AI
- [ ] Integración con OpenAI/Claude
- [ ] Burbuja de chat
- [ ] Personalidad configurable

### Fase 4: Voz
- [ ] Text-to-Speech (ElevenLabs)
- [ ] Lip-sync básico
- [ ] Speech-to-Text (Whisper)

### Fase 5: Productividad
- [ ] Integración con Gmail/Outlook
- [ ] Sincronización de calendario
- [ ] Organizador de archivos

### Fase 6: Automatización
- [ ] Wake word ("Hey Avatar")
- [ ] Comandos de voz
- [ ] Workflows personalizados

## Solución de Problemas

### Windows: El avatar no detecta ventanas
- Ejecuta como administrador la primera vez
- Asegúrate de que Windows Defender no esté bloqueando

### macOS: No se detectan ventanas
- Ve a Preferencias del Sistema → Seguridad y Privacidad → Privacidad → Accesibilidad
- Agrega la aplicación a la lista

### El modelo 3D no carga
- Verifica que el archivo sea `.glb` (no `.gltf` con archivos separados)
- Revisa la consola de desarrollo (`Ctrl+Shift+I`)

## Licencia

MIT License - Siéntete libre de usar, modificar y distribuir.

## Créditos

Creado con:
- [Electron](https://www.electronjs.org/)
- [Three.js](https://threejs.org/)

---

**¿Preguntas?** Abre un issue en el repositorio.
