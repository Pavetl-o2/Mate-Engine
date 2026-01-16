# Sprites Directory

Coloca tus sprites aquí para usar el modo 2D del avatar.

## Formato Esperado

### Imagen Simple
- `idle.png` - Imagen estática para idle
- `sitting.png` - Imagen para cuando está sentado
- `dragging.png` - Imagen mientras se arrastra

### Spritesheet (Animación)
Para animaciones, crea un spritesheet horizontal y un archivo JSON:

**Ejemplo: `idle.png` + `idle.json`**

```
idle.png: [Frame1][Frame2][Frame3][Frame4]...
```

**idle.json:**
```json
{
  "frameWidth": 100,
  "frameHeight": 150,
  "frameCount": 8,
  "frameRate": 10,
  "loop": true
}
```

## Recomendaciones

1. **Tamaño**: 100-200px de ancho, 150-300px de alto
2. **Fondo**: Transparente (PNG con alpha)
3. **Orientación**: El personaje mirando hacia la derecha
4. **Punto de anclaje**: Los "pies" del personaje deben estar en la parte inferior

## Animaciones Soportadas

| Nombre | Uso |
|--------|-----|
| `idle` | Estado normal |
| `sitting` | Sentado en ventana/taskbar |
| `dragging` | Mientras se arrastra |
| `walking` | Caminando (futuro) |
| `wave` | Saludando (futuro) |
| `talking` | Hablando (futuro, para TTS) |
| `thinking` | Pensando (futuro, para IA) |
