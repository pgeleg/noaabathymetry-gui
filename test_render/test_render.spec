# -*- mode: python ; coding: utf-8 -*-
import os
import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

env = Path(sys.prefix)
if sys.platform == "win32":
    gdal_data = env / "Library" / "share" / "gdal"
    proj_data = env / "Library" / "share" / "proj"
else:
    gdal_data = env / "share" / "gdal"
    proj_data = env / "share" / "proj"

datas = [
    ("leaflet/index.html", "leaflet"),
    ("maplibre/index.html", "maplibre"),
    (str(gdal_data), "share/gdal"),
    (str(proj_data), "share/proj"),
]
datas += collect_data_files("botocore")
datas += collect_data_files("certifi")

hiddenimports = [
    *collect_submodules("nbs.noaabathymetry"),
    "osgeo", "osgeo.gdal", "osgeo.ogr", "osgeo.osr",
    *collect_submodules("boto3"),
    *collect_submodules("botocore"),
    "PySide6.QtWebEngineWidgets",
    "PySide6.QtWebEngineCore",
    "PySide6.QtWebChannel",
]

runtime_hook = os.path.join("build", "_rthook.py")
os.makedirs("build", exist_ok=True)
with open(runtime_hook, "w") as f:
    f.write('import os,sys\n')
    f.write('if getattr(sys,"_MEIPASS",None):\n')
    f.write('  os.environ.setdefault("GDAL_DATA",os.path.join(sys._MEIPASS,"share","gdal"))\n')
    f.write('  os.environ.setdefault("PROJ_LIB",os.path.join(sys._MEIPASS,"share","proj"))\n')

a = Analysis(
    ["run.py"],
    datas=datas,
    hiddenimports=hiddenimports,
    runtime_hooks=[runtime_hook],
    excludes=["tkinter", "matplotlib"],
)

pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="RenderTest", console=False)
coll = COLLECT(exe, a.binaries, a.datas, name="RenderTest")

if sys.platform == "darwin":
    app = BUNDLE(coll, name="RenderTest.app")
