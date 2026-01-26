#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
calibrar_boca.py

Herramienta simple para calibrar la posición de la boca en el video.
Lee mouth_track.json y permite ajustar offset, escala y rotación.

Controles:
  - Arrastrar con clic izquierdo: Mover
  - Rueda del mouse / +/-: Escalar
  - Arrastrar con clic derecho: Rotar
  - Flechas: Ajuste fino de posición
  - R: Resetear calibración
  - S o Espacio: Guardar y salir
  - Esc o Q: Cancelar

Uso:
    python calibrar_boca.py
    python calibrar_boca.py --video ruta/video.mp4 --track ruta/mouth_track.json
"""

import argparse
import json
import os
import sys
from pathlib import Path

import cv2
import numpy as np


class CalibradorBoca:
    """Calibrador interactivo de posición de boca."""

    WINDOW_NAME = "Calibrar Boca - S:Guardar | Esc:Cancelar | R:Reset"

    def __init__(self, video_path, track_path, mouth_sprite_path):
        self.video_path = str(video_path)
        self.track_path = str(track_path)
        self.mouth_sprite_path = str(mouth_sprite_path)

        # Cargar datos
        self.track_data = self._load_track()
        self.sprite = self._load_sprite()
        self.cap = cv2.VideoCapture(self.video_path)

        if not self.cap.isOpened():
            raise RuntimeError(f"No se pudo abrir el video: {self.video_path}")

        # Info del video
        self.total_frames = int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT))
        self.fps = self.cap.get(cv2.CAP_PROP_FPS) or 30.0
        self.vid_w = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.vid_h = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        # Calibración actual
        cal = self.track_data.get("calibration", {})
        offset = cal.get("offset", [0.0, 0.0])
        self.offset_x = float(offset[0]) if isinstance(offset, list) else 0.0
        self.offset_y = float(offset[1]) if isinstance(offset, list) else 0.0
        self.scale = float(cal.get("scale", 1.0))
        self.rotation = float(cal.get("rotation", 0.0))

        # Estado UI
        self.current_frame = 0
        self.is_dragging = False
        self.is_rotating = False
        self.drag_start = None
        self.last_mouse = None

        # Escala de visualización (0.5 = 50% del tamaño)
        self.display_scale = 0.5

    def _load_track(self):
        """Cargar datos de tracking."""
        with open(self.track_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _load_sprite(self):
        """Cargar sprite de boca con canal alpha."""
        img = cv2.imread(self.mouth_sprite_path, cv2.IMREAD_UNCHANGED)
        if img is None:
            raise RuntimeError(f"No se pudo cargar el sprite: {self.mouth_sprite_path}")

        # Asegurar que tiene canal alpha
        if img.shape[2] == 3:
            img = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)

        return img

    def _get_quad_for_frame(self, frame_idx):
        """Obtener quad para un frame específico."""
        frames = self.track_data.get("frames", [])
        if frame_idx < len(frames):
            frame_data = frames[frame_idx]
            if frame_data.get("valid", False):
                return np.array(frame_data["quad"], dtype=np.float32)
        return None

    def _apply_calibration_to_quad(self, quad):
        """Aplicar calibración (offset, scale, rotation) al quad."""
        if quad is None:
            return None

        quad = quad.copy()
        center = quad.mean(axis=0)

        # Trasladar al origen
        quad_centered = quad - center

        # Escalar
        quad_centered *= self.scale

        # Rotar
        if self.rotation != 0:
            angle_rad = np.radians(self.rotation)
            cos_a = np.cos(angle_rad)
            sin_a = np.sin(angle_rad)
            rotation_matrix = np.array([[cos_a, -sin_a], [sin_a, cos_a]])
            quad_centered = quad_centered @ rotation_matrix.T

        # Trasladar de vuelta y aplicar offset
        return quad_centered + center + np.array([self.offset_x, self.offset_y])

    def _overlay_sprite(self, frame, quad):
        """Superponer sprite de boca en el frame."""
        if quad is None:
            return frame

        # Calcular transformación perspectiva
        sprite_h, sprite_w = self.sprite.shape[:2]
        src_pts = np.array([
            [0, 0],
            [sprite_w - 1, 0],
            [sprite_w - 1, sprite_h - 1],
            [0, sprite_h - 1],
        ], dtype=np.float32)

        dst_pts = quad.astype(np.float32)

        # Matriz de transformación
        M = cv2.getPerspectiveTransform(src_pts, dst_pts)

        # Warp del sprite
        warped = cv2.warpPerspective(
            self.sprite, M, (frame.shape[1], frame.shape[0]),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=(0, 0, 0, 0)
        )

        # Blend con alpha
        if warped.shape[2] == 4:
            alpha = warped[:, :, 3:4].astype(np.float32) / 255.0
            rgb = warped[:, :, :3].astype(np.float32)

            frame_float = frame.astype(np.float32)
            result = frame_float * (1 - alpha) + rgb * alpha
            return result.astype(np.uint8)

        return frame

    def _draw_ui(self, frame):
        """Dibujar información de UI."""
        h, w = frame.shape[:2]

        # Fondo semi-transparente para texto
        overlay = frame.copy()
        cv2.rectangle(overlay, (0, 0), (w, 70), (0, 0, 0), -1)
        frame = cv2.addWeighted(overlay, 0.6, frame, 0.4, 0)

        # Info de calibración
        info1 = f"Offset: ({self.offset_x:.1f}, {self.offset_y:.1f}) | Escala: {self.scale:.2f} | Rotacion: {self.rotation:.1f}"
        cv2.putText(frame, info1, (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)

        info2 = f"Frame: {self.current_frame}/{self.total_frames-1} | Arrastrar:Mover | Rueda:Escalar | ClicDer:Rotar"
        cv2.putText(frame, info2, (10, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)

        return frame

    def _mouse_callback(self, event, x, y, flags, param):
        """Callback de eventos de mouse."""
        # Convertir coordenadas del mouse al espacio original
        x_orig = x / self.display_scale
        y_orig = y / self.display_scale

        if event == cv2.EVENT_LBUTTONDOWN:
            self.is_dragging = True
            self.drag_start = (x_orig, y_orig)
            self.last_mouse = (x_orig, y_orig)

        elif event == cv2.EVENT_RBUTTONDOWN:
            self.is_rotating = True
            self.drag_start = (x_orig, y_orig)
            self.last_mouse = (x_orig, y_orig)

        elif event == cv2.EVENT_MOUSEMOVE:
            if self.is_dragging and self.last_mouse:
                dx = x_orig - self.last_mouse[0]
                dy = y_orig - self.last_mouse[1]
                self.offset_x += dx
                self.offset_y += dy
                self.last_mouse = (x_orig, y_orig)

            elif self.is_rotating and self.last_mouse:
                dx = x_orig - self.last_mouse[0]
                self.rotation += dx * 0.3
                self.last_mouse = (x_orig, y_orig)

        elif event == cv2.EVENT_LBUTTONUP:
            self.is_dragging = False

        elif event == cv2.EVENT_RBUTTONUP:
            self.is_rotating = False

        elif event == cv2.EVENT_MOUSEWHEEL:
            # Escalar
            if flags > 0:
                self.scale *= 1.02
            else:
                self.scale /= 1.02
            self.scale = max(0.1, min(5.0, self.scale))

    def _render_frame(self):
        """Renderizar frame actual con overlay."""
        self.cap.set(cv2.CAP_PROP_POS_FRAMES, self.current_frame)
        ret, frame = self.cap.read()

        if not ret:
            return None

        # Obtener quad y aplicar calibración
        quad = self._get_quad_for_frame(self.current_frame)
        calibrated_quad = self._apply_calibration_to_quad(quad)

        # Overlay del sprite
        frame = self._overlay_sprite(frame, calibrated_quad)

        # Dibujar UI
        frame = self._draw_ui(frame)

        return frame

    def _save_calibration(self):
        """Guardar calibración en el archivo JSON."""
        self.track_data["calibration"] = {
            "offset": [self.offset_x, self.offset_y],
            "scale": self.scale,
            "rotation": self.rotation
        }
        self.track_data["calibrationApplied"] = True

        with open(self.track_path, "w", encoding="utf-8") as f:
            json.dump(self.track_data, f, indent=2)

        print(f"Calibración guardada en: {self.track_path}")

    def run(self):
        """Ejecutar el calibrador."""
        cv2.namedWindow(self.WINDOW_NAME)
        cv2.setMouseCallback(self.WINDOW_NAME, self._mouse_callback)

        print("\n=== Calibrador de Boca ===")
        print("Controles:")
        print("  Arrastrar: Mover posición")
        print("  Rueda/+/-: Escalar")
        print("  Clic derecho + arrastrar: Rotar")
        print("  Flechas: Ajuste fino")
        print("  [/]: Cambiar frame")
        print("  R: Resetear")
        print("  S/Espacio: Guardar")
        print("  Esc/Q: Cancelar")
        print("")

        try:
            while True:
                frame = self._render_frame()
                if frame is None:
                    self.current_frame = 0
                    continue

                # Redimensionar para visualización
                display_h = int(frame.shape[0] * self.display_scale)
                display_w = int(frame.shape[1] * self.display_scale)
                display_frame = cv2.resize(frame, (display_w, display_h), interpolation=cv2.INTER_AREA)

                cv2.imshow(self.WINDOW_NAME, display_frame)

                key = cv2.waitKey(30) & 0xFF

                # Guardar y salir
                if key == ord('s') or key == ord(' '):
                    self._save_calibration()
                    print("¡Calibración guardada!")
                    break

                # Cancelar
                elif key == 27 or key == ord('q'):
                    print("Cancelado.")
                    break

                # Reset
                elif key == ord('r'):
                    self.offset_x = 0.0
                    self.offset_y = 0.0
                    self.scale = 1.0
                    self.rotation = 0.0
                    print("Calibración reseteada.")

                # Escala
                elif key == ord('+') or key == ord('='):
                    self.scale *= 1.05
                elif key == ord('-'):
                    self.scale /= 1.05

                # Navegación de frames
                elif key == ord('['):
                    self.current_frame = max(0, self.current_frame - 10)
                elif key == ord(']'):
                    self.current_frame = min(self.total_frames - 1, self.current_frame + 10)

                # Flechas para ajuste fino
                elif key == 81 or key == 2:  # Izquierda
                    self.offset_x -= 1
                elif key == 83 or key == 3:  # Derecha
                    self.offset_x += 1
                elif key == 82 or key == 0:  # Arriba
                    self.offset_y -= 1
                elif key == 84 or key == 1:  # Abajo
                    self.offset_y += 1

        finally:
            self.cap.release()
            cv2.destroyAllWindows()


def find_default_paths():
    """Buscar rutas por defecto relativas al directorio tools."""
    tools_dir = Path(__file__).parent
    project_dir = tools_dir.parent
    assets_dir = project_dir / "assets" / "pngtuber"

    return {
        "video": assets_dir / "video.mp4",
        "track": assets_dir / "mouth_track.json",
        "mouth": assets_dir / "mouths" / "open.png",  # Usamos 'open' para calibrar
    }


def main():
    parser = argparse.ArgumentParser(
        description="Calibrar posición de boca en video"
    )
    parser.add_argument("--video", help="Ruta al video")
    parser.add_argument("--track", help="Ruta al mouth_track.json")
    parser.add_argument("--mouth", help="Ruta al sprite de boca (para preview)")

    args = parser.parse_args()

    # Buscar rutas por defecto
    defaults = find_default_paths()

    video_path = Path(args.video) if args.video else defaults["video"]
    track_path = Path(args.track) if args.track else defaults["track"]
    mouth_path = Path(args.mouth) if args.mouth else defaults["mouth"]

    # Verificar archivos
    if not video_path.exists():
        print(f"Error: Video no encontrado: {video_path}")
        sys.exit(1)

    if not track_path.exists():
        print(f"Error: Archivo de tracking no encontrado: {track_path}")
        print("Necesitas primero generar mouth_track.json con MotionPNGTuber")
        sys.exit(1)

    if not mouth_path.exists():
        print(f"Error: Sprite de boca no encontrado: {mouth_path}")
        sys.exit(1)

    print(f"Video: {video_path}")
    print(f"Tracking: {track_path}")
    print(f"Sprite: {mouth_path}")

    try:
        calibrador = CalibradorBoca(video_path, track_path, mouth_path)
        calibrador.run()
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
