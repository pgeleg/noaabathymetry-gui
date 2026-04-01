"""Render test — launch with 'leaflet' or 'maplibre' argument."""

import json
import os
import sys
import threading

from PySide6.QtCore import QObject, QUrl, Signal, Slot
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWebEngineCore import QWebEngineSettings
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QApplication, QMainWindow

from osgeo import gdal, ogr

from nbs.noaabathymetry._internal.config import resolve_data_source
from nbs.noaabathymetry._internal.download import _get_s3_client, _list_s3_latest


def _gpkg_to_geojson(ds):
    lyr = ds.GetLayer()
    defn = lyr.GetLayerDefn()
    features = []
    for ft in lyr:
        geom = ft.GetGeometryRef()
        if geom is None:
            continue
        geom = geom.SimplifyPreserveTopology(0.001)
        props = {}
        for i in range(defn.GetFieldCount()):
            name = defn.GetFieldDefn(i).name
            props[name] = ft.GetField(name)
        features.append({
            "type": "Feature",
            "geometry": json.loads(geom.ExportToJson()),
            "properties": props,
        })
    return {"type": "FeatureCollection", "features": features}


class Bridge(QObject):
    layers_ready = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.layers_ready.connect(self._push)

    def _push(self, data):
        self.parent().web.page().runJavaScript(f"onLayersReady({data})")

    @Slot(str)
    def load_remote_layer(self, data_source):
        def worker():
            try:
                cfg, _ = resolve_data_source(data_source or "bluetopo")
                gdal.SetConfigOption("AWS_NO_SIGN_REQUEST", "YES")
                bucket = cfg["bucket"]
                prefix = cfg["geom_prefix"]
                client = _get_s3_client()
                key, _ = _list_s3_latest(client, bucket, prefix, "geometry", cfg["canonical_name"], retry=True)
                if key is None:
                    self.layers_ready.emit(json.dumps({"error": "No tile scheme found"}))
                    return
                url = f"/vsicurl/https://{bucket}.s3.amazonaws.com/{key}"
                mem = f"/vsimem/_test_{threading.get_ident()}.gpkg"
                gdal.CopyFile(url, mem)
                try:
                    ds = ogr.Open(mem)
                    geojson = _gpkg_to_geojson(ds)
                    ds = None
                    self.layers_ready.emit(json.dumps({"layer": "remote", "data": geojson}))
                finally:
                    gdal.Unlink(mem)
            except Exception as e:
                self.layers_ready.emit(json.dumps({"error": str(e)}))
        threading.Thread(target=worker, daemon=True).start()


class Window(QMainWindow):
    def __init__(self, html_dir):
        super().__init__()
        self.setWindowTitle(f"Render Test — {os.path.basename(html_dir)}")
        self.resize(1200, 800)
        self.web = QWebEngineView()
        self.setCentralWidget(self.web)
        self.web.settings().setAttribute(
            QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True)
        self.bridge = Bridge(self)
        self.channel = QWebChannel()
        self.channel.registerObject("bridge", self.bridge)
        self.web.page().setWebChannel(self.channel)
        self.web.setUrl(QUrl.fromLocalFile(os.path.join(html_dir, "index.html")))

    def closeEvent(self, event):
        event.accept()
        os._exit(0)


if __name__ == "__main__":
    renderer = sys.argv[1] if len(sys.argv) > 1 else "leaflet"
    html_dir = os.path.join(os.path.dirname(__file__), renderer)
    if not os.path.isdir(html_dir):
        print(f"Unknown renderer: {renderer}. Use 'leaflet' or 'maplibre'.")
        sys.exit(1)
    app = QApplication(sys.argv)
    win = Window(html_dir)
    win.show()
    sys.exit(app.exec())
