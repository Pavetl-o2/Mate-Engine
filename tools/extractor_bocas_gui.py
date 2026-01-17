#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
extractor_bocas_gui.py

Herramienta GUI para extraer sprites de boca (5 PNGs) desde un video.
Basado en MotionPNGTuber de rotejin.

Funciones:
1. Seleccionar video (arrastrar y soltar compatible)
2. Analizar video -> detectar boca y mostrar 20 candidatos
3. Asignar números 1-5 a los candidatos para cada tipo de boca
4. Ajustar recorte y difuminado
5. Exportar PNGs transparentes

Uso:
    python extractor_bocas_gui.py
"""

from __future__ import annotations

import os
import queue
import subprocess
import sys
import threading
import traceback
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

# Tkinter
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

# PIL para mostrar imágenes
try:
    from PIL import Image, ImageTk
    HAS_PIL = True
except ImportError:
    HAS_PIL = False
    print("[aviso] PIL no instalado. Preview limitado.")

# MediaPipe para detección de cara
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

APP_TITLE = "Extractor de Bocas - Mate Engine"
CANDIDATE_COUNT = 20
CANDIDATE_ROWS = 2
CANDIDATE_PER_ROW = CANDIDATE_COUNT // CANDIDATE_ROWS
THUMB_SIZE = 70
PREVIEW_SIZE = 120
DEFAULT_FEATHER = 15
DEFAULT_CROP = 0
MAX_CROP = 100
MAX_FEATHER = 40

# Índices de landmarks de boca (MediaPipe)
MOUTH_OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95]


# ---------------------------------------------------------------------------
# Clases de datos
# ---------------------------------------------------------------------------

class MouthFrameInfo:
    """Información de boca para un frame."""
    def __init__(self, frame_idx: int, quad: np.ndarray, width: float, height: float, valid: bool):
        self.frame_idx = frame_idx
        self.quad = quad
        self.width = width
        self.height = height
        self.valid = valid


# ---------------------------------------------------------------------------
# Funciones auxiliares
# ---------------------------------------------------------------------------

def create_checkerboard(w: int, h: int, cell_size: int = 10) -> np.ndarray:
    """Crear fondo de tablero de ajedrez para transparencia."""
    board = np.zeros((h, w, 3), dtype=np.uint8)
    for y in range(0, h, cell_size):
        for x in range(0, w, cell_size):
            if (x // cell_size + y // cell_size) % 2 == 0:
                board[y:y+cell_size, x:x+cell_size] = 200
            else:
                board[y:y+cell_size, x:x+cell_size] = 255
    return board


def composite_on_checkerboard(rgba: np.ndarray) -> np.ndarray:
    """Componer RGBA sobre tablero de ajedrez."""
    h, w = rgba.shape[:2]
    board = create_checkerboard(w, h)
    alpha = rgba[:, :, 3:4].astype(np.float32) / 255.0
    rgb = rgba[:, :, :3].astype(np.float32)
    result = board.astype(np.float32) * (1.0 - alpha) + rgb * alpha
    return result.astype(np.uint8)


def numpy_to_photoimage(img_bgr: np.ndarray, size: int) -> Optional["ImageTk.PhotoImage"]:
    """Convertir numpy BGR a PhotoImage."""
    if not HAS_PIL:
        return None
    rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    img = Image.fromarray(rgb)
    w, h = img.size
    scale = min(size / max(w, 1), size / max(h, 1))
    new_w = max(1, int(w * scale))
    new_h = max(1, int(h * scale))
    img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    return ImageTk.PhotoImage(img)


def quad_wh(quad: np.ndarray) -> Tuple[float, float]:
    """Calcular ancho y alto de un quad."""
    quad = np.asarray(quad, dtype=np.float32).reshape(4, 2)
    w = float(np.linalg.norm(quad[1] - quad[0]))
    h = float(np.linalg.norm(quad[3] - quad[0]))
    return w, h


def ensure_even(n: int) -> int:
    """Asegurar número par >= 2."""
    n = max(2, int(n))
    return n if (n % 2 == 0) else (n - 1)


def warp_frame_to_norm(frame_bgr: np.ndarray, quad: np.ndarray, norm_w: int, norm_h: int) -> np.ndarray:
    """Transformar región de boca a espacio normalizado."""
    src = np.asarray(quad, dtype=np.float32).reshape(4, 2)
    dst = np.array([
        [0, 0],
        [norm_w - 1, 0],
        [norm_w - 1, norm_h - 1],
        [0, norm_h - 1],
    ], dtype=np.float32)
    M = cv2.getPerspectiveTransform(src, dst)
    patch = cv2.warpPerspective(frame_bgr, M, (norm_w, norm_h),
                                 flags=cv2.INTER_LINEAR,
                                 borderMode=cv2.BORDER_REPLICATE)
    return patch


def make_ellipse_mask(w: int, h: int, rx: int, ry: int) -> np.ndarray:
    """Crear máscara elíptica."""
    mask = np.zeros((h, w), dtype=np.uint8)
    cx, cy = w // 2, h // 2
    rx = max(1, min(rx, w // 2 - 1))
    ry = max(1, min(ry, h // 2 - 1))
    cv2.ellipse(mask, (cx, cy), (rx, ry), 0.0, 0.0, 360.0, 255, -1)
    return mask


def feather_mask(mask_u8: np.ndarray, feather_px: int) -> np.ndarray:
    """Aplicar difuminado a máscara."""
    if feather_px <= 0:
        return (mask_u8.astype(np.float32) / 255.0).clip(0.0, 1.0)
    k = 2 * int(feather_px) + 1
    m = cv2.GaussianBlur(mask_u8, (k, k), sigmaX=0)
    return (m.astype(np.float32) / 255.0).clip(0.0, 1.0)


def extract_sprite_with_crop(
    frame_bgr: np.ndarray,
    quad: np.ndarray,
    unified_w: int,
    unified_h: int,
    crop_top: int = 0,
    crop_bottom: int = 0,
    crop_left: int = 0,
    crop_right: int = 0,
    feather_px: int = 15,
) -> np.ndarray:
    """Extraer sprite con recorte y difuminado."""
    patch = warp_frame_to_norm(frame_bgr, quad, unified_w, unified_h)

    cx = unified_w // 2 + (crop_left - crop_right) // 2
    cy = unified_h // 2 + (crop_top - crop_bottom) // 2
    rx = (unified_w - crop_left - crop_right) // 2
    ry = (unified_h - crop_top - crop_bottom) // 2
    rx = max(1, min(rx, unified_w // 2 - 1))
    ry = max(1, min(ry, unified_h // 2 - 1))

    mask = np.zeros((unified_h, unified_w), dtype=np.uint8)
    cv2.ellipse(mask, (cx, cy), (rx, ry), 0.0, 0.0, 360.0, 255, -1)
    mask_f = feather_mask(mask, feather_px)

    rgba = np.zeros((unified_h, unified_w, 4), dtype=np.uint8)
    rgba[:, :, :3] = patch
    rgba[:, :, 3] = (mask_f * 255).astype(np.uint8)

    return rgba


# ---------------------------------------------------------------------------
# Detector de boca
# ---------------------------------------------------------------------------

class MouthDetector:
    """Detector de boca usando MediaPipe."""

    def __init__(self):
        if not HAS_MEDIAPIPE:
            raise RuntimeError("MediaPipe no está instalado. Ejecuta: pip install mediapipe")

        if MEDIAPIPE_LEGACY:
            self.face_mesh = mp.solutions.face_mesh.FaceMesh(
                static_image_mode=False,
                max_num_faces=1,
                refine_landmarks=True,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5
            )
        else:
            # Tasks API
            from mediapipe.tasks import python
            from mediapipe.tasks.python import vision
            import urllib.request

            model_path = os.path.join(os.path.dirname(__file__), 'face_landmarker.task')
            if not os.path.exists(model_path):
                print("Descargando modelo de landmarks faciales...")
                url = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
                urllib.request.urlretrieve(url, model_path)

            base_options = python.BaseOptions(model_asset_path=model_path)
            options = vision.FaceLandmarkerOptions(
                base_options=base_options,
                running_mode=vision.RunningMode.IMAGE,
                num_faces=1,
                min_face_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            )
            self.face_landmarker = vision.FaceLandmarker.create_from_options(options)
            self.face_mesh = None

    def detect(self, frame: np.ndarray, padding: float = 0.3) -> Tuple[Optional[np.ndarray], bool]:
        """Detectar quad de boca."""
        h, w = frame.shape[:2]
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        landmarks = None

        if MEDIAPIPE_LEGACY and self.face_mesh:
            results = self.face_mesh.process(rgb)
            if results.multi_face_landmarks:
                landmarks = results.multi_face_landmarks[0].landmark
        elif hasattr(self, 'face_landmarker'):
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            results = self.face_landmarker.detect(mp_image)
            if results.face_landmarks:
                landmarks = results.face_landmarks[0]

        if landmarks is None:
            return None, False

        # Extraer puntos de boca
        mouth_points = []
        for idx in MOUTH_OUTER:
            lm = landmarks[idx]
            mouth_points.append([lm.x * w, lm.y * h])
        mouth_points = np.array(mouth_points)

        # Calcular bounding box
        x_min, y_min = mouth_points.min(axis=0)
        x_max, y_max = mouth_points.max(axis=0)

        width = x_max - x_min
        height = y_max - y_min
        pad_x = width * padding
        pad_y = height * padding

        quad = np.array([
            [x_min - pad_x, y_min - pad_y],
            [x_max + pad_x, y_min - pad_y],
            [x_max + pad_x, y_max + pad_y],
            [x_min - pad_x, y_max + pad_y]
        ], dtype=np.float32)

        return quad, True

    def close(self):
        if MEDIAPIPE_LEGACY and self.face_mesh:
            self.face_mesh.close()


# ---------------------------------------------------------------------------
# Aplicación GUI
# ---------------------------------------------------------------------------

class ExtractorBocasApp(tk.Tk):
    """Aplicación GUI para extraer sprites de boca."""

    def __init__(self):
        super().__init__()

        self.title(APP_TITLE)
        self.geometry("950x900")
        self.resizable(True, True)

        # Estado
        self.video_path: str = ""
        self.detector: Optional[MouthDetector] = None
        self.candidate_frames: List[MouthFrameInfo] = []
        self.candidate_images: List[Optional["ImageTk.PhotoImage"]] = []
        self.preview_sprites: Dict[str, np.ndarray] = {}
        self.preview_images: Dict[str, "ImageTk.PhotoImage"] = {}
        self.unified_size: Optional[Tuple[int, int]] = None
        self.is_analyzing = False
        self._cached_cap: Optional[cv2.VideoCapture] = None

        # Cola de logs
        self.log_queue: queue.Queue[str] = queue.Queue()

        # Construir UI
        self._build_ui()
        self._poll_logs()

    def _build_ui(self):
        """Construir interfaz de usuario."""
        # Frame principal con scroll
        container = ttk.Frame(self)
        container.pack(fill=tk.BOTH, expand=True)

        main_canvas = tk.Canvas(container, highlightthickness=0)
        main_scroll = ttk.Scrollbar(container, orient=tk.VERTICAL, command=main_canvas.yview)
        main_canvas.configure(yscrollcommand=main_scroll.set)
        main_scroll.pack(side=tk.RIGHT, fill=tk.Y)
        main_canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        main_frame = ttk.Frame(main_canvas, padding=10)
        main_window = main_canvas.create_window((0, 0), window=main_frame, anchor=tk.NW)

        main_frame.bind("<Configure>",
                        lambda e: main_canvas.configure(scrollregion=main_canvas.bbox("all")))
        main_canvas.bind("<Configure>",
                         lambda e: main_canvas.itemconfigure(main_window, width=e.width))

        # --- Selección de video ---
        video_frame = ttk.LabelFrame(main_frame, text="Archivo de Video", padding=5)
        video_frame.pack(fill=tk.X, pady=(0, 10))

        self.video_var = tk.StringVar()
        video_entry = ttk.Entry(video_frame, textvariable=self.video_var, state="readonly")
        video_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 5))

        video_btn = ttk.Button(video_frame, text="Seleccionar...", command=self._on_select_video)
        video_btn.pack(side=tk.RIGHT)

        # --- Botón de análisis ---
        self.analyze_btn = ttk.Button(main_frame, text="Analizar Video", command=self._on_analyze)
        self.analyze_btn.pack(fill=tk.X, pady=(0, 10))

        # --- Área de candidatos ---
        cand_frame = ttk.LabelFrame(
            main_frame,
            text="Candidatos - Asigna números 1-5 (1=abierta, 2=cerrada, 3=media, 4=e, 5=u)",
            padding=5,
        )
        cand_frame.pack(fill=tk.X, pady=(0, 10))

        cand_canvas = tk.Canvas(cand_frame, height=280)
        cand_canvas.pack(fill=tk.X, expand=True)

        self.cand_inner = ttk.Frame(cand_canvas)
        cand_canvas.create_window((0, 0), window=self.cand_inner, anchor=tk.NW)
        self.cand_inner.bind("<Configure>",
                             lambda e: cand_canvas.configure(scrollregion=cand_canvas.bbox("all")))

        # Slots de candidatos
        self.cand_labels: List[ttk.Label] = []
        self.cand_entries: List[ttk.Entry] = []
        self.cand_vars: List[tk.StringVar] = []
        self.cand_frame_labels: List[ttk.Label] = []

        for i in range(CANDIDATE_COUNT):
            row = i // CANDIDATE_PER_ROW
            col = i % CANDIDATE_PER_ROW

            col_frame = ttk.Frame(self.cand_inner)
            col_frame.grid(row=row, column=col, padx=3, pady=3, sticky=tk.N)

            thumb_label = ttk.Label(col_frame, text="", width=10, anchor=tk.CENTER, relief=tk.SUNKEN)
            thumb_label.pack()
            self.cand_labels.append(thumb_label)

            frame_label = ttk.Label(col_frame, text="", font=("", 8))
            frame_label.pack()
            self.cand_frame_labels.append(frame_label)

            var = tk.StringVar()
            entry = ttk.Entry(col_frame, textvariable=var, width=3, justify=tk.CENTER)
            entry.pack()
            self.cand_vars.append(var)
            self.cand_entries.append(entry)

        # --- Ajustes de recorte ---
        crop_frame = ttk.LabelFrame(main_frame, text="Recorte (eliminar márgenes)", padding=5)
        crop_frame.pack(fill=tk.X, pady=(0, 10))

        crop_grid = ttk.Frame(crop_frame)
        crop_grid.pack()

        self.crop_vars = {
            "top": tk.IntVar(value=DEFAULT_CROP),
            "bottom": tk.IntVar(value=DEFAULT_CROP),
            "left": tk.IntVar(value=DEFAULT_CROP),
            "right": tk.IntVar(value=DEFAULT_CROP),
        }
        self.crop_labels = {}

        ttk.Label(crop_grid, text="Arriba:").grid(row=0, column=0, sticky=tk.E)
        ttk.Scale(crop_grid, from_=0, to=MAX_CROP, variable=self.crop_vars["top"],
                  orient=tk.HORIZONTAL, length=100).grid(row=0, column=1)
        self.crop_labels["top"] = ttk.Label(crop_grid, text="0px", width=5)
        self.crop_labels["top"].grid(row=0, column=2)

        ttk.Label(crop_grid, text="Abajo:").grid(row=1, column=0, sticky=tk.E)
        ttk.Scale(crop_grid, from_=0, to=MAX_CROP, variable=self.crop_vars["bottom"],
                  orient=tk.HORIZONTAL, length=100).grid(row=1, column=1)
        self.crop_labels["bottom"] = ttk.Label(crop_grid, text="0px", width=5)
        self.crop_labels["bottom"].grid(row=1, column=2)

        ttk.Label(crop_grid, text="Izquierda:").grid(row=0, column=3, sticky=tk.E, padx=(20, 0))
        ttk.Scale(crop_grid, from_=0, to=MAX_CROP, variable=self.crop_vars["left"],
                  orient=tk.HORIZONTAL, length=100).grid(row=0, column=4)
        self.crop_labels["left"] = ttk.Label(crop_grid, text="0px", width=5)
        self.crop_labels["left"].grid(row=0, column=5)

        ttk.Label(crop_grid, text="Derecha:").grid(row=1, column=3, sticky=tk.E, padx=(20, 0))
        ttk.Scale(crop_grid, from_=0, to=MAX_CROP, variable=self.crop_vars["right"],
                  orient=tk.HORIZONTAL, length=100).grid(row=1, column=4)
        self.crop_labels["right"] = ttk.Label(crop_grid, text="0px", width=5)
        self.crop_labels["right"].grid(row=1, column=5)

        # --- Difuminado ---
        feather_frame = ttk.LabelFrame(main_frame, text="Difuminado de bordes", padding=5)
        feather_frame.pack(fill=tk.X, pady=(0, 10))

        self.feather_var = tk.IntVar(value=DEFAULT_FEATHER)
        self.feather_slider = ttk.Scale(feather_frame, from_=0, to=MAX_FEATHER,
                                         orient=tk.HORIZONTAL, variable=self.feather_var)
        self.feather_slider.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 10))

        self.feather_label = ttk.Label(feather_frame, text=f"{DEFAULT_FEATHER}px", width=6)
        self.feather_label.pack(side=tk.RIGHT)

        # --- Botón actualizar preview ---
        self.update_btn = ttk.Button(main_frame, text="Actualizar Vista Previa",
                                      command=self._on_update_preview, state=tk.DISABLED)
        self.update_btn.pack(fill=tk.X, pady=(0, 10))

        # --- Vista previa ---
        preview_frame = ttk.LabelFrame(main_frame, text="Vista Previa de Salida", padding=5)
        preview_frame.pack(fill=tk.X, pady=(0, 10))

        preview_inner = ttk.Frame(preview_frame)
        preview_inner.pack(expand=True)

        self.preview_labels: Dict[str, ttk.Label] = {}
        self.out_frame_labels: Dict[str, ttk.Label] = {}

        mouth_names = [("open", "Abierta"), ("closed", "Cerrada"), ("half", "Media"), ("e", "E"), ("u", "U")]

        for i, (name, display) in enumerate(mouth_names):
            col_frame = ttk.Frame(preview_inner)
            col_frame.grid(row=0, column=i, padx=5, pady=5)

            preview_label = ttk.Label(col_frame, text="(vacío)", width=12, anchor=tk.CENTER, relief=tk.SUNKEN)
            preview_label.pack()
            self.preview_labels[name] = preview_label

            name_label = ttk.Label(col_frame, text=display, font=("", 9, "bold"))
            name_label.pack()

            frame_label = ttk.Label(col_frame, text="", font=("", 8))
            frame_label.pack()
            self.out_frame_labels[name] = frame_label

        # --- Botón exportar ---
        self.output_btn = ttk.Button(main_frame, text="Exportar PNGs",
                                      command=self._on_output, state=tk.DISABLED)
        self.output_btn.pack(fill=tk.X, pady=(0, 10))

        # --- Área de log ---
        log_frame = ttk.LabelFrame(main_frame, text="Registro", padding=5)
        log_frame.pack(fill=tk.BOTH, expand=True)

        self.log_text = tk.Text(log_frame, height=6, state=tk.DISABLED, wrap=tk.WORD)
        self.log_text.pack(fill=tk.BOTH, expand=True, side=tk.LEFT)

        scrollbar = ttk.Scrollbar(log_frame, orient=tk.VERTICAL, command=self.log_text.yview)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        self.log_text.configure(yscrollcommand=scrollbar.set)

    def log(self, message: str):
        """Agregar mensaje al log."""
        self.log_queue.put(message)

    def _poll_logs(self):
        """Procesar cola de logs."""
        while not self.log_queue.empty():
            try:
                msg = self.log_queue.get_nowait()
                self.log_text.configure(state=tk.NORMAL)
                self.log_text.insert(tk.END, msg + "\n")
                self.log_text.see(tk.END)
                self.log_text.configure(state=tk.DISABLED)
            except queue.Empty:
                break

        # Actualizar etiquetas
        for key in self.crop_vars:
            self.crop_labels[key].configure(text=f"{self.crop_vars[key].get()}px")
        self.feather_label.configure(text=f"{self.feather_var.get()}px")

        self.after(100, self._poll_logs)

    def _on_select_video(self):
        """Seleccionar archivo de video."""
        path = filedialog.askopenfilename(
            title="Seleccionar Video",
            filetypes=[
                ("Archivos de video", "*.mp4 *.avi *.mov *.mkv *.webm"),
                ("Todos los archivos", "*.*"),
            ],
        )
        if path:
            self._set_video(path)

    def _set_video(self, path: str):
        """Establecer ruta de video."""
        self.video_path = path
        self.video_var.set(path)
        self.candidate_frames = []
        self._clear_candidates()
        self._clear_preview()
        self.update_btn.configure(state=tk.DISABLED)
        self.output_btn.configure(state=tk.DISABLED)

        if self._cached_cap:
            self._cached_cap.release()
            self._cached_cap = None

        self.log(f"Video seleccionado: {os.path.basename(path)}")

    def _clear_candidates(self):
        """Limpiar candidatos."""
        self.candidate_images = []
        for i in range(CANDIDATE_COUNT):
            self.cand_labels[i].configure(image="", text="")
            self.cand_frame_labels[i].configure(text="")
            self.cand_vars[i].set("")

    def _clear_preview(self):
        """Limpiar vista previa."""
        self.preview_images = {}
        for name, label in self.preview_labels.items():
            label.configure(image="", text="(vacío)")
            self.out_frame_labels[name].configure(text="")

    def _on_analyze(self):
        """Ejecutar análisis."""
        if not self.video_path:
            messagebox.showwarning("Aviso", "Selecciona un archivo de video primero")
            return

        if self.is_analyzing:
            return

        self.is_analyzing = True
        self.analyze_btn.configure(state=tk.DISABLED)
        self.update_btn.configure(state=tk.DISABLED)
        self.output_btn.configure(state=tk.DISABLED)
        self._clear_candidates()
        self._clear_preview()

        thread = threading.Thread(target=self._analyze_worker, daemon=True)
        thread.start()

    def _analyze_worker(self):
        """Worker de análisis en hilo separado."""
        try:
            self.log("Iniciando análisis...")

            # Crear detector
            self.detector = MouthDetector()

            # Abrir video
            cap = cv2.VideoCapture(self.video_path)
            if not cap.isOpened():
                self.log("Error: No se pudo abrir el video")
                return

            fps = cap.get(cv2.CAP_PROP_FPS)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            vid_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            vid_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            self.log(f"Video: {vid_w}x{vid_h} @ {fps:.1f}fps, {total_frames} frames")

            # Analizar frames (muestreo)
            sample_rate = max(1, total_frames // 100)  # ~100 muestras
            mouth_frames: List[MouthFrameInfo] = []

            frame_idx = 0
            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                if frame_idx % sample_rate == 0:
                    quad, valid = self.detector.detect(frame)
                    if valid and quad is not None:
                        w, h = quad_wh(quad)
                        mf = MouthFrameInfo(frame_idx, quad, w, h, valid)
                        mouth_frames.append(mf)

                    if frame_idx % (sample_rate * 10) == 0:
                        self.log(f"Analizando frame {frame_idx}/{total_frames}...")

                frame_idx += 1

            cap.release()
            self.detector.close()

            if len(mouth_frames) < 5:
                self.log("Error: No se detectaron suficientes bocas")
                return

            self.log(f"Detectadas {len(mouth_frames)} bocas válidas")

            # Seleccionar candidatos variados
            candidates = self._select_varied_candidates(mouth_frames, CANDIDATE_COUNT)
            self.candidate_frames = candidates

            # Calcular tamaño unificado
            max_w = max(mf.width for mf in mouth_frames)
            max_h = max(mf.height for mf in mouth_frames)
            self.unified_size = (ensure_even(int(max_w * 1.2)), ensure_even(int(max_h * 1.2)))

            # Generar miniaturas
            self.log("Generando miniaturas...")
            self._generate_thumbnails()

            self.after(0, self._update_candidates_ui)
            self.after(0, lambda: self.update_btn.configure(state=tk.NORMAL))

            self.log(f"Análisis completo. {len(self.candidate_frames)} candidatos mostrados.")
            self.log("Asigna números 1-5 a los candidatos y presiona 'Actualizar Vista Previa'")

        except Exception as e:
            self.log(f"Error: {e}")
            traceback.print_exc()

        finally:
            self.is_analyzing = False
            self.after(0, lambda: self.analyze_btn.configure(state=tk.NORMAL))

    def _select_varied_candidates(self, mouth_frames: List[MouthFrameInfo], count: int) -> List[MouthFrameInfo]:
        """Seleccionar candidatos variados por altura de boca."""
        if len(mouth_frames) <= count:
            return mouth_frames

        heights = np.array([mf.height for mf in mouth_frames])
        widths = np.array([mf.width for mf in mouth_frames])

        candidates = []
        used = set()

        def pick_by_score(scores, n, maximize=True):
            sorted_idx = np.argsort(scores)
            if maximize:
                sorted_idx = sorted_idx[::-1]
            picked = 0
            for idx in sorted_idx:
                if idx not in used and picked < n:
                    used.add(idx)
                    candidates.append(mouth_frames[idx])
                    picked += 1
                if picked >= n:
                    break

        # Seleccionar por categorías
        pick_by_score(heights, 4, maximize=True)   # Abiertas
        pick_by_score(heights, 4, maximize=False)  # Cerradas

        median_h = np.median(heights)
        half_scores = -np.abs(heights - median_h)
        pick_by_score(half_scores, 4, maximize=True)  # Medias

        aspect_ratios = widths / np.maximum(heights, 1e-6)
        pick_by_score(aspect_ratios, 4, maximize=True)  # Anchas (E)
        pick_by_score(widths, 4, maximize=False)  # Estrechas (U)

        return candidates[:count]

    def _get_video_capture(self) -> cv2.VideoCapture:
        """Obtener VideoCapture en cache."""
        if self._cached_cap is None or not self._cached_cap.isOpened():
            self._cached_cap = cv2.VideoCapture(self.video_path)
        return self._cached_cap

    def _generate_thumbnails(self):
        """Generar miniaturas de candidatos."""
        if not self.candidate_frames or not self.unified_size:
            return

        cap = self._get_video_capture()
        unified_w, unified_h = self.unified_size

        self.candidate_images = []
        for mf in self.candidate_frames:
            cap.set(cv2.CAP_PROP_POS_FRAMES, float(mf.frame_idx))
            ok, frame = cap.read()
            if not ok:
                self.candidate_images.append(None)
                continue

            patch = warp_frame_to_norm(frame, mf.quad, unified_w, unified_h)
            photo = numpy_to_photoimage(patch, THUMB_SIZE)
            self.candidate_images.append(photo)

    def _update_candidates_ui(self):
        """Actualizar UI de candidatos."""
        for i, mf in enumerate(self.candidate_frames):
            if i < len(self.candidate_images) and self.candidate_images[i]:
                self.cand_labels[i].configure(image=self.candidate_images[i], text="")
            self.cand_frame_labels[i].configure(text=f"F:{mf.frame_idx}")

    def _on_update_preview(self):
        """Actualizar vista previa."""
        if not self.candidate_frames or not self.unified_size:
            messagebox.showwarning("Aviso", "Primero analiza un video")
            return

        # Parsear asignaciones
        assignments = {}
        mouth_names = {1: "open", 2: "closed", 3: "half", 4: "e", 5: "u"}

        for i, var in enumerate(self.cand_vars):
            val = var.get().strip()
            # Convertir números de ancho completo
            val = val.translate(str.maketrans("１２３４５", "12345"))
            if val.isdigit():
                num = int(val)
                if 1 <= num <= 5:
                    if i >= len(self.candidate_frames):
                        continue
                    assignments[num] = i

        if len(assignments) == 0:
            messagebox.showwarning("Aviso", "Asigna números 1-5 a los candidatos")
            return

        # Parámetros
        crop_top = self.crop_vars["top"].get()
        crop_bottom = self.crop_vars["bottom"].get()
        crop_left = self.crop_vars["left"].get()
        crop_right = self.crop_vars["right"].get()
        feather_px = self.feather_var.get()

        unified_w, unified_h = self.unified_size
        cap = self._get_video_capture()

        self.preview_sprites = {}
        self._clear_preview()

        for num, cand_idx in assignments.items():
            name = mouth_names[num]
            mf = self.candidate_frames[cand_idx]

            cap.set(cv2.CAP_PROP_POS_FRAMES, float(mf.frame_idx))
            ok, frame = cap.read()
            if not ok:
                continue

            rgba = extract_sprite_with_crop(
                frame, mf.quad, unified_w, unified_h,
                crop_top, crop_bottom, crop_left, crop_right, feather_px
            )
            self.preview_sprites[name] = rgba

            composited = composite_on_checkerboard(rgba)
            photo = numpy_to_photoimage(composited, PREVIEW_SIZE)
            if photo:
                self.preview_images[name] = photo
                self.preview_labels[name].configure(image=photo, text="")
                self.out_frame_labels[name].configure(text=f"F:{mf.frame_idx}")

        self.output_btn.configure(state=tk.NORMAL)
        self.log(f"Vista previa actualizada ({len(self.preview_sprites)} sprites)")

    def _on_output(self):
        """Exportar sprites."""
        if not self.preview_sprites:
            messagebox.showwarning("Aviso", "Primero actualiza la vista previa")
            return

        # Determinar directorio de salida
        video_dir = os.path.dirname(os.path.abspath(self.video_path))
        output_dir = os.path.join(video_dir, "mouths")

        # Si ya existe, agregar sufijo
        if os.path.exists(output_dir):
            i = 1
            while os.path.exists(f"{output_dir}_{i:03d}"):
                i += 1
            output_dir = f"{output_dir}_{i:03d}"

        try:
            os.makedirs(output_dir, exist_ok=True)

            for name, rgba in self.preview_sprites.items():
                filepath = os.path.join(output_dir, f"{name}.png")
                cv2.imwrite(filepath, rgba)
                self.log(f"Guardado: {name}.png")

            self.log(f"Exportación completa: {output_dir}")

            if messagebox.askyesno("Completado",
                                    f"Sprites exportados a:\n{output_dir}\n\n¿Abrir carpeta?"):
                if sys.platform.startswith("win"):
                    os.startfile(output_dir)
                elif sys.platform == "darwin":
                    subprocess.Popen(["open", output_dir])
                else:
                    subprocess.Popen(["xdg-open", output_dir])

        except Exception as e:
            self.log(f"Error al exportar: {e}")
            messagebox.showerror("Error", str(e))

    def destroy(self):
        """Limpiar recursos."""
        if self._cached_cap:
            self._cached_cap.release()
        super().destroy()


# ---------------------------------------------------------------------------
# Punto de entrada
# ---------------------------------------------------------------------------

def main():
    """Función principal."""
    if not HAS_PIL:
        print("Error: PIL/Pillow es requerido. Instala con: pip install pillow")
        return 1

    if not HAS_MEDIAPIPE:
        print("Error: MediaPipe es requerido. Instala con: pip install mediapipe")
        return 1

    app = ExtractorBocasApp()
    app.mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
