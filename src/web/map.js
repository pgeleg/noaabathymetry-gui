// Leaflet map with draw tools for AOI selection.

var map = L.map("map", { preferCanvas: true }).setView([30, -80], 5);

// Basemap options — all free, no API keys required
var basemaps = {
    "Voyager": L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
        subdomains: "abcd",
        maxZoom: 20,
    }),
    "Dark": L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
        subdomains: "abcd",
        maxZoom: 20,
    }),
    "Light": L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
        subdomains: "abcd",
        maxZoom: 20,
    }),
};

var activeBasemap = basemaps["Voyager"];
activeBasemap.addTo(map);
var basemapNames = Object.keys(basemaps);
var basemapIndex = 0;

function setBasemapByName(name) {
    var idx = basemapNames.indexOf(name);
    if (idx >= 0 && idx !== basemapIndex) setBasemap(idx);
}

function setBasemap(idx) {
    map.removeLayer(activeBasemap);
    basemapIndex = idx;
    activeBasemap = basemaps[basemapNames[basemapIndex]];
    activeBasemap.addTo(map);
    if (bridge) bridge.save_basemap(basemapNames[basemapIndex]);
}

// ── Lat/long gridlines ───────────────────────────────

var gridLayer = L.layerGroup();
var gridVisible = false;

function buildGrid() {
    gridLayer.clearLayers();
    var style = { color: gridColor, weight: 0.5 };
    for (var lat = -80; lat <= 80; lat += 10) {
        gridLayer.addLayer(L.polyline([[lat, -180], [lat, 180]], style));
        gridLayer.addLayer(L.marker([lat, -178], {
            icon: L.divIcon({ className: "grid-label", html: "<span style='color:" + gridLabelColor + "'>" + lat + "°</span>", iconSize: [30, 12] }),
        }));
    }
    for (var lng = -180; lng <= 180; lng += 10) {
        gridLayer.addLayer(L.polyline([[-85, lng], [85, lng]], style));
        gridLayer.addLayer(L.marker([83, lng], {
            icon: L.divIcon({ className: "grid-label", html: "<span style='color:" + gridLabelColor + "'>" + lng + "°</span>", iconSize: [36, 12] }),
        }));
    }
}

buildGrid();

var gridColorIndex = 0;
var gridColor = "rgba(255,255,255,0.25)";
var gridLabelColor = "rgba(255,255,255,0.4)";

var gridColors = [
    { name: "White", line: "rgba(255,255,255,0.25)", label: "rgba(255,255,255,0.4)" },
    { name: "Black", line: "rgba(0,0,0,0.3)", label: "rgba(0,0,0,0.5)" },
    { name: "Blue", line: "rgba(100,140,255,0.3)", label: "rgba(100,140,255,0.5)" },
    { name: "Red", line: "rgba(220,60,60,0.3)", label: "rgba(220,60,60,0.5)" },
];

function setGridColor(idx) {
    gridColorIndex = idx;
    gridColor = gridColors[idx].line;
    gridLabelColor = gridColors[idx].label;
    buildGrid();
    if (!gridVisible) {
        gridVisible = true;
        gridLayer.addTo(map);
    } else {
        map.removeLayer(gridLayer);
        gridLayer.addTo(map);
    }
    document.getElementById("toolbar-grid").classList.add("toolbar-active");
}

function gridOff() {
    if (gridVisible) {
        gridVisible = false;
        map.removeLayer(gridLayer);
        document.getElementById("toolbar-grid").classList.remove("toolbar-active");
    }
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
        item.onclick = function (e) {
            e.stopPropagation();
            setGridColor(i);
            menu.style.display = "none";
        };
        menu.appendChild(item);
    });
    var sep = document.createElement("div");
    sep.className = "toolbar-menu-sep";
    menu.appendChild(sep);
    var off = document.createElement("div");
    off.className = "toolbar-menu-item" + (!gridVisible ? " active" : "");
    off.textContent = "Off";
    off.onclick = function (e) {
        e.stopPropagation();
        gridOff();
        menu.style.display = "none";
    };
    menu.appendChild(off);
    menu.style.display = "block";
}

// ── UTM zone dividers ────────────────────────────────

var utmLayer = L.layerGroup();
var utmVisible = false;

var utmColorIndex = 0;
var utmColor = "rgba(255, 180, 50, 0.3)";
var utmLabelColor = "rgba(255, 180, 50, 0.5)";

var utmColors = [
    { name: "Amber", line: "rgba(255,180,50,0.3)", label: "rgba(255,180,50,0.5)" },
    { name: "White", line: "rgba(255,255,255,0.25)", label: "rgba(255,255,255,0.4)" },
    { name: "Black", line: "rgba(0,0,0,0.3)", label: "rgba(0,0,0,0.5)" },
    { name: "Green", line: "rgba(100,190,140,0.3)", label: "rgba(100,190,140,0.5)" },
];

function setUtmColor(idx) {
    utmColorIndex = idx;
    utmColor = utmColors[idx].line;
    utmLabelColor = utmColors[idx].label;
    buildUtmZones();
    if (!utmVisible) {
        utmVisible = true;
        utmLayer.addTo(map);
    } else {
        map.removeLayer(utmLayer);
        utmLayer.addTo(map);
    }
    document.getElementById("toolbar-utm").classList.add("toolbar-active");
}

function utmOff() {
    if (utmVisible) {
        utmVisible = false;
        map.removeLayer(utmLayer);
        document.getElementById("toolbar-utm").classList.remove("toolbar-active");
    }
}

function buildUtmZones() {
    utmLayer.clearLayers();
    var style = { color: utmColor, weight: 1, dashArray: "4, 4" };
    for (var zone = 1; zone <= 60; zone++) {
        var lng = -180 + (zone - 1) * 6;
        utmLayer.addLayer(L.polyline([[-80, lng], [84, lng]], style));
        utmLayer.addLayer(L.marker([0, lng + 3], {
            icon: L.divIcon({ className: "utm-label", html: "<span style='color:" + utmLabelColor + "'>" + zone + "</span>", iconSize: [20, 12] }),
        }));
    }
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
        item.onclick = function (e) {
            e.stopPropagation();
            setUtmColor(i);
            menu.style.display = "none";
        };
        menu.appendChild(item);
    });
    var sep = document.createElement("div");
    sep.className = "toolbar-menu-sep";
    menu.appendChild(sep);
    var off = document.createElement("div");
    off.className = "toolbar-menu-item" + (!utmVisible ? " active" : "");
    off.textContent = "Off";
    off.onclick = function (e) {
        e.stopPropagation();
        utmOff();
        menu.style.display = "none";
    };
    menu.appendChild(off);
    menu.style.display = "block";
}

buildUtmZones();



// ── Map toolbar ──────────────────────────────────────

var toolbarControl = L.control({ position: "topleft" });
toolbarControl.onAdd = function () {
    var div = L.DomUtil.create("div", "map-toolbar leaflet-bar");
    div.innerHTML =
        '<a class="toolbar-btn" id="toolbar-basemap" href="#" onclick="event.preventDefault();toggleBasemapMenu()" title="Basemap">◫</a>' +
        '<a class="toolbar-btn" id="toolbar-grid" href="#" onclick="event.preventDefault();toggleGridMenu()" title="Lat/long grid">#</a>' +
        '<a class="toolbar-btn" id="toolbar-utm" href="#" onclick="event.preventDefault();toggleUtmMenu()" title="UTM zones">▮</a>' +
        '<div class="toolbar-menu" id="basemap-menu"></div>' +
        '<div class="toolbar-menu" id="grid-menu"></div>' +
        '<div class="toolbar-menu" id="utm-menu"></div>';
    L.DomEvent.disableClickPropagation(div);
    return div;
};
toolbarControl.addTo(map);

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

document.addEventListener("click", function (e) {
    if (!e.target.closest(".map-toolbar")) {
        closeAllMenus();
    }
});

// ── Cursor coordinates ───────────────────────────────

var coordControl = L.control({ position: "bottomleft" });
coordControl.onAdd = function () {
    var div = L.DomUtil.create("div", "map-coords");
    div.textContent = "0.0000, 0.0000";
    return div;
};
coordControl.addTo(map);

map.on("mousemove", function (e) {
    var el = document.querySelector(".map-coords");
    if (el) el.textContent = e.latlng.lat.toFixed(4) + ", " + e.latlng.lng.toFixed(4);
});

// ── Layer toggle control on map ──────────────────────

var layerControl = L.control({ position: "topright" });
layerControl.onAdd = function () {
    var div = L.DomUtil.create("div", "map-layer-control");
    div.innerHTML =
        '<button id="btn-layer-remote" class="layer-toggle" onclick="toggleRemoteLayer()" title="What\'s available on NBS?">' +
        '<span class="layer-dot remote"></span>NBS Source</button>' +
        '<button id="btn-layer-tracked" class="layer-toggle" onclick="toggleTrackedLayer()" title="What\'s the status of your tiles?">' +
        '<span class="layer-dot tracked"></span>Your Project</button>' +
        '<button id="btn-layer-fill" class="layer-toggle layer-on" onclick="toggleFill()" title="Toggle fill">' +
        '<span class="fill-icon"></span>Fill</button>';
    L.DomEvent.disableClickPropagation(div);
    return div;
};
layerControl.addTo(map);

// Draw layer for user-drawn geometries
var drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

var drawControl = new L.Control.Draw({
    draw: {
        polygon: { showArea: false, allowIntersection: false },
        rectangle: { showArea: false },
        circle: false,
        circlemarker: false,
        marker: false,
        polyline: false,
    },
    edit: {
        featureGroup: drawnItems,
    },
});
map.addControl(drawControl);



// Store the current drawn geometry as GeoJSON
var currentGeometry = null;

map.on(L.Draw.Event.CREATED, function (event) {
    drawnItems.clearLayers();
    var layer = event.layer;
    drawnItems.addLayer(layer);
    currentGeometry = JSON.stringify(layer.toGeoJSON().geometry);
    document.getElementById("opt-geometry").value = currentGeometry;
});

map.on(L.Draw.Event.DELETED, function () {
    currentGeometry = null;
    document.getElementById("opt-geometry").value = "";
});



// ── Tile scheme layers ───────────────────────────────

function getResolution(feature) {
    var r = feature.properties.Resolution || feature.properties.resolution || "";
    var n = parseFloat(String(r));
    return isNaN(n) ? Infinity : n;
}

function sortByResolutionDesc(geojson) {
    if (geojson && geojson.features) {
        geojson.features.sort(function (a, b) {
            return getResolution(b) - getResolution(a);
        });
    }
    return geojson;
}

function escapeHtml(s) {
    var div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
}

function buildPopup(props) {
    var rows = "";
    for (var key in props) {
        if (props[key] == null) continue;
        var val = escapeHtml(String(props[key]));
        var safeKey = escapeHtml(String(key));
        rows += "<tr><td class='popup-key'>" + safeKey + "</td><td class='popup-val'>" + val + "</td></tr>";
    }
    if (!rows) return null;
    return "<table class='popup-table'>" + rows + "</table>";
}

function bindTilePopup(feature, layer) {
    var html = buildPopup(feature.properties);
    if (html) layer.bindPopup(html, { maxWidth: 360, className: "dark-popup" });
}

// ── Age-based styling ────────────────────────────────

var AGE_COLORS = [
    { days: 1,    color: [74, 222, 128] },   // bright green — last day
    { days: 7,    color: [34, 160, 70] },     // medium green — last week
    { days: 30,   color: [130, 190, 255] },  // light blue — last month
    { days: 90,   color: [25, 70, 170] },    // dark blue — last 3 months
    { days: 180,  color: [200, 200, 208] },  // light grey — last 6 months
    { days: Infinity, color: [90, 90, 98] }  // dark grey — older
];

var NULL_DATE_COLOR = [30, 30, 30]; // black — no date

var layerFilled = true;

function getDateField(props) {
    // BlueTopo / Modeling use Delivered_Date; BAG / S102 use ISSUANCE
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

function tileStyle(feature) {
    var c = ageColor(feature.properties);
    return {
        color: "rgba(" + c[0] + "," + c[1] + "," + c[2] + ",0.7)",
        weight: 1,
        fillColor: "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")",
        fillOpacity: layerFilled ? 0.8 : 0,
    };
}

function toggleFill() {
    layerFilled = !layerFilled;
    document.getElementById("btn-layer-fill").classList.toggle("layer-on", layerFilled);
    remoteLayer.setStyle(tileStyle);
    for (var cat in trackedLayers) {
        trackedLayers[cat].setStyle(trackedStyle(cat));
    }
}

var remoteLayer = L.geoJSON(null, {
    style: tileStyle,
    onEachFeature: bindTilePopup,
});

// ── Tracked tile layers (status-based) ───────────────

var TRACKED_COLORS = {
    up_to_date:          [34, 197, 94],   // green
    updates_available:   [249, 115, 22],  // orange
    missing_from_disk:   [239, 68, 68],   // red
    removed_from_scheme: [160, 160, 168], // grey
};

function trackedStyle(cat) {
    var c = TRACKED_COLORS[cat];
    return function () {
        return {
            color: "rgba(" + c[0] + "," + c[1] + "," + c[2] + ",0.8)",
            weight: 1,
            fillColor: "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")",
            fillOpacity: layerFilled ? 0.7 : 0,
        };
    };
}

var trackedLayers = {
    up_to_date: L.geoJSON(null, { style: trackedStyle("up_to_date"), onEachFeature: bindTilePopup }),
    updates_available: L.geoJSON(null, { style: trackedStyle("updates_available"), onEachFeature: bindTilePopup }),
    missing_from_disk: L.geoJSON(null, { style: trackedStyle("missing_from_disk"), onEachFeature: bindTilePopup }),
    removed_from_scheme: L.geoJSON(null, { style: trackedStyle("removed_from_scheme"), onEachFeature: bindTilePopup }),
};

// ── Legend ────────────────────────────────────────────

var legendControl = null;

function buildLegendHtml() {
    var html = "";
    if (remoteActive) {
        html += "<div class='legend-section'>NBS Source</div>";
        var labels = ["< 1 day", "< 1 week", "< 1 month", "< 3 months", "< 6 months", "6+ months"];
        for (var i = 0; i < AGE_COLORS.length; i++) {
            var c = AGE_COLORS[i].color;
            html += "<div class='legend-row'>"
                + "<span class='legend-swatch' style='background:rgb(" + c[0] + "," + c[1] + "," + c[2] + ")'></span>"
                + labels[i] + "</div>";
        }
        html += "<div class='legend-row'>"
            + "<span class='legend-swatch' style='background:rgb(" + NULL_DATE_COLOR[0] + "," + NULL_DATE_COLOR[1] + "," + NULL_DATE_COLOR[2] + ");border:1px solid rgba(255,255,255,0.15)'></span>"
            + "No delivery</div>";
    }
    if (trackedActive) {
        if (html) html += "<div class='legend-divider'></div>";
        html += "<div class='legend-section'>Your Project</div>";
        var cats = [
            ["up_to_date", "Up to date"],
            ["updates_available", "Updates available"],
            ["missing_from_disk", "Missing from disk"],
            ["removed_from_scheme", "Removed from scheme"],
        ];
        for (var j = 0; j < cats.length; j++) {
            var tc = TRACKED_COLORS[cats[j][0]];
            html += "<div class='legend-row'>"
                + "<span class='legend-swatch' style='background:rgb(" + tc[0] + "," + tc[1] + "," + tc[2] + ")'></span>"
                + cats[j][1] + "</div>";
        }
    }
    return html;
}

function updateLegend() {
    if (legendControl) {
        map.removeControl(legendControl);
        legendControl = null;
    }
    if (!remoteActive && !trackedActive) return;
    legendControl = L.control({ position: "bottomright" });
    legendControl.onAdd = function () {
        var div = L.DomUtil.create("div", "map-legend");
        div.innerHTML = buildLegendHtml();
        return div;
    };
    legendControl.addTo(map);
}

var remoteActive = false;
var trackedActive = false;
var remoteLoading = false;
var trackedLoading = false;

function clearTrackedLayers() {
    for (var cat in trackedLayers) {
        map.removeLayer(trackedLayers[cat]);
        trackedLayers[cat].clearLayers();
    }
}

function clearAllLayers() {
    if (remoteActive || remoteLoading) {
        remoteActive = false;
        remoteLoading = false;
        map.removeLayer(remoteLayer);
        remoteLayer.clearLayers();
        var rb = document.getElementById("btn-layer-remote");
        rb.classList.remove("layer-on", "layer-loading");
    }
    if (trackedActive || trackedLoading) {
        trackedActive = false;
        trackedLoading = false;
        trackedSkipCache = false;
        trackedIsReload = false;
        trackedStartup = false;
        clearTrackedLayers();
        var tb = document.getElementById("btn-layer-tracked");
        tb.classList.remove("layer-on", "layer-loading");
    }
    updateLegend();
}

var remoteCache = { source: null, data: null, time: 0 };
var REMOTE_CACHE_MS = 60000; // 1 minute

function toggleRemoteLayer() {
    if (remoteLoading) return;
    var btn = document.getElementById("btn-layer-remote");
    if (remoteActive) {
        remoteActive = false;
        map.removeLayer(remoteLayer);
        remoteLayer.clearLayers();
        btn.classList.remove("layer-on");
        updateLegend();
    } else {
        if (!bridge) return;
        var source = document.getElementById("data-source").value;
        // Check cache
        if (remoteCache.source === source && remoteCache.data && (Date.now() - remoteCache.time) < REMOTE_CACHE_MS) {
            remoteActive = true;
            btn.classList.add("layer-on");
            remoteLayer.clearLayers();
            remoteLayer.addData(remoteCache.data);
            map.addLayer(remoteLayer);
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

var trackedCache = { dir: null, source: null, data: null, time: 0 };
var TRACKED_CACHE_MS = 60000; // 1 minute
var trackedSkipCache = false;
var trackedIsReload = false;
var trackedStartup = false;

function toggleTrackedLayer() {
    if (trackedLoading) return;
    var btn = document.getElementById("btn-layer-tracked");
    if (trackedActive) {
        trackedActive = false;
        clearTrackedLayers();
        btn.classList.remove("layer-on");
        updateLegend();
    } else {
        if (!bridge) return;
        if (currentCommand === "fetch") { showToast("Wait for fetch to finish"); return; }
        var dir = document.getElementById("project-dir").value;
        if (!dir) return;
        var source = document.getElementById("data-source").value;
        // Check cache (only for manual clicks, not startup or post-fetch)
        if (!trackedSkipCache && trackedCache.dir === dir && trackedCache.source === source
            && trackedCache.data && (Date.now() - trackedCache.time) < TRACKED_CACHE_MS) {
            trackedActive = true;
            btn.classList.add("layer-on");
            clearTrackedLayers();
            for (var cat in trackedCache.data) {
                var geojson = trackedCache.data[cat];
                if (geojson.features.length > 0) {
                    trackedLayers[cat].addData(geojson);
                    map.addLayer(trackedLayers[cat]);
                }
            }
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
        sortByResolutionDesc(data.data);
        remoteCache.source = document.getElementById("data-source").value;
        remoteCache.data = data.data;
        remoteCache.time = Date.now();
        remoteLayer.clearLayers();
        remoteLayer.addData(data.data);
        map.addLayer(remoteLayer);
        updateLegend();
        if (!data.cached && remoteLayer.getLayers().length > 0) {
            map.fitBounds(remoteLayer.getBounds(), { padding: [20, 20] });
        }
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
        for (var cat in data.data) {
            sortByResolutionDesc(data.data[cat]);
        }
        trackedCache.dir = document.getElementById("project-dir").value;
        trackedCache.source = document.getElementById("data-source").value;
        trackedCache.data = data.data;
        trackedCache.time = Date.now();
        clearTrackedLayers();
        var bounds = null;
        for (var cat in data.data) {
            var geojson = data.data[cat];
            if (geojson.features.length > 0) {
                trackedLayers[cat].addData(geojson);
                map.addLayer(trackedLayers[cat]);
                var b = trackedLayers[cat].getBounds();
                if (b.isValid()) {
                    bounds = bounds ? bounds.extend(b) : b;
                }
            }
        }
        updateLegend();
        if (bounds && bounds.isValid() && !trackedIsReload) {
            map.fitBounds(bounds, { padding: [20, 20] });
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
