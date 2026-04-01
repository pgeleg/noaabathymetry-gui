// MapLibre map with draw tools for AOI selection.

// ── Basemaps ─────────────────────────────────────────

var basemapStyles = {
    "Voyager": {
        version: 8,
        sources: { carto: { type: "raster", tiles: ["https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png", "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"], tileSize: 256 } },
        layers: [{ id: "carto", type: "raster", source: "carto" }]
    },
    "Dark": {
        version: 8,
        sources: { carto: { type: "raster", tiles: ["https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png", "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"], tileSize: 256 } },
        layers: [{ id: "carto", type: "raster", source: "carto" }]
    },
    "Light": {
        version: 8,
        sources: { carto: { type: "raster", tiles: ["https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png", "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"], tileSize: 256 } },
        layers: [{ id: "carto", type: "raster", source: "carto" }]
    },
};

var basemapNames = Object.keys(basemapStyles);
var basemapIndex = 0;

var map = new maplibregl.Map({
    container: "map",
    style: basemapStyles["Voyager"],
    center: [-80, 30],
    zoom: 4,
    attributionControl: false,
});

// Integer zoom with smooth animation on scroll
map.scrollZoom.disable();
var scrollZooming = false;
map.getCanvas().addEventListener("wheel", function (e) {
    e.preventDefault();
    if (scrollZooming) return;
    scrollZooming = true;
    var z = Math.round(map.getZoom());
    var newZ = e.deltaY < 0 ? z + 1 : z - 1;
    newZ = Math.max(1, Math.min(20, newZ));
    if (e.deltaY < 0) {
        var point = map.unproject([e.offsetX, e.offsetY]);
        map.easeTo({ zoom: newZ, center: point, duration: 300 });
    } else {
        map.easeTo({ zoom: newZ, duration: 300 });
    }
    map.once("moveend", function () { scrollZooming = false; });
}, { passive: false });

map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");

function setBasemapByName(name) {
    var idx = basemapNames.indexOf(name);
    if (idx >= 0 && idx !== basemapIndex) setBasemap(idx);
}

function setBasemap(idx) {
    basemapIndex = idx;
    // Preserve sources/layers we've added
    var center = map.getCenter();
    var zoom = map.getZoom();
    map.setStyle(basemapStyles[basemapNames[idx]]);
    map.once("styledata", function () {
        map.jumpTo({ center: center, zoom: zoom });
        readdAllSources();
    });
    if (bridge) bridge.save_basemap(basemapNames[idx]);
}

// ── Draw tools (custom polygon drawing) ──────────────

var currentGeometry = null;
var drawingMode = false;
var drawPoints = [];

var DrawControl = {
    onAdd: function () {
        var div = document.createElement("div");
        div.className = "maplibregl-ctrl maplibregl-ctrl-group";
        div.innerHTML =
            '<button id="draw-polygon-btn" class="draw-btn" title="Draw polygon" onclick="startDrawing()">⬠</button>' +
            '<button id="draw-rect-btn" class="draw-btn" title="Draw rectangle" onclick="startRectangle()">▭</button>' +
            '<button id="draw-clear-btn" class="draw-btn" title="Clear geometry" onclick="clearDrawing()">✕</button>';
        return div;
    },
    onRemove: function () {}
};
map.addControl(DrawControl, "top-left");

function startDrawing() {
    if (drawingMode) {
        finishDrawing();
        return;
    }
    if (rectMode) cancelRect();
    drawingMode = true;
    drawPoints = [];
    map.dragPan.disable();
    map.doubleClickZoom.disable();
    map.getCanvas().style.setProperty("cursor", "crosshair", "important");
    document.getElementById("draw-polygon-btn").classList.add("active");
    // Clear previous
    if (map.getSource("draw-polygon")) map.getSource("draw-polygon").setData({ type: "FeatureCollection", features: [] });
    if (map.getSource("draw-points")) map.getSource("draw-points").setData({ type: "FeatureCollection", features: [] });
}

function finishDrawing() {
    drawingMode = false;
    map.dragPan.enable();
    map.doubleClickZoom.enable();
    map.getCanvas().style.setProperty("cursor", "", "");
    document.getElementById("draw-polygon-btn").classList.remove("active");
    if (drawPoints.length >= 3) {
        var coords = drawPoints.slice();
        coords.push(coords[0]); // close the ring
        var geom = { type: "Polygon", coordinates: [coords] };
        currentGeometry = JSON.stringify(geom);
        document.getElementById("opt-geometry").value = currentGeometry;
        updateDrawLayer();
    }
}

function clearDrawing() {
    drawingMode = false;
    drawPoints = [];
    currentGeometry = null;
    map.dragPan.enable();
    map.doubleClickZoom.enable();
    map.getCanvas().style.setProperty("cursor", "", "");
    document.getElementById("draw-polygon-btn").classList.remove("active");
    document.getElementById("draw-rect-btn").classList.remove("active");
    document.getElementById("opt-geometry").value = "";
    if (map.getSource("draw-polygon")) map.getSource("draw-polygon").setData({ type: "FeatureCollection", features: [] });
    if (map.getSource("draw-points")) map.getSource("draw-points").setData({ type: "FeatureCollection", features: [] });
}

// ── Rectangle drawing (drag) ─────────────────────────

var rectMode = false;
var rectStart = null;

function startRectangle() {
    if (rectMode) {
        cancelRect();
        return;
    }
    if (drawingMode) finishDrawing();
    rectMode = true;
    rectStart = null;
    map.dragPan.disable();
    map.getCanvas().style.setProperty("cursor", "crosshair", "important");
    document.getElementById("draw-rect-btn").classList.add("active");
}

function cancelRect() {
    rectMode = false;
    rectStart = null;
    map.dragPan.enable();
    map.getCanvas().style.setProperty("cursor", "", "");
    document.getElementById("draw-rect-btn").classList.remove("active");
}

function finishRect(start, end) {
    rectMode = false;
    rectStart = null;
    map.dragPan.enable();
    map.getCanvas().style.setProperty("cursor", "", "");
    document.getElementById("draw-rect-btn").classList.remove("active");
    var coords = [
        [start.lng, start.lat],
        [end.lng, start.lat],
        [end.lng, end.lat],
        [start.lng, end.lat],
        [start.lng, start.lat],
    ];
    var geom = { type: "Polygon", coordinates: [coords] };
    currentGeometry = JSON.stringify(geom);
    document.getElementById("opt-geometry").value = currentGeometry;
    drawPoints = coords.slice(0, 4);
    updateDrawLayer();
}

map.on("mousedown", function (e) {
    if (!rectMode) return;
    rectStart = e.lngLat;
});

map.on("mousemove", function (e) {
    if (!rectMode || !rectStart) return;
    var s = rectStart;
    var c = e.lngLat;
    var coords = [
        [s.lng, s.lat], [c.lng, s.lat], [c.lng, c.lat], [s.lng, c.lat], [s.lng, s.lat]
    ];
    if (map.getSource("draw-polygon")) {
        map.getSource("draw-polygon").setData({
            type: "FeatureCollection",
            features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [coords] }, properties: {} }]
        });
    }
});

map.on("mouseup", function (e) {
    if (!rectMode || !rectStart) return;
    if (Math.abs(e.lngLat.lng - rectStart.lng) > 0.001 || Math.abs(e.lngLat.lat - rectStart.lat) > 0.001) {
        finishRect(rectStart, e.lngLat);
    } else {
        rectStart = null; // click too small, reset
    }
});

function raiseDrawLayers() {
    ["draw-fill", "draw-line", "draw-vertices"].forEach(function (id) {
        if (map.getLayer(id)) map.moveLayer(id);
    });
}

function updateDrawLayer() {
    var features = [];
    if (drawPoints.length >= 3) {
        var coords = drawPoints.slice();
        coords.push(coords[0]);
        features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [coords] }, properties: {} });
    } else if (drawPoints.length >= 2) {
        features.push({ type: "Feature", geometry: { type: "LineString", coordinates: drawPoints }, properties: {} });
    }
    if (map.getSource("draw-polygon")) {
        map.getSource("draw-polygon").setData({ type: "FeatureCollection", features: features });
    }
    var pointFeatures = drawPoints.map(function (p) {
        return { type: "Feature", geometry: { type: "Point", coordinates: p }, properties: {} };
    });
    if (map.getSource("draw-points")) {
        map.getSource("draw-points").setData({ type: "FeatureCollection", features: pointFeatures });
    }
}

map.on("load", function () {
    map.addSource("draw-polygon", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addSource("draw-points", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "draw-fill", type: "fill", source: "draw-polygon", paint: { "fill-color": "rgba(100,140,255,0.15)", "fill-opacity": 1 } });
    map.addLayer({ id: "draw-line", type: "line", source: "draw-polygon", paint: { "line-color": "rgba(100,140,255,0.8)", "line-width": 2, "line-dasharray": [3, 2] } });
    map.addLayer({ id: "draw-vertices", type: "circle", source: "draw-points", paint: { "circle-radius": 4, "circle-color": "rgba(100,140,255,1)", "circle-stroke-color": "white", "circle-stroke-width": 1.5 } });
});

function segmentsIntersect(a1, a2, b1, b2) {
    var d1x = a2[0] - a1[0], d1y = a2[1] - a1[1];
    var d2x = b2[0] - b1[0], d2y = b2[1] - b1[1];
    var cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 1e-12) return false;
    var dx = b1[0] - a1[0], dy = b1[1] - a1[1];
    var t = (dx * d2y - dy * d2x) / cross;
    var u = (dx * d1y - dy * d1x) / cross;
    return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999;
}

function wouldSelfIntersect(points, newPoint) {
    if (points.length < 2) return false;
    var newEdge = [points[points.length - 1], newPoint];
    for (var i = 0; i < points.length - 1; i++) {
        if (segmentsIntersect(newEdge[0], newEdge[1], points[i], points[i + 1])) return true;
    }
    return false;
}

map.on("click", function (e) {
    if (!drawingMode) return;
    var pt = [e.lngLat.lng, e.lngLat.lat];
    if (wouldSelfIntersect(drawPoints, pt)) {
        showToast("Polygon edges cannot cross");
        return;
    }
    drawPoints.push(pt);
    updateDrawLayer();
});

map.on("dblclick", function (e) {
    if (!drawingMode) return;
    e.preventDefault();
    // Check if closing edge would self-intersect
    if (drawPoints.length >= 3 && wouldSelfIntersect(drawPoints, drawPoints[0])) {
        showToast("Polygon edges cannot cross");
        return;
    }
    finishDrawing();
});

// ── Cursor coordinates ───────────────────────────────

var coordDiv = document.createElement("div");
coordDiv.className = "map-coords";
coordDiv.textContent = "0.0000, 0.0000";
document.getElementById("map").appendChild(coordDiv);

map.on("mousemove", function (e) {
    coordDiv.textContent = e.lngLat.lat.toFixed(4) + ", " + e.lngLat.lng.toFixed(4);
});

// ── Lat/long gridlines ───────────────────────────────

var gridColorIndex = 0;
var gridColor = "rgba(255,255,255,0.25)";
var gridLabelColor = "rgba(255,255,255,0.4)";
var gridVisible = false;

var gridColors = [
    { name: "White", line: "rgba(255,255,255,0.25)", label: "rgba(255,255,255,0.4)" },
    { name: "Black", line: "rgba(0,0,0,0.3)", label: "rgba(0,0,0,0.5)" },
    { name: "Blue", line: "rgba(100,140,255,0.3)", label: "rgba(100,140,255,0.5)" },
    { name: "Red", line: "rgba(220,60,60,0.3)", label: "rgba(220,60,60,0.5)" },
];

function buildGridGeoJSON() {
    var features = [];
    for (var lat = -80; lat <= 80; lat += 10) {
        features.push({ type: "Feature", geometry: { type: "LineString", coordinates: [[-180, lat], [180, lat]] }, properties: { label: lat + "°" } });
    }
    for (var lng = -180; lng <= 180; lng += 10) {
        features.push({ type: "Feature", geometry: { type: "LineString", coordinates: [[lng, -85], [lng, 85]] }, properties: { label: lng + "°" } });
    }
    return { type: "FeatureCollection", features: features };
}

function addGridToMap() {
    if (map.getSource("grid")) return;
    map.addSource("grid", { type: "geojson", data: buildGridGeoJSON() });
    map.addLayer({ id: "grid-lines", type: "line", source: "grid", paint: { "line-color": gridColor, "line-width": 0.5 } });
}

function removeGridFromMap() {
    if (map.getLayer("grid-lines")) map.removeLayer("grid-lines");
    if (map.getSource("grid")) map.removeSource("grid");
}

function setGridColor(idx) {
    gridColorIndex = idx;
    gridColor = gridColors[idx].line;
    gridLabelColor = gridColors[idx].label;
    if (gridVisible) {
        removeGridFromMap();
        addGridToMap();
    } else {
        gridVisible = true;
        addGridToMap();
    }
    document.getElementById("toolbar-grid").classList.add("toolbar-active");
}

function gridOff() {
    if (gridVisible) {
        gridVisible = false;
        removeGridFromMap();
        document.getElementById("toolbar-grid").classList.remove("toolbar-active");
    }
}

// ── UTM zone dividers ────────────────────────────────

var utmColorIndex = 0;
var utmColor = "rgba(255,180,50,0.3)";
var utmLabelColor = "rgba(255,180,50,0.5)";
var utmVisible = false;

var utmColors = [
    { name: "Amber", line: "rgba(255,180,50,0.3)", label: "rgba(255,180,50,0.5)" },
    { name: "White", line: "rgba(255,255,255,0.25)", label: "rgba(255,255,255,0.4)" },
    { name: "Black", line: "rgba(0,0,0,0.3)", label: "rgba(0,0,0,0.5)" },
    { name: "Green", line: "rgba(100,190,140,0.3)", label: "rgba(100,190,140,0.5)" },
];

function buildUtmGeoJSON() {
    var features = [];
    for (var zone = 1; zone <= 60; zone++) {
        var lng = -180 + (zone - 1) * 6;
        features.push({ type: "Feature", geometry: { type: "LineString", coordinates: [[lng, -80], [lng, 84]] }, properties: { label: String(zone) } });
    }
    return { type: "FeatureCollection", features: features };
}

function addUtmToMap() {
    if (map.getSource("utm")) return;
    map.addSource("utm", { type: "geojson", data: buildUtmGeoJSON() });
    map.addLayer({ id: "utm-lines", type: "line", source: "utm", paint: { "line-color": utmColor, "line-width": 1, "line-dasharray": [4, 4] } });
}

function removeUtmFromMap() {
    if (map.getLayer("utm-lines")) map.removeLayer("utm-lines");
    if (map.getSource("utm")) map.removeSource("utm");
}

function setUtmColor(idx) {
    utmColorIndex = idx;
    utmColor = utmColors[idx].line;
    utmLabelColor = utmColors[idx].label;
    if (utmVisible) {
        removeUtmFromMap();
        addUtmToMap();
    } else {
        utmVisible = true;
        addUtmToMap();
    }
    document.getElementById("toolbar-utm").classList.add("toolbar-active");
}

function utmOff() {
    if (utmVisible) {
        utmVisible = false;
        removeUtmFromMap();
        document.getElementById("toolbar-utm").classList.remove("toolbar-active");
    }
}

// ── Map toolbar ──────────────────────────────────────

var ToolbarControl = {
    onAdd: function () {
        var div = document.createElement("div");
        div.className = "map-toolbar maplibregl-ctrl";
        div.innerHTML =
            '<a class="toolbar-btn" id="toolbar-basemap" href="#" onclick="event.preventDefault();toggleBasemapMenu()" title="Basemap">◫</a>' +
            '<a class="toolbar-btn" id="toolbar-grid" href="#" onclick="event.preventDefault();toggleGridMenu()" title="Lat/long grid">#</a>' +
            '<a class="toolbar-btn" id="toolbar-utm" href="#" onclick="event.preventDefault();toggleUtmMenu()" title="UTM zones">▮</a>' +
            '<div class="toolbar-menu" id="basemap-menu"></div>' +
            '<div class="toolbar-menu" id="grid-menu"></div>' +
            '<div class="toolbar-menu" id="utm-menu"></div>';
        return div;
    },
    onRemove: function () {}
};
map.addControl(ToolbarControl, "top-left");

function closeAllMenus() {
    ["basemap-menu", "grid-menu", "utm-menu"].forEach(function (id) {
        var m = document.getElementById(id);
        if (m) m.style.display = "none";
    });
}

function toggleBasemapMenu() {
    var menu = document.getElementById("basemap-menu");
    var wasOpen = menu.style.display === "block";
    closeAllMenus();
    if (wasOpen) return;
    menu.innerHTML = "";
    basemapNames.forEach(function (name, i) {
        var item = document.createElement("div");
        item.className = "toolbar-menu-item" + (i === basemapIndex ? " active" : "");
        item.textContent = name;
        item.onclick = function () {
            setBasemap(i);
            menu.style.display = "none";
        };
        menu.appendChild(item);
    });
    menu.style.display = "block";
}

function toggleGridMenu() {
    var menu = document.getElementById("grid-menu");
    var wasOpen = menu.style.display === "block";
    closeAllMenus();
    if (wasOpen) return;
    menu.innerHTML = "";
    gridColors.forEach(function (c, i) {
        var item = document.createElement("div");
        item.className = "toolbar-menu-item" + (gridVisible && i === gridColorIndex ? " active" : "");
        item.innerHTML = "<span class='color-dot' style='background:" + c.line.replace(/0\.\d+\)/, "0.8)") + "'></span>" + c.name;
        item.onclick = function (e) { e.stopPropagation(); setGridColor(i); menu.style.display = "none"; };
        menu.appendChild(item);
    });
    var sep = document.createElement("div"); sep.className = "toolbar-menu-sep"; menu.appendChild(sep);
    var off = document.createElement("div");
    off.className = "toolbar-menu-item" + (!gridVisible ? " active" : "");
    off.textContent = "Off";
    off.onclick = function (e) { e.stopPropagation(); gridOff(); menu.style.display = "none"; };
    menu.appendChild(off);
    menu.style.display = "block";
}

function toggleUtmMenu() {
    var menu = document.getElementById("utm-menu");
    var wasOpen = menu.style.display === "block";
    closeAllMenus();
    if (wasOpen) return;
    menu.innerHTML = "";
    utmColors.forEach(function (c, i) {
        var item = document.createElement("div");
        item.className = "toolbar-menu-item" + (utmVisible && i === utmColorIndex ? " active" : "");
        item.innerHTML = "<span class='color-dot' style='background:" + c.line.replace(/0\.\d+\)/, "0.8)") + "'></span>" + c.name;
        item.onclick = function (e) { e.stopPropagation(); setUtmColor(i); menu.style.display = "none"; };
        menu.appendChild(item);
    });
    var sep = document.createElement("div"); sep.className = "toolbar-menu-sep"; menu.appendChild(sep);
    var off = document.createElement("div");
    off.className = "toolbar-menu-item" + (!utmVisible ? " active" : "");
    off.textContent = "Off";
    off.onclick = function (e) { e.stopPropagation(); utmOff(); menu.style.display = "none"; };
    menu.appendChild(off);
    menu.style.display = "block";
}

document.addEventListener("click", function (e) {
    if (!e.target.closest(".map-toolbar")) closeAllMenus();
});

// ── Layer toggle control ─────────────────────────────

var layerDiv = document.createElement("div");
layerDiv.className = "map-layer-control";
layerDiv.innerHTML =
    '<button id="btn-layer-remote" class="layer-toggle" onclick="toggleRemoteLayer()" title="What\'s available on NBS?">' +
    '<span class="layer-dot remote"></span>NBS Source</button>' +
    '<button id="btn-layer-tracked" class="layer-toggle" onclick="toggleTrackedLayer()" title="What\'s the status of your tiles?">' +
    '<span class="layer-dot tracked"></span>Your Project</button>' +
    '<button id="btn-layer-fill" class="layer-toggle layer-on" onclick="toggleFill()" title="Toggle fill">' +
    '<span class="fill-icon"></span>Fill</button>';
document.getElementById("map").appendChild(layerDiv);

// ── Tile scheme layers ───────────────────────────────

function escapeHtml(s) {
    var div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
}

function buildPopupHtml(props) {
    var rows = "";
    for (var key in props) {
        if (props[key] == null) continue;
        rows += "<tr><td class='popup-key'>" + escapeHtml(String(key)) + "</td><td class='popup-val'>" + escapeHtml(String(props[key])) + "</td></tr>";
    }
    return rows ? "<table class='popup-table'>" + rows + "</table>" : "";
}

// ── Age-based styling ────────────────────────────────

var AGE_COLORS = [
    { days: 1,    color: [74, 222, 128] },
    { days: 7,    color: [34, 160, 70] },
    { days: 30,   color: [130, 190, 255] },
    { days: 90,   color: [25, 70, 170] },
    { days: 180,  color: [200, 200, 208] },
    { days: Infinity, color: [90, 90, 98] }
];
var NULL_DATE_COLOR = [30, 30, 30];
var layerFilled = true;

function getDateField(props) {
    return props["Delivered_Date"] || props["ISSUANCE"] || null;
}

function ageColor(props) {
    var dateStr = getDateField(props);
    if (!dateStr) return NULL_DATE_COLOR;
    var date = new Date(dateStr);
    if (isNaN(date.getTime())) return NULL_DATE_COLOR;
    var ageDays = (Date.now() - date.getTime()) / 86400000;
    for (var i = 0; i < AGE_COLORS.length; i++) {
        if (ageDays <= AGE_COLORS[i].days) return AGE_COLORS[i].color;
    }
    return AGE_COLORS[AGE_COLORS.length - 1].color;
}

function colorFeatures(geojson) {
    if (!geojson || !geojson.features) return geojson;
    geojson.features.forEach(function (f) {
        var c = ageColor(f.properties);
        f.properties._color = "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
    });
    return geojson;
}

var TRACKED_COLORS = {
    up_to_date: "rgb(34,197,94)",
    updates_available: "rgb(249,115,22)",
    missing_from_disk: "rgb(239,68,68)",
    removed_from_scheme: "rgb(160,160,168)",
};

function toggleFill() {
    layerFilled = !layerFilled;
    document.getElementById("btn-layer-fill").classList.toggle("layer-on", layerFilled);
    var opacity = layerFilled ? 0.8 : 0;
    if (map.getLayer("remote-fill")) map.setPaintProperty("remote-fill", "fill-opacity", opacity);
    ["up_to_date", "updates_available", "missing_from_disk", "removed_from_scheme"].forEach(function (cat) {
        if (map.getLayer("tracked-" + cat + "-fill")) map.setPaintProperty("tracked-" + cat + "-fill", "fill-opacity", layerFilled ? 0.7 : 0);
    });
}

// ── Remote layer ─────────────────────────────────────

function addRemoteToMap(geojson) {
    if (map.getSource("remote")) {
        map.getSource("remote").setData(geojson);
    } else {
        map.addSource("remote", { type: "geojson", data: geojson });
        map.addLayer({ id: "remote-fill", type: "fill", source: "remote", paint: { "fill-color": ["get", "_color"], "fill-opacity": layerFilled ? 0.8 : 0 } });
        map.addLayer({ id: "remote-outline", type: "line", source: "remote", paint: { "line-color": ["get", "_color"], "line-width": 1, "line-opacity": 0.7 } });
    }
    raiseDrawLayers();
}

function removeRemoteFromMap() {
    if (map.getLayer("remote-outline")) map.removeLayer("remote-outline");
    if (map.getLayer("remote-fill")) map.removeLayer("remote-fill");
    if (map.getSource("remote")) map.removeSource("remote");
}

// ── Tracked layers ───────────────────────────────────

var trackedCategories = ["up_to_date", "updates_available", "missing_from_disk", "removed_from_scheme"];

function addTrackedToMap(data) {
    trackedCategories.forEach(function (cat) {
        var geojson = data[cat];
        if (!geojson || geojson.features.length === 0) return;
        var srcId = "tracked-" + cat;
        if (map.getSource(srcId)) {
            map.getSource(srcId).setData(geojson);
        } else {
            map.addSource(srcId, { type: "geojson", data: geojson });
            map.addLayer({ id: srcId + "-fill", type: "fill", source: srcId, paint: { "fill-color": TRACKED_COLORS[cat], "fill-opacity": layerFilled ? 0.7 : 0 } });
            map.addLayer({ id: srcId + "-outline", type: "line", source: srcId, paint: { "line-color": TRACKED_COLORS[cat], "line-width": 1, "line-opacity": 0.8 } });
        }
    });
    raiseDrawLayers();
}

function removeTrackedFromMap() {
    trackedCategories.forEach(function (cat) {
        var srcId = "tracked-" + cat;
        if (map.getLayer(srcId + "-outline")) map.removeLayer(srcId + "-outline");
        if (map.getLayer(srcId + "-fill")) map.removeLayer(srcId + "-fill");
        if (map.getSource(srcId)) map.removeSource(srcId);
    });
}

// ── Popups ───────────────────────────────────────────

var popup = new maplibregl.Popup({ maxWidth: "360px", className: "dark-popup", closeOnClick: false, closeButton: false });

map.on("click", function (e) {
    if (drawingMode || rectMode) return;
    // Check all clickable layers
    var layers = ["remote-fill"];
    trackedCategories.forEach(function (cat) { layers.push("tracked-" + cat + "-fill"); });
    var existing = layers.filter(function (l) { return map.getLayer(l); });
    if (existing.length === 0) { popup.remove(); return; }
    var features = map.queryRenderedFeatures(e.point, { layers: existing });
    if (features.length === 0) { popup.remove(); return; }
    var props = Object.assign({}, features[0].properties);
    delete props._color;
    var html = buildPopupHtml(props);
    if (html) popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
});

// Pointer cursor on hoverable layers
map.on("mousemove", function (e) {
    var layers = ["remote-fill"];
    trackedCategories.forEach(function (cat) { layers.push("tracked-" + cat + "-fill"); });
    var existing = layers.filter(function (l) { return map.getLayer(l); });
    if (existing.length === 0) return;
    var features = map.queryRenderedFeatures(e.point, { layers: existing });
    if (!drawingMode && !rectMode) {
        map.getCanvas().style.cursor = features.length > 0 ? "pointer" : "";
    }
});

// ── Re-add sources after basemap change ──────────────

function readdAllSources() {
    if (remoteActive && remoteCache.data) {
        addRemoteToMap(remoteCache.data);
    }
    if (trackedActive && trackedCache.data) {
        addTrackedToMap(trackedCache.data);
    }
    if (gridVisible) addGridToMap();
    if (utmVisible) addUtmToMap();
}

// ── Legend ────────────────────────────────────────────

var legendDiv = null;

function buildLegendHtml() {
    var html = "";
    if (remoteActive) {
        html += "<div class='legend-section'>NBS Source</div>";
        var labels = ["< 1 day", "< 1 week", "< 1 month", "< 3 months", "< 6 months", "6+ months"];
        for (var i = 0; i < AGE_COLORS.length; i++) {
            var c = AGE_COLORS[i].color;
            html += "<div class='legend-row'><span class='legend-swatch' style='background:rgb(" + c[0] + "," + c[1] + "," + c[2] + ")'></span>" + labels[i] + "</div>";
        }
        html += "<div class='legend-row'><span class='legend-swatch' style='background:rgb(" + NULL_DATE_COLOR[0] + "," + NULL_DATE_COLOR[1] + "," + NULL_DATE_COLOR[2] + ");border:1px solid rgba(255,255,255,0.15)'></span>No delivery</div>";
    }
    if (trackedActive) {
        if (html) html += "<div class='legend-divider'></div>";
        html += "<div class='legend-section'>Your Project</div>";
        var cats = [["up_to_date", "Up to date"], ["updates_available", "Updates available"], ["missing_from_disk", "Missing from disk"], ["removed_from_scheme", "Removed from scheme"]];
        for (var j = 0; j < cats.length; j++) {
            html += "<div class='legend-row'><span class='legend-swatch' style='background:" + TRACKED_COLORS[cats[j][0]] + "'></span>" + cats[j][1] + "</div>";
        }
    }
    return html;
}

function updateLegend() {
    if (legendDiv) { legendDiv.remove(); legendDiv = null; }
    if (!remoteActive && !trackedActive) return;
    legendDiv = document.createElement("div");
    legendDiv.className = "map-legend";
    legendDiv.innerHTML = buildLegendHtml();
    document.getElementById("map").appendChild(legendDiv);
}

// ── Layer state & caching ────────────────────────────

var remoteActive = false;
var trackedActive = false;
var remoteLoading = false;
var trackedLoading = false;

var remoteCache = { source: null, data: null, time: 0 };
var REMOTE_CACHE_MS = 60000;

var trackedCache = { dir: null, source: null, data: null, time: 0 };
var TRACKED_CACHE_MS = 60000;
var trackedSkipCache = false;
var trackedIsReload = false;
var trackedStartup = false;

function clearAllLayers() {
    if (remoteActive || remoteLoading) {
        remoteActive = false;
        remoteLoading = false;
        removeRemoteFromMap();
        var rb = document.getElementById("btn-layer-remote");
        rb.classList.remove("layer-on", "layer-loading");
    }
    if (trackedActive || trackedLoading) {
        trackedActive = false;
        trackedLoading = false;
        trackedSkipCache = false;
        trackedIsReload = false;
        trackedStartup = false;
        removeTrackedFromMap();
        var tb = document.getElementById("btn-layer-tracked");
        tb.classList.remove("layer-on", "layer-loading");
    }
    updateLegend();
}

function toggleRemoteLayer() {
    if (remoteLoading) return;
    var btn = document.getElementById("btn-layer-remote");
    if (remoteActive) {
        remoteActive = false;
        removeRemoteFromMap();
        btn.classList.remove("layer-on");
        updateLegend();
    } else {
        if (!bridge) return;
        var source = document.getElementById("data-source").value;
        if (remoteCache.source === source && remoteCache.data && (Date.now() - remoteCache.time) < REMOTE_CACHE_MS) {
            remoteActive = true;
            btn.classList.add("layer-on");
            addRemoteToMap(remoteCache.data);
            updateLegend();
            return;
        }
        remoteActive = true;
        remoteLoading = true;
        btn.classList.add("layer-on");
        btn.classList.add("layer-loading");
        bridge.load_remote_layer(source);
    }
}

function toggleTrackedLayer() {
    if (trackedLoading) return;
    var btn = document.getElementById("btn-layer-tracked");
    if (trackedActive) {
        trackedActive = false;
        removeTrackedFromMap();
        btn.classList.remove("layer-on");
        updateLegend();
    } else {
        if (!bridge) return;
        if (currentCommand === "fetch") { showToast("Wait for fetch to finish"); return; }
        var dir = document.getElementById("project-dir").value;
        if (!dir) return;
        var source = document.getElementById("data-source").value;
        if (!trackedSkipCache && trackedCache.dir === dir && trackedCache.source === source
            && trackedCache.data && (Date.now() - trackedCache.time) < TRACKED_CACHE_MS) {
            trackedActive = true;
            btn.classList.add("layer-on");
            addTrackedToMap(trackedCache.data);
            updateLegend();
            return;
        }
        trackedSkipCache = false;
        trackedActive = true;
        trackedLoading = true;
        btn.classList.add("layer-on");
        btn.classList.add("layer-loading");
        bridge.load_tracked_layer(dir, source);
    }
}

function reloadTrackedLayer() {
    if (!bridge || trackedLoading) return;
    trackedLoading = true;
    trackedIsReload = true;
    var btn = document.getElementById("btn-layer-tracked");
    btn.classList.add("layer-loading");
    var dir = document.getElementById("project-dir").value;
    var source = document.getElementById("data-source").value;
    bridge.load_tracked_layer(dir, source);
}

// ── Fit bounds helper ────────────────────────────────

function fitToGeojson(geojson) {
    if (!geojson || !geojson.features || geojson.features.length === 0) return;
    var bounds = new maplibregl.LngLatBounds();
    geojson.features.forEach(function (f) {
        if (!f.geometry || !f.geometry.coordinates) return;
        var coords = f.geometry.type === "Polygon" ? f.geometry.coordinates[0] :
                     f.geometry.type === "MultiPolygon" ? f.geometry.coordinates[0][0] : [];
        coords.forEach(function (c) { bounds.extend(c); });
    });
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 20 });
}

// ── onLayersReady ────────────────────────────────────

function onLayersReady(data) {
    if (data.layer === "remote") {
        remoteLoading = false;
        var btn = document.getElementById("btn-layer-remote");
        btn.classList.remove("layer-loading");
        if (data.error) {
            remoteActive = false;
            btn.classList.remove("layer-on");
            showToast(data.error);
            return;
        }
        colorFeatures(data.data);
        remoteCache.source = document.getElementById("data-source").value;
        remoteCache.data = data.data;
        remoteCache.time = Date.now();
        addRemoteToMap(data.data);
        updateLegend();
        if (!data.cached) fitToGeojson(data.data);
    } else if (data.layer === "tracked") {
        trackedLoading = false;
        var btn = document.getElementById("btn-layer-tracked");
        btn.classList.remove("layer-loading");
        if (data.error) {
            trackedActive = false;
            trackedIsReload = false;
            btn.classList.remove("layer-on");
            showToast(data.error);
            return;
        }
        trackedCache.dir = document.getElementById("project-dir").value;
        trackedCache.source = document.getElementById("data-source").value;
        trackedCache.data = data.data;
        trackedCache.time = Date.now();
        addTrackedToMap(data.data);
        updateLegend();
        if (!trackedIsReload) {
            // Fit to all tracked features
            var allFeatures = [];
            for (var cat in data.data) {
                if (data.data[cat].features) allFeatures = allFeatures.concat(data.data[cat].features);
            }
            if (allFeatures.length > 0) fitToGeojson({ type: "FeatureCollection", features: allFeatures });
        }
        trackedIsReload = false;

        if (trackedStartup) {
            trackedStartup = false;
            var updates = data.data.updates_available ? data.data.updates_available.features.length : 0;
            var missing = data.data.missing_from_disk ? data.data.missing_from_disk.features.length : 0;
            var removed = data.data.removed_from_scheme ? data.data.removed_from_scheme.features.length : 0;
            var total = data.total || 0;
            var issues = (updates > 0 ? 1 : 0) + (missing > 0 ? 1 : 0) + (removed > 0 ? 1 : 0);
            if (issues === 1 && updates > 0) {
                showToast("Welcome back! " + updates + " of your tiles have updates available", "toast-welcome");
            } else if (issues === 1 && missing > 0) {
                showToast("Welcome back! " + missing + " of your tiles " + (missing === 1 ? "is" : "are") + " missing from disk. Fetch to re-download " + (missing === 1 ? "it" : "them"), "toast-welcome");
            } else if (issues === 1 && removed > 0) {
                showToast("Welcome back! " + removed + " of your tiles " + (removed === 1 ? "was" : "were") + " removed from the NBS source", "toast-welcome");
            } else if (issues > 1) {
                var parts = [];
                if (updates > 0) parts.push(updates + " update" + (updates !== 1 ? "s" : "") + " available");
                if (missing > 0) parts.push(missing + " missing from disk");
                if (removed > 0) parts.push(removed + " removed from the NBS source");
                showToast("Welcome back! " + parts.join(", "), "toast-welcome");
            } else if (total > 0) {
                showToast("Welcome back! All " + total + " of your tiles are up to date with the NBS", "toast-welcome");
            }
        }
    }
}
