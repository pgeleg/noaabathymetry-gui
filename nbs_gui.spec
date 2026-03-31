# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for National Bathymetric Source GUI.

Cross-platform: produces a .app bundle on macOS, a folder on Windows.

Usage:
    pyinstaller nbs_gui.spec
"""

import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

# ── Platform ──────────────────────────────────────────

is_mac = sys.platform == "darwin"
is_win = sys.platform == "win32"

# ── Paths ──────────────────────────────────────────────

env = Path(sys.prefix)
src_dir = Path("src")
web_dir = src_dir / "web"

# conda on Windows puts share data under Library/
if is_win:
    gdal_data = env / "Library" / "share" / "gdal"
    proj_data = env / "Library" / "share" / "proj"
else:
    gdal_data = env / "share" / "gdal"
    proj_data = env / "share" / "proj"

# ── Data files ─────────────────────────────────────────

datas = [
    # Web assets
    (str(web_dir / "index.html"), "src/web"),
    (str(web_dir / "styles.css"), "src/web"),
    (str(web_dir / "map.js"), "src/web"),
    (str(web_dir / "panels.js"), "src/web"),
    # GDAL + PROJ data
    (str(gdal_data), "share/gdal"),
    (str(proj_data), "share/proj"),
]

# botocore ships JSON data files that must be bundled
datas += collect_data_files("botocore")
datas += collect_data_files("certifi")

# ── Hidden imports ─────────────────────────────────────

hiddenimports = [
    # noaabathymetry internals
    *collect_submodules("nbs.noaabathymetry"),
    # GDAL/OGR
    "osgeo",
    "osgeo.gdal",
    "osgeo.ogr",
    "osgeo.osr",
    # boto3/botocore
    *collect_submodules("boto3"),
    *collect_submodules("botocore"),
    # PySide6 WebEngine
    "PySide6.QtWebEngineWidgets",
    "PySide6.QtWebEngineCore",
    "PySide6.QtWebChannel",
    # tqdm
    "tqdm",
]

# ── Runtime hooks ──────────────────────────────────────
# Set GDAL_DATA and PROJ_LIB at runtime so GDAL/PROJ find
# their data files inside the bundled app.

runtime_hook_content = '''
import os, sys
if getattr(sys, '_MEIPASS', None):
    base = sys._MEIPASS
    os.environ.setdefault("GDAL_DATA", os.path.join(base, "share", "gdal"))
    os.environ.setdefault("PROJ_LIB", os.path.join(base, "share", "proj"))
'''

runtime_hook_path = os.path.join("build", "_rthook_gdal.py")
os.makedirs("build", exist_ok=True)
with open(runtime_hook_path, "w") as f:
    f.write(runtime_hook_content)

# ── Icon ──────────────────────────────────────────────

if is_mac and os.path.exists("assets/NOAA.icns"):
    exe_icon = "assets/NOAA.icns"
elif is_win and os.path.exists("assets/NOAA.ico"):
    exe_icon = "assets/NOAA.ico"
elif os.path.exists("assets/NOAA-1.png"):
    exe_icon = "assets/NOAA-1.png"
else:
    exe_icon = None

# ── Analysis ───────────────────────────────────────────

a = Analysis(
    ["src/main.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[runtime_hook_path],
    excludes=[
        "tkinter",
        "matplotlib",
        "numpy.distutils",
        "test",
        "unittest",
        # Unused PySide6/Qt modules
        "PySide6.Qt3D",
        "PySide6.QtBluetooth",
        "PySide6.QtCharts",
        "PySide6.QtDataVisualization",
        "PySide6.QtGraphs",
        "PySide6.QtMultimedia",
        "PySide6.QtNfc",
        "PySide6.QtQuick3D",
        "PySide6.QtRemoteObjects",
        "PySide6.QtSensors",
        "PySide6.QtSerialPort",
        "PySide6.QtShaderTools",
        "PySide6.QtSpatialAudio",
        "PySide6.QtSvg",
        "PySide6.QtTest",
        "PySide6.QtTextToSpeech",
        "PySide6.QtVirtualKeyboard",
        "PySide6.Qt3DAnimation",
        "PySide6.Qt3DCore",
        "PySide6.Qt3DExtras",
        "PySide6.Qt3DInput",
        "PySide6.Qt3DLogic",
        "PySide6.Qt3DRender",
    ],
    noarchive=False,
)

# Remove unused Qt frameworks/libs to reduce size and startup time
_qt_exclude = {
    "Qt3D", "QtBluetooth", "QtCharts", "QtDataVisualization", "QtGraphs",
    "QtMultimedia", "QtNfc", "QtQuick3D", "QtRemoteObjects", "QtSensors",
    "QtSerialPort", "QtShaderTools", "QtSpatialAudio", "QtSvg", "QtTest",
    "QtTextToSpeech", "QtVirtualKeyboard", "Qt3DAnimation", "Qt3DCore",
    "Qt3DExtras", "Qt3DInput", "Qt3DLogic", "Qt3DRender", "QtPdf",
    "QtQuickControls2Imagine", "QtQuickDialogs2QuickImpl",
    "QtQuickTemplates2", "QtQuickParticles",
}

def _should_keep(name):
    for ex in _qt_exclude:
        if ex in name:
            return False
    return True

a.binaries = [b for b in a.binaries if _should_keep(b[0])]
a.datas = [d for d in a.datas if _should_keep(d[0])]

# Also remove qml directory — we don't use QML
a.datas = [d for d in a.datas if "/qml/" not in d[0] and "\\qml\\" not in d[0]]

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="NBS Bathymetry",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    icon=exe_icon,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="NBS Bathymetry",
)

# macOS: wrap in .app bundle
if is_mac:
    app = BUNDLE(
        coll,
        name="National Bathymetric Source.app",
        icon="assets/NOAA.icns" if os.path.exists("assets/NOAA.icns") else None,
        bundle_identifier="gov.noaa.nbs.bathymetry",
    )
