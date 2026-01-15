# Models Directory

Coloca tu modelo 3D aquí para usar el modo 3D del avatar.

## Formato Soportado

- **GLB** (recomendado) - Archivo binario único
- **GLTF** - Con texturas embebidas

## Cómo Exportar desde Blender

### Paso 1: Preparar el modelo
1. Asegúrate de que el modelo mire hacia Z+ (frente)
2. Aplica todas las transformaciones (`Ctrl+A` → All Transforms)
3. Escala apropiada (~1-2m de altura)

### Paso 2: Preparar animaciones
1. Crea las animaciones en el Action Editor
2. Nombra las acciones:
   - `idle` - Animación de espera
   - `sitting` - Sentado
   - `dragging` - Siendo arrastrado
   - `walking` - Caminando (opcional)
   - `wave` - Saludando (opcional)
   - `talking` - Hablando (opcional)

### Paso 3: Exportar
1. File → Export → glTF 2.0 (.glb/.gltf)
2. Configuración recomendada:
   - Format: `glTF Binary (.glb)`
   - Include: ✓ Selected Objects (si solo quieres el avatar)
   - Transform: Y Up
   - Mesh: ✓ Apply Modifiers
   - Animation: ✓ Animations, ✓ Shape Keys

### Paso 4: Renombrar y colocar
1. Renombra el archivo a `avatar.glb`
2. Colócalo en esta carpeta

## Modelos VRM

Si tienes un modelo VRM (como los de VRoid):
1. Impórtalo en Blender usando el addon VRM Importer
2. Ajusta las animaciones
3. Exporta como GLB

## Solución de Problemas

### El modelo aparece muy grande/pequeño
- Ajusta la escala en Blender antes de exportar
- O modifica `avatar.scale` en `config/default.json`

### Las animaciones no funcionan
- Verifica que las acciones tengan los nombres correctos
- Asegúrate de exportar con "Animations" habilitado

### El modelo aparece negro
- Verifica que las texturas estén embebidas
- Usa materiales PBR compatibles con glTF
