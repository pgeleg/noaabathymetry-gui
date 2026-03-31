"""Python <-> JavaScript bridge via QWebChannel.

Commands run in background threads to keep the UI responsive.
Log output is streamed to JS in real-time via signals.
"""

import dataclasses
import hashlib
import io
import json
import logging
import os
import sys
import threading
from pathlib import Path

from PySide6.QtCore import QObject, Slot, Signal
from PySide6.QtWidgets import QFileDialog

from osgeo import gdal, ogr

from nbs.noaabathymetry import fetch_tiles, mosaic_tiles, status_tiles
from nbs.noaabathymetry._internal.config import resolve_data_source
from nbs.noaabathymetry._internal.download import _get_s3_client, _list_s3_latest


class _LogCapture(logging.Handler):
    """Logging handler that forwards records to a callback."""

    def __init__(self, callback):
        super().__init__()
        self.callback = callback

    def emit(self, record):
        try:
            msg = self.format(record)
            self.callback(msg)
        except Exception:
            pass


class _StderrCapture(io.TextIOBase):
    """Captures stderr writes (tqdm) and forwards to a callback.

    tqdm uses \\r to overwrite lines. We track the current line
    and send updates when meaningful content changes.
    """

    def __init__(self, callback, original):
        self._callback = callback
        self._original = original
        self._current = ""

    def write(self, s):
        if not s:
            return 0
        # tqdm uses \r to reset the line
        if "\r" in s:
            parts = s.split("\r")
            for part in parts:
                if part.strip():
                    self._current = part
            if self._current.strip():
                self._callback(self._current.rstrip())
        elif "\n" in s:
            lines = s.split("\n")
            for line in lines:
                if line.strip():
                    self._callback(line.rstrip())
            self._current = ""
        else:
            self._current += s
        return len(s)

    def flush(self):
        pass

    def isatty(self):
        return True  # Tell tqdm we're a terminal so it renders progress


_RECENTS_DIR = Path.home() / ".noaabathymetry"
_RECENTS_FILE = _RECENTS_DIR / "recents.json"
_MAX_RECENTS = 10


def _load_recents():
    """Load recent project directories from disk."""
    try:
        if _RECENTS_FILE.is_file():
            return json.loads(_RECENTS_FILE.read_text())[:_MAX_RECENTS]
    except Exception:
        pass
    return []


def _save_recents(recents):
    """Save recent project directories to disk."""
    try:
        _RECENTS_DIR.mkdir(parents=True, exist_ok=True)
        _RECENTS_FILE.write_text(json.dumps(recents[:_MAX_RECENTS]))
    except Exception:
        pass


def _add_recent(path, data_source=None):
    """Add a directory + source to the top of recents, deduplicating by the pair."""
    recents = _load_recents()
    path = os.path.normpath(path)
    source = data_source or "bluetopo"
    # Migrate old string entries to dict format
    recents = [r if isinstance(r, dict) else {"path": r, "source": "bluetopo"} for r in recents]
    recents = [r for r in recents
               if not (os.path.normpath(r["path"]) == path and r.get("source") == source)]
    recents.insert(0, {"path": path, "source": source})
    _save_recents(recents[:_MAX_RECENTS])


def _gpkg_to_geojson(ds, simplify_tolerance=0.001):
    """Convert an open OGR datasource to a GeoJSON FeatureCollection dict.

    Simplifies geometries to reduce vertex count for faster map rendering.
    Tolerance is in the layer's CRS units (degrees for EPSG:4326).
    """
    lyr = ds.GetLayer()
    defn = lyr.GetLayerDefn()
    features = []
    for ft in lyr:
        geom = ft.GetGeometryRef()
        if geom is None:
            continue
        if simplify_tolerance:
            geom = geom.SimplifyPreserveTopology(simplify_tolerance)
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


# ETag cache: {source_name: {"etag": str, "geojson": dict}}
_etag_cache = {}


def _get_remote_etag(client, bucket, key):
    """HEAD request to get ETag. Returns None on any error."""
    try:
        resp = client.head_object(Bucket=bucket, Key=key)
        etag = resp.get("ETag", "").strip('"')
        if not etag or "-" in etag:
            return None
        return etag
    except Exception:
        return None


def _read_remote_geojson(cfg):
    """Download the remote tile scheme to /vsimem/ and return GeoJSON.

    Uses a 2-tier cache:
    1. ETag check via HEAD — if matches stored, return cached GeoJSON.
    2. Full download — verify MD5 matches ETag before storing.
    """
    gdal.SetConfigOption("AWS_NO_SIGN_REQUEST", "YES")

    bucket = cfg["bucket"]
    prefix = cfg["geom_prefix"]
    data_source = cfg["canonical_name"]

    client = _get_s3_client()
    source_key, _ = _list_s3_latest(
        client, bucket, prefix, "geometry", data_source, retry=True)
    if source_key is None:
        return None, False

    # Tier 2: ETag check — if we have a stored ETag, compare via HEAD
    cached = _etag_cache.get(data_source)
    if cached and cached.get("etag"):
        try:
            remote_etag = _get_remote_etag(client, bucket, source_key)
            if remote_etag and remote_etag == cached["etag"]:
                return cached["geojson"], True
        except Exception:
            pass  # Any error → fall through to full download

    # Full download — unique path to avoid /vsimem/ collisions across threads
    remote_url = f"/vsicurl/https://{bucket}.s3.amazonaws.com/{source_key}"
    mem_path = f"/vsimem/_gui_remote_{threading.get_ident()}.gpkg"
    ret = gdal.CopyFile(remote_url, mem_path)
    if ret != 0:
        return None, False

    try:
        ds = ogr.Open(mem_path)
        if ds is None:
            return None, False
        result = _gpkg_to_geojson(ds)
        ds = None

        # Verify MD5 matches ETag before storing
        try:
            f = gdal.VSIFOpenL(mem_path, "rb")
            raw = gdal.VSIFReadL(1, gdal.VSIStatL(mem_path).size, f)
            gdal.VSIFCloseL(f)
            md5 = hashlib.md5(raw).hexdigest()
            remote_etag = _get_remote_etag(client, bucket, source_key)
            if remote_etag and md5 == remote_etag:
                _etag_cache[data_source] = {"etag": remote_etag, "geojson": result}
            else:
                _etag_cache.pop(data_source, None)
        except Exception:
            _etag_cache.pop(data_source, None)

        return result, False
    finally:
        gdal.Unlink(mem_path)


class Bridge(QObject):
    """Exposed to JavaScript as ``window.bridge``."""

    # Signals for thread -> main thread communication
    log_line = Signal(str)
    command_done = Signal(str)  # JSON result
    layers_ready = Signal(str)  # JSON with remote/local GeoJSON

    def __init__(self, parent=None):
        super().__init__(parent)
        self._running = False
        self._lock = threading.Lock()

        # Connect signals to JS push methods
        self.log_line.connect(self._push_log)
        self.command_done.connect(self._push_result)
        self.layers_ready.connect(self._push_layers)

    def _push_log(self, line):
        """Push a log line to JS."""
        escaped = json.dumps(line)
        self.parent().web.page().runJavaScript(f"onLogLine({escaped})")

    def _push_result(self, result_json):
        """Push the final result to JS."""
        self.parent().web.page().runJavaScript(f"onCommandDone({result_json})")

    def _push_layers(self, layers_json):
        """Push layer GeoJSON data to JS."""
        self.parent().web.page().runJavaScript(f"onLayersReady({layers_json})")

    def _run_in_thread(self, fn, project_dir=None, data_source=None):
        """Run a function in a daemon thread with log capture."""
        with self._lock:
            if self._running:
                self.command_done.emit(
                    json.dumps({"ok": False, "error": "A command is already running."}))
                return
            self._running = True

        def worker():
            # Capture logger output
            logger = logging.getLogger("noaabathymetry")
            handler = _LogCapture(lambda msg: self.log_line.emit(msg))
            handler.setFormatter(logging.Formatter("[%(asctime)s] %(message)s", "%H:%M:%S"))
            logger.addHandler(handler)
            # Capture stderr (tqdm writes here directly, bypassing the logger)
            old_stderr = sys.stderr
            sys.stderr = _StderrCapture(
                lambda msg: self.log_line.emit(msg), old_stderr)
            try:
                result = fn()
                if project_dir:
                    _add_recent(project_dir, data_source)
                self.command_done.emit(
                    json.dumps({"ok": True, "result": dataclasses.asdict(result)}))
            except Exception as e:
                self.command_done.emit(
                    json.dumps({"ok": False, "error": str(e)}))
            finally:
                sys.stderr = old_stderr
                logger.removeHandler(handler)
                with self._lock:
                    self._running = False

        t = threading.Thread(target=worker, daemon=True)
        t.start()

    @Slot(str, str, str, str)
    def fetch(self, project_dir, geometry, data_source, resolution_filter):
        """Run fetch_tiles in a background thread."""
        geometry = geometry if geometry else None
        data_source = data_source if data_source else None
        res_filter = None
        if resolution_filter:
            try:
                res_filter = [float(r.strip()) for r in resolution_filter.split(",") if r.strip()]
            except ValueError:
                res_filter = None
        self._run_in_thread(lambda: fetch_tiles(
            project_dir=project_dir,
            geometry=geometry,
            data_source=data_source,
            tile_resolution_filter=res_filter or None,
        ), project_dir=project_dir, data_source=data_source)

    @Slot(str, str, str)
    def mosaic(self, project_dir, data_source, options_json):
        """Run mosaic_tiles in a background thread."""
        data_source = data_source if data_source else None
        opts = json.loads(options_json) if options_json else {}
        self._run_in_thread(lambda: mosaic_tiles(
            project_dir=project_dir,
            data_source=data_source,
            hillshade=opts.get("hillshade", False),
            reproject=opts.get("reproject", False),
            workers=opts.get("workers") or None,
            mosaic_resolution_target=opts.get("resolution_target") or None,
        ), project_dir=project_dir, data_source=data_source)

    @Slot(result=int)
    def get_cpu_count(self):
        """Return the number of CPUs available."""
        return os.cpu_count() or 1

    @Slot(str)
    def save_basemap(self, basemap_name):
        """Update the most recent entry's basemap preference."""
        recents = _load_recents()
        if recents:
            recents[0] = recents[0] if isinstance(recents[0], dict) else {"path": recents[0], "source": "bluetopo"}
            recents[0]["basemap"] = basemap_name
            _save_recents(recents)

    @Slot(result=str)
    def get_recents(self):
        """Return recent project directories as JSON array."""
        return json.dumps(_load_recents())

    @Slot(str)
    def remove_recent(self, path):
        """Remove a directory from recents."""
        recents = _load_recents()
        norm = os.path.normpath(path)
        recents = [r for r in recents
                   if os.path.normpath(r["path"] if isinstance(r, dict) else r) != norm]
        _save_recents(recents)

    @Slot(result=str)
    def browse_directory(self):
        """Open a native folder picker and return the selected path."""
        path = QFileDialog.getExistingDirectory(None, "Select Project Directory")
        return path or ""

    @Slot(result=str)
    def browse_geometry(self):
        """Open a file picker for geometry files."""
        path, _ = QFileDialog.getOpenFileName(
            None, "Select Geometry File", "",
            "All Supported (*.gpkg *.shp *.geojson *.json *.kml);;GeoPackage (*.gpkg);;Shapefile (*.shp);;GeoJSON (*.geojson *.json);;KML (*.kml);;All Files (*)")
        return path or ""

    @Slot(str, result=str)
    def complete_path(self, partial):
        """Return directory completions for a partial path as JSON array."""
        import os
        partial = os.path.expanduser(partial)
        if not partial:
            return json.dumps([])
        parent = os.path.dirname(partial)
        prefix = os.path.basename(partial).lower()
        if not parent:
            parent = "/"
        if not os.path.isdir(parent):
            return json.dumps([])
        try:
            entries = [
                os.path.join(parent, e)
                for e in sorted(os.listdir(parent))
                if e.lower().startswith(prefix)
                and os.path.isdir(os.path.join(parent, e))
                and not e.startswith(".")
            ]
            if len(entries) == 1 and entries[0] == partial.rstrip("/"):
                child_dir = entries[0]
                children = [
                    os.path.join(child_dir, e)
                    for e in sorted(os.listdir(child_dir))
                    if os.path.isdir(os.path.join(child_dir, e))
                    and not e.startswith(".")
                ]
                return json.dumps(children[:10])
            return json.dumps(entries[:10])
        except OSError:
            return json.dumps([])

    @Slot(str)
    def load_remote_layer(self, data_source):
        """Load the remote tile scheme geopackage for a data source."""
        data_source = data_source if data_source else None

        def worker():
            try:
                cfg, _ = resolve_data_source(data_source)
                if not cfg.get("geom_prefix"):
                    self.layers_ready.emit(json.dumps(
                        {"layer": "remote", "error": "No remote scheme for this source"}))
                    return
                geojson, from_cache = _read_remote_geojson(cfg)
                if geojson:
                    self.layers_ready.emit(json.dumps(
                        {"layer": "remote", "data": geojson, "cached": from_cache}))
                else:
                    self.layers_ready.emit(json.dumps(
                        {"layer": "remote", "error": "Could not read remote scheme"}))
            except Exception as e:
                self.layers_ready.emit(json.dumps(
                    {"layer": "remote", "error": str(e)}))

        t = threading.Thread(target=worker, daemon=True)
        t.start()

    @Slot(str, str)
    def load_tracked_layer(self, project_dir, data_source):
        """Run status_tiles and return classified tiles with geometries."""
        data_source = data_source if data_source else None

        def worker():
            try:
                project_dir_expanded = os.path.expanduser(project_dir)
                result = status_tiles(
                    project_dir=project_dir_expanded,
                    data_source=data_source,
                    verbosity="quiet",
                )

                categories = {
                    "up_to_date": result.up_to_date,
                    "updates_available": result.updates_available,
                    "missing_from_disk": result.missing_from_disk,
                    "removed_from_scheme": result.removed_from_scheme,
                }
                layers = {}
                for cat, tiles in categories.items():
                    features = []
                    for t in tiles:
                        geom = t.get("geometry")
                        if geom is None:
                            continue
                        # geometry may be a JSON string from SQLite
                        if isinstance(geom, str):
                            geom = json.loads(geom)
                        props = {k: v for k, v in t.items() if k != "geometry"}
                        features.append({
                            "type": "Feature",
                            "geometry": geom,
                            "properties": props,
                        })
                    layers[cat] = {
                        "type": "FeatureCollection",
                        "features": features,
                    }

                self.layers_ready.emit(json.dumps({
                    "layer": "tracked",
                    "data": layers,
                    "total": result.total_tracked,
                }))
            except Exception as e:
                self.layers_ready.emit(json.dumps(
                    {"layer": "tracked", "error": str(e)}))

        t = threading.Thread(target=worker, daemon=True)
        t.start()
