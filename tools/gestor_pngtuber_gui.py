#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gestor_pngtuber_gui.py

Herramienta principal para gestionar assets de PNGTuber.
Flujo completo:
1. Analizar video -> Generar tracking de boca
2. Calibrar posición de boca
3. Generar video sin boca (inpainting)
4. Extraer sprites de boca

Basado en MotionPNGTuber de rotejin.

Uso:
    python gestor_pngtuber_gui.py
"""

from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Optional, Dict, Any

import cv2
import numpy as np

import tkinter as tk
from tkinter import ttk, filedialog, messagebox

# MediaPipe para detección
try:
    import mediapipe as mp
    if hasattr(mp, 'solutions') and hasattr(mp.solutions, 'face_mesh'):
        HAS_MEDIAPIPE = True
        MEDIAPIPE_LEGACY = True
    elif hasattr(mp, 'tasks'):
        HAS_MEDIAPIPE = True
        MEDIAPIPE_LEGACY = False
    else:
        HAS_MEDIAPIPE = False
        MEDIAPIPE_LEGACY = False
except ImportError:
    HAS_MEDIAPIPE = False
    MEDIAPIPE_LEGACY = False

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

APP_TITLE = "Gestor de PNGTuber - Mate Engine"

# Índices de landmarks de boca (MediaPipe)
MOUTH_OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95]


# ---------------------------------------------------------------------------
# Detector de boca
# ---------------------------------------------------------------------------

class MouthDetector:
    """Detector de boca usando MediaPipe."""

    def __init__(self):
        if not HAS_MEDIAPIPE:
            raise RuntimeError("MediaPipe no está instalado")

        self.frame_timestamp = 0

        if MEDIAPIPE_LEGACY:
            self.face_mesh = mp.solutions.face_mesh.FaceMesh(
                static_image_mode=False,
                max_num_faces=1,
                refine_landmarks=True,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5
            )
            self.face_landmarker = None
        else:
            from mediapipe.tasks import python
            from mediapipe.tasks.python import vision
            import urllib.request

            model_path = os.path.join(os.path.dirname(__file__), 'face_landmarker.task')
            if not os.path.exists(model_path):
                print("Descargando modelo...")
                url = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
                urllib.request.urlretrieve(url, model_path)

            base_options = python.BaseOptions(model_asset_path=model_path)
            options = vision.FaceLandmarkerOptions(
                base_options=base_options,
                running_mode=vision.RunningMode.VIDEO,
                num_faces=1,
                min_face_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            )
            self.face_landmarker = vision.FaceLandmarker.create_from_options(options)
            self.face_mesh = None

    def detect(self, frame: np.ndarray, padding: float = 0.25) -> tuple:
        """Detectar quad de boca."""
        h, w = frame.shape[:2]
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        landmarks = None

        if MEDIAPIPE_LEGACY and self.face_mesh:
            results = self.face_mesh.process(rgb)
            if results.multi_face_landmarks:
                landmarks = results.multi_face_landmarks[0].landmark
        elif self.face_landmarker:
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            self.frame_timestamp += 33
            try:
                results = self.face_landmarker.detect_for_video(mp_image, self.frame_timestamp)
            except:
                results = self.face_landmarker.detect(mp_image)
            if results.face_landmarks:
                landmarks = results.face_landmarks[0]

        if landmarks is None:
            return None, False

        mouth_points = []
        for idx in MOUTH_OUTER:
            lm = landmarks[idx]
            mouth_points.append([lm.x * w, lm.y * h])
        mouth_points = np.array(mouth_points)

        x_min, y_min = mouth_points.min(axis=0)
        x_max, y_max = mouth_points.max(axis=0)

        width = x_max - x_min
        height = y_max - y_min
        pad_x = width * padding
        pad_y = height * padding

        quad = [
            [x_min - pad_x, y_min - pad_y],
            [x_max + pad_x, y_min - pad_y],
            [x_max + pad_x, y_max + pad_y],
            [x_min - pad_x, y_max + pad_y]
        ]

        return quad, True

    def close(self):
        if MEDIAPIPE_LEGACY and self.face_mesh:
            self.face_mesh.close()
        if self.face_landmarker:
            self.face_landmarker.close()


# ---------------------------------------------------------------------------
# Aplicación GUI
# ---------------------------------------------------------------------------

class GestorPNGTuberApp(tk.Tk):
    """Aplicación principal para gestionar PNGTuber."""

    def __init__(self):
        super().__init__()

        self.title(APP_TITLE)
        self.geometry("600x780")
        self.resizable(True, True)

        # Estado
        self.video_path: str = ""
        self.mouths_path: str = ""
        self.is_processing = False

        # Cola de logs
        self.log_queue: queue.Queue[str] = queue.Queue()

        # Cargar última sesión
        self._load_session()

        # Construir UI
        self._build_ui()
        self._poll_logs()

    def _get_session_path(self) -> Path:
        return Path(__file__).parent / ".gestor_session.json"

    def _load_session(self):
        """Cargar última sesión."""
        session_path = self._get_session_path()
        if session_path.exists():
            try:
                with open(session_path, "r") as f:
                    data = json.load(f)
                    self.video_path = data.get("video_path", "")
                    self.mouths_path = data.get("mouths_path", "")
            except:
                pass

        # Valores por defecto
        if not self.video_path:
            default_video = Path(__file__).parent.parent / "assets" / "pngtuber" / "video.mp4"
            if default_video.exists():
                self.video_path = str(default_video)

        if not self.mouths_path:
            default_mouths = Path(__file__).parent.parent / "assets" / "pngtuber" / "mouths"
            if default_mouths.exists():
                self.mouths_path = str(default_mouths)

    def _save_session(self):
        """Guardar sesión actual."""
        try:
            with open(self._get_session_path(), "w") as f:
                json.dump({
                    "video_path": self.video_path,
                    "mouths_path": self.mouths_path,
                }, f)
        except:
            pass

    def _build_ui(self):
        """Construir interfaz de usuario."""
        main_frame = ttk.Frame(self, padding=10)
        main_frame.pack(fill=tk.BOTH, expand=True)
        main_frame.columnconfigure(1, weight=1)

        row = 0

        # Título
        title = ttk.Label(main_frame, text="Gestor de PNGTuber", font=("Helvetica", 16, "bold"))
        title.grid(row=row, column=0, columnspan=3, pady=(0, 15))
        row += 1

        # Selección de video
        ttk.Label(main_frame, text="Video:").grid(row=row, column=0, sticky="w", pady=5)
        self.video_var = tk.StringVar(value=self.video_path)
        video_entry = ttk.Entry(main_frame, textvariable=self.video_var, width=45)
        video_entry.grid(row=row, column=1, sticky="ew", padx=5, pady=5)
        ttk.Button(main_frame, text="...", width=3,
                   command=self._browse_video).grid(row=row, column=2, pady=5)
        row += 1

        # Selección de carpeta de bocas
        ttk.Label(main_frame, text="Bocas:").grid(row=row, column=0, sticky="w", pady=5)
        self.mouths_var = tk.StringVar(value=self.mouths_path)
        mouths_entry = ttk.Entry(main_frame, textvariable=self.mouths_var, width=45)
        mouths_entry.grid(row=row, column=1, sticky="ew", padx=5, pady=5)
        ttk.Button(main_frame, text="...", width=3,
                   command=self._browse_mouths).grid(row=row, column=2, pady=5)
        row += 1

        # Separador
        ttk.Separator(main_frame, orient="horizontal").grid(
            row=row, column=0, columnspan=3, sticky="ew", pady=15)
        row += 1

        # === Paso 1: Analizar Video ===
        step1 = ttk.LabelFrame(main_frame, text="Paso 1: Analizar Video", padding=10)
        step1.grid(row=row, column=0, columnspan=3, sticky="ew", pady=5)
        step1.columnconfigure(0, weight=1)

        ttk.Label(step1, text="Detecta la boca en cada frame y genera mouth_track.json",
                  foreground="gray").grid(row=0, column=0, sticky="w")

        self.analyze_btn = ttk.Button(step1, text="Analizar Video",
                                       command=self._run_analyze)
        self.analyze_btn.grid(row=1, column=0, pady=10, sticky="ew")
        row += 1

        # === Paso 2: Calibrar ===
        step2 = ttk.LabelFrame(main_frame, text="Paso 2: Calibrar Posición", padding=10)
        step2.grid(row=row, column=0, columnspan=3, sticky="ew", pady=5)
        step2.columnconfigure(0, weight=1)

        ttk.Label(step2, text="Ajusta offset, escala y rotación de la boca",
                  foreground="gray").grid(row=0, column=0, sticky="w")

        self.calibrate_btn = ttk.Button(step2, text="Abrir Calibrador",
                                         command=self._run_calibrate)
        self.calibrate_btn.grid(row=1, column=0, pady=10, sticky="ew")
        row += 1

        # === Paso 3: Generar Video Sin Boca ===
        step3 = ttk.LabelFrame(main_frame, text="Paso 3: Generar Video Sin Boca", padding=10)
        step3.grid(row=row, column=0, columnspan=3, sticky="ew", pady=5)
        step3.columnconfigure(0, weight=1)

        ttk.Label(step3, text="Remueve la boca original usando inpainting (toma tiempo)",
                  foreground="gray").grid(row=0, column=0, sticky="w")

        self.mouthless_btn = ttk.Button(step3, text="Generar Video Sin Boca",
                                         command=self._run_generate_mouthless)
        self.mouthless_btn.grid(row=1, column=0, pady=10, sticky="ew")
        row += 1

        # === Paso 4: Extraer Sprites ===
        step4 = ttk.LabelFrame(main_frame, text="Paso 4: Extraer Sprites de Boca", padding=10)
        step4.grid(row=row, column=0, columnspan=3, sticky="ew", pady=5)
        step4.columnconfigure(0, weight=1)

        ttk.Label(step4, text="Extrae los 5 sprites de boca (open, closed, half, e, u)",
                  foreground="gray").grid(row=0, column=0, sticky="w")

        self.extract_btn = ttk.Button(step4, text="Abrir Extractor de Bocas",
                                       command=self._run_extract)
        self.extract_btn.grid(row=1, column=0, pady=10, sticky="ew")
        row += 1

        # Separador
        ttk.Separator(main_frame, orient="horizontal").grid(
            row=row, column=0, columnspan=3, sticky="ew", pady=15)
        row += 1

        # === Barra de progreso ===
        self.progress_var = tk.DoubleVar(value=0)
        self.progress_bar = ttk.Progressbar(main_frame, variable=self.progress_var,
                                             maximum=100, mode="determinate")
        self.progress_bar.grid(row=row, column=0, columnspan=3, sticky="ew", pady=5)
        row += 1

        # === Área de log ===
        log_frame = ttk.LabelFrame(main_frame, text="Registro", padding=5)
        log_frame.grid(row=row, column=0, columnspan=3, sticky="nsew", pady=5)
        log_frame.columnconfigure(0, weight=1)
        log_frame.rowconfigure(0, weight=1)
        main_frame.rowconfigure(row, weight=1)

        self.log_text = tk.Text(log_frame, height=10, state=tk.DISABLED, wrap=tk.WORD)
        self.log_text.grid(row=0, column=0, sticky="nsew")

        scrollbar = ttk.Scrollbar(log_frame, orient="vertical", command=self.log_text.yview)
        scrollbar.grid(row=0, column=1, sticky="ns")
        self.log_text.configure(yscrollcommand=scrollbar.set)

        self.log("Listo. Selecciona un video y ejecuta los pasos.")

    def log(self, message: str):
        """Agregar mensaje al log."""
        self.log_queue.put(message)

    def _poll_logs(self):
        """Procesar cola de logs."""
        while not self.log_queue.empty():
            try:
                msg = self.log_queue.get_nowait()
                self.log_text.configure(state=tk.NORMAL)
                self.log_text.insert(tk.END, f"> {msg}\n")
                self.log_text.see(tk.END)
                self.log_text.configure(state=tk.DISABLED)
            except queue.Empty:
                break

        self.after(100, self._poll_logs)

    def _browse_video(self):
        """Seleccionar video."""
        initial = Path(self.video_var.get()).parent if self.video_var.get() else Path.home()
        path = filedialog.askopenfilename(
            title="Seleccionar Video",
            initialdir=str(initial),
            filetypes=[("Videos", "*.mp4 *.avi *.mov *.mkv"), ("Todos", "*.*")]
        )
        if path:
            self.video_path = path
            self.video_var.set(path)
            self._save_session()
            self.log(f"Video: {path}")

    def _browse_mouths(self):
        """Seleccionar carpeta de bocas."""
        initial = Path(self.mouths_var.get()) if self.mouths_var.get() else Path.home()
        path = filedialog.askdirectory(title="Seleccionar Carpeta de Bocas", initialdir=str(initial))
        if path:
            self.mouths_path = path
            self.mouths_var.set(path)
            self._save_session()
            self.log(f"Bocas: {path}")

    def _set_processing(self, is_processing: bool):
        """Habilitar/deshabilitar botones."""
        self.is_processing = is_processing
        state = "disabled" if is_processing else "normal"
        self.analyze_btn.configure(state=state)
        self.calibrate_btn.configure(state=state)
        self.mouthless_btn.configure(state=state)
        self.extract_btn.configure(state=state)

    def _run_analyze(self):
        """Ejecutar análisis de video."""
        video_path = self.video_var.get()
        if not video_path or not Path(video_path).exists():
            messagebox.showerror("Error", "Selecciona un video válido")
            return

        self._save_session()
        self._set_processing(True)
        self.progress_var.set(0)
        self.log("Iniciando análisis de video...")

        def worker():
            try:
                detector = MouthDetector()
                cap = cv2.VideoCapture(video_path)

                if not cap.isOpened():
                    self.log("Error: No se pudo abrir el video")
                    return

                fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
                width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

                self.log(f"Video: {width}x{height} @ {fps:.1f}fps, {total_frames} frames")

                # Estructura de salida
                tracking_data = {
                    "fps": fps,
                    "width": width,
                    "height": height,
                    "refSpriteSize": [128, 85],
                    "calibration": {
                        "offset": [0.0, 0.0],
                        "scale": 1.0,
                        "rotation": 0.0
                    },
                    "calibrationApplied": False,
                    "frames": []
                }

                frame_idx = 0
                valid_count = 0

                while True:
                    ret, frame = cap.read()
                    if not ret:
                        break

                    quad, valid = detector.detect(frame)

                    if valid and quad is not None:
                        tracking_data["frames"].append({
                            "quad": quad,
                            "valid": True
                        })
                        valid_count += 1
                    else:
                        # Frame inválido - usar último válido o placeholder
                        if tracking_data["frames"]:
                            last = tracking_data["frames"][-1]
                            tracking_data["frames"].append({
                                "quad": last["quad"],
                                "valid": False
                            })
                        else:
                            tracking_data["frames"].append({
                                "quad": [[0, 0], [1, 0], [1, 1], [0, 1]],
                                "valid": False
                            })

                    frame_idx += 1

                    if frame_idx % 30 == 0:
                        progress = (frame_idx / total_frames) * 100
                        self.after(0, lambda p=progress: self.progress_var.set(p))
                        if frame_idx % 100 == 0:
                            self.log(f"Frame {frame_idx}/{total_frames}...")

                cap.release()
                detector.close()

                # Guardar resultado
                output_path = Path(video_path).parent / "mouth_track.json"
                with open(output_path, "w", encoding="utf-8") as f:
                    json.dump(tracking_data, f, indent=2)

                self.after(0, lambda: self.progress_var.set(100))
                self.log(f"Análisis completo: {valid_count}/{total_frames} frames válidos")
                self.log(f"Guardado: {output_path}")

            except Exception as e:
                self.log(f"Error: {e}")
                import traceback
                traceback.print_exc()

            finally:
                self.after(0, lambda: self._set_processing(False))

        thread = threading.Thread(target=worker, daemon=True)
        thread.start()

    def _run_calibrate(self):
        """Abrir calibrador."""
        video_path = self.video_var.get()
        if not video_path or not Path(video_path).exists():
            messagebox.showerror("Error", "Selecciona un video válido")
            return

        track_path = Path(video_path).parent / "mouth_track.json"
        if not track_path.exists():
            messagebox.showerror("Error", "Primero ejecuta el Paso 1 (Analizar Video)")
            return

        mouths_path = self.mouths_var.get()
        if not mouths_path or not Path(mouths_path).exists():
            messagebox.showerror("Error", "Selecciona una carpeta de bocas válida")
            return

        mouth_sprite = Path(mouths_path) / "open.png"
        if not mouth_sprite.exists():
            mouth_sprite = Path(mouths_path) / "closed.png"
        if not mouth_sprite.exists():
            # Buscar cualquier PNG
            pngs = list(Path(mouths_path).glob("*.png"))
            if pngs:
                mouth_sprite = pngs[0]
            else:
                messagebox.showerror("Error", "No se encontraron sprites de boca (.png)")
                return

        self._save_session()
        self.log("Abriendo calibrador...")

        # Ejecutar calibrador en proceso separado
        calibrator_path = Path(__file__).parent / "calibrar_boca.py"
        if calibrator_path.exists():
            subprocess.Popen([
                sys.executable,
                str(calibrator_path),
                "--video", video_path,
                "--track", str(track_path),
                "--mouth", str(mouth_sprite)
            ])
            self.log("Calibrador abierto. Ajusta la posición y presiona S para guardar.")
        else:
            messagebox.showerror("Error", f"No se encontró: {calibrator_path}")

    def _run_generate_mouthless(self):
        """Generar video sin boca usando inpainting."""
        video_path = self.video_var.get()
        if not video_path or not Path(video_path).exists():
            messagebox.showerror("Error", "Selecciona un video válido")
            return

        track_path = Path(video_path).parent / "mouth_track.json"
        if not track_path.exists():
            messagebox.showerror("Error", "Primero ejecuta el Paso 1 (Analizar Video)")
            return

        # Verificar si está calibrado
        try:
            with open(track_path, "r", encoding="utf-8") as f:
                track_data = json.load(f)
            if not track_data.get("calibrationApplied", False):
                result = messagebox.askyesno(
                    "Calibración",
                    "No se ha calibrado la posición de la boca.\n"
                    "¿Continuar sin calibración?\n\n"
                    "(Se recomienda calibrar primero en el Paso 2)"
                )
                if not result:
                    return
        except Exception as e:
            self.log(f"Error leyendo tracking: {e}")
            return

        self._save_session()
        self._set_processing(True)
        self.progress_var.set(0)
        self.log("Iniciando generación de video sin boca...")
        self.log("Este proceso puede tomar varios minutos. Por favor espera...")

        def worker():
            try:
                # Cargar tracking data
                with open(track_path, "r", encoding="utf-8") as f:
                    track_data = json.load(f)

                frames_data = track_data.get("frames", [])
                calibration = track_data.get("calibration", {})
                offset = calibration.get("offset", [0.0, 0.0])
                scale = calibration.get("scale", 1.0)
                rotation = calibration.get("rotation", 0.0)

                # Abrir video
                cap = cv2.VideoCapture(video_path)
                if not cap.isOpened():
                    self.log("Error: No se pudo abrir el video")
                    return

                fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
                width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

                # Configurar salida (archivo temporal)
                output_dir = Path(video_path).parent
                temp_output = output_dir / "video_mouthless_temp.mp4"
                final_output = output_dir / "video_mouthless.mp4"

                fourcc = cv2.VideoWriter_fourcc(*'mp4v')
                out = cv2.VideoWriter(str(temp_output), fourcc, fps, (width, height))

                if not out.isOpened():
                    self.log("Error: No se pudo crear el video de salida")
                    cap.release()
                    return

                self.log(f"Paso 1/2: Procesando {total_frames} frames (inpainting)...")

                frame_idx = 0
                while True:
                    ret, frame = cap.read()
                    if not ret:
                        break

                    # Obtener quad del frame
                    if frame_idx < len(frames_data):
                        frame_data = frames_data[frame_idx]
                        quad = frame_data.get("quad")
                        valid = frame_data.get("valid", False)

                        if valid and quad:
                            # Aplicar calibración al quad
                            quad = np.array(quad, dtype=np.float32)

                            # Calcular centro
                            center = quad.mean(axis=0)

                            # Trasladar al origen
                            quad_centered = quad - center

                            # Escalar
                            quad_centered *= scale

                            # Rotar
                            if rotation != 0:
                                angle_rad = np.radians(rotation)
                                cos_a = np.cos(angle_rad)
                                sin_a = np.sin(angle_rad)
                                rotation_matrix = np.array([[cos_a, -sin_a], [sin_a, cos_a]])
                                quad_centered = quad_centered @ rotation_matrix.T

                            # Trasladar de vuelta + offset
                            quad = quad_centered + center + np.array([offset[0], offset[1]])

                            # Crear máscara para inpainting
                            mask = self._create_mouth_mask(frame, quad)

                            # Aplicar inpainting
                            frame = cv2.inpaint(frame, mask, inpaintRadius=5, flags=cv2.INPAINT_TELEA)

                    out.write(frame)
                    frame_idx += 1

                    if frame_idx % 30 == 0:
                        # Progreso: 0-80% para inpainting
                        progress = (frame_idx / total_frames) * 80
                        self.after(0, lambda p=progress: self.progress_var.set(p))
                        if frame_idx % 100 == 0:
                            self.log(f"Frame {frame_idx}/{total_frames}...")

                cap.release()
                out.release()

                self.log("Inpainting completado.")

                # Paso 2: Re-encode con FFmpeg para compatibilidad HTML5
                self.log("Paso 2/2: Re-encoding con FFmpeg (H.264)...")
                self.after(0, lambda: self.progress_var.set(85))

                ffmpeg_success = self._reencode_with_ffmpeg(
                    str(temp_output),
                    str(final_output),
                    fps
                )

                self.after(0, lambda: self.progress_var.set(100))

                if ffmpeg_success:
                    # Limpiar archivo temporal solo si FFmpeg tuvo éxito
                    if temp_output.exists():
                        try:
                            temp_output.unlink()
                        except:
                            pass
                    self.log(f"Video generado: {final_output}")
                    self.log("¡Proceso completado!")
                else:
                    # Si FFmpeg falló, renombrar el temporal como final
                    if temp_output.exists():
                        # Eliminar final si existe (de un intento previo)
                        if final_output.exists():
                            try:
                                final_output.unlink()
                            except:
                                pass
                        try:
                            temp_output.rename(final_output)
                        except:
                            pass
                    self.log(f"Video generado (sin re-encode): {final_output}")
                    self.log("Nota: FFmpeg no disponible. El video puede no ser compatible con HTML5.")

            except Exception as e:
                self.log(f"Error: {e}")
                import traceback
                traceback.print_exc()

            finally:
                self.after(0, lambda: self._set_processing(False))

        thread = threading.Thread(target=worker, daemon=True)
        thread.start()

    def _reencode_with_ffmpeg(self, input_path: str, output_path: str, fps: float) -> bool:
        """Re-encode video con FFmpeg para compatibilidad HTML5 (H.264)."""
        # Buscar FFmpeg en el sistema
        ffmpeg_cmd = None

        # Intentar diferentes ubicaciones de FFmpeg
        import glob

        possible_paths = [
            "ffmpeg",  # En PATH
            "ffmpeg.exe",  # Windows en PATH
            r"C:\ffmpeg\bin\ffmpeg.exe",  # Instalación común Windows
            r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
            "/usr/bin/ffmpeg",  # Linux
            "/usr/local/bin/ffmpeg",  # macOS
        ]

        # Buscar en instalaciones de WinGet
        winget_pattern = os.path.expanduser(
            r"~\AppData\Local\Microsoft\WinGet\Packages\*ffmpeg*\*\bin\ffmpeg.exe"
        )
        winget_matches = glob.glob(winget_pattern)
        if winget_matches:
            # Usar la versión más reciente (última en orden alfabético)
            possible_paths.insert(0, sorted(winget_matches)[-1])

        for path in possible_paths:
            try:
                result = subprocess.run(
                    [path, "-version"],
                    capture_output=True,
                    timeout=5
                )
                if result.returncode == 0:
                    ffmpeg_cmd = path
                    break
            except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
                continue

        if not ffmpeg_cmd:
            self.log("FFmpeg no encontrado en el sistema.")
            self.log("Instala FFmpeg para mejor compatibilidad: https://ffmpeg.org/download.html")
            return False

        try:
            # Eliminar archivo de salida si existe
            if Path(output_path).exists():
                Path(output_path).unlink()

            # Comando FFmpeg para re-encode a H.264
            cmd = [
                ffmpeg_cmd,
                "-y",  # Sobrescribir sin preguntar
                "-i", input_path,
                "-c:v", "libx264",  # Codec H.264
                "-preset", "medium",  # Balance velocidad/calidad
                "-crf", "23",  # Calidad (menor = mejor, 18-28 recomendado)
                "-pix_fmt", "yuv420p",  # Formato de pixel compatible
                "-movflags", "+faststart",  # Optimizar para streaming
                "-r", str(fps),  # Mantener FPS
                output_path
            ]

            self.log(f"Ejecutando: ffmpeg -i input -c:v libx264 ...")

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=600  # 10 minutos máximo
            )

            if result.returncode == 0:
                self.log("Re-encoding completado exitosamente.")
                return True
            else:
                self.log(f"Error en FFmpeg: {result.stderr[:200] if result.stderr else 'desconocido'}")
                return False

        except subprocess.TimeoutExpired:
            self.log("Error: FFmpeg tardó demasiado tiempo.")
            return False
        except Exception as e:
            self.log(f"Error ejecutando FFmpeg: {e}")
            return False

    def _create_mouth_mask(self, frame: np.ndarray, quad: np.ndarray) -> np.ndarray:
        """Crear máscara para la región de la boca."""
        h, w = frame.shape[:2]
        mask = np.zeros((h, w), dtype=np.uint8)

        # Calcular centro y dimensiones del quad
        center = quad.mean(axis=0).astype(np.int32)

        # Calcular ancho y alto del quad
        width = np.linalg.norm(quad[1] - quad[0])
        height = np.linalg.norm(quad[3] - quad[0])

        # Expandir un poco la máscara para mejor inpainting
        width = int(width * 1.1)
        height = int(height * 1.1)

        # Calcular ángulo de rotación del quad
        angle = np.degrees(np.arctan2(quad[1][1] - quad[0][1], quad[1][0] - quad[0][0]))

        # Dibujar elipse rotada
        cv2.ellipse(
            mask,
            tuple(center),
            (int(width / 2), int(height / 2)),
            angle,
            0, 360,
            255,
            -1
        )

        # Aplicar blur para suavizar bordes
        mask = cv2.GaussianBlur(mask, (21, 21), 0)

        # Umbralizar para obtener máscara binaria
        _, mask = cv2.threshold(mask, 127, 255, cv2.THRESH_BINARY)

        return mask

    def _run_extract(self):
        """Abrir extractor de bocas."""
        self._save_session()
        self.log("Abriendo extractor de bocas...")

        extractor_path = Path(__file__).parent / "extractor_bocas_gui.py"
        if extractor_path.exists():
            subprocess.Popen([sys.executable, str(extractor_path)])
            self.log("Extractor abierto.")
        else:
            messagebox.showerror("Error", f"No se encontró: {extractor_path}")


# ---------------------------------------------------------------------------
# Punto de entrada
# ---------------------------------------------------------------------------

def main():
    if not HAS_MEDIAPIPE:
        print("Error: MediaPipe es requerido. Instala con: pip install mediapipe")
        return 1

    app = GestorPNGTuberApp()
    app.mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
