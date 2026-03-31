// UI panel logic — connects buttons to the Python bridge via QWebChannel.

var bridge = null;

// Initialize QWebChannel connection to Python
new QWebChannel(qt.webChannelTransport, function (channel) {
    bridge = channel.objects.bridge;
    bridge.get_cpu_count(function (count) {
        document.getElementById("opt-workers").max = Math.max(1, Math.floor(count / 2));
        document.getElementById("opt-workers").placeholder = "1";
    });
    bridge.get_recents(function (response) {
        var recents = JSON.parse(response);
        if (recents.length > 0) {
            var recent = recents[0];
            var path = typeof recent === "string" ? recent : recent.path;
            var source = typeof recent === "string" ? "bluetopo" : (recent.source || "bluetopo");
            document.getElementById("project-dir").value = path;
            lastCommittedDir = path;
            setSource(source);
            var basemap = recent.basemap;
            if (basemap) setBasemapByName(basemap);
            // Auto-load Your Project without adjusting the map or using cache
            trackedIsReload = true;
            trackedSkipCache = true;
            trackedStartup = true;
            toggleTrackedLayer();
        }
    });
});

function glowElement(el) {
    el.classList.remove("glow");
    void el.offsetWidth; // reflow to restart animation
    el.classList.add("glow");
}

var dirDebounce = null;

function onDirInput() {
    justFocused = false;
    clearTimeout(dirDebounce);
    dirDebounce = setTimeout(function () {
        if (!bridge) return;
        var val = document.getElementById("project-dir").value;
        if (!val || val.length < 2) {
            showRecents();
            return;
        }
        bridge.complete_path(val, function (response) {
            var paths = JSON.parse(response);
            var box = document.getElementById("dir-suggestions");
            if (paths.length === 0) {
                hideSuggestions();
                return;
            }
            box.innerHTML = "";
            selectedIndex = -1;
            paths.forEach(function (p) {
                var div = document.createElement("div");
                div.textContent = p;
                div.onclick = function () {
                    var input = document.getElementById("project-dir");
                    input.value = p;
                    hideSuggestions();
                    glowElement(input);
                    clearAllLayers();
                };
                box.appendChild(div);
            });
            box.style.display = "block";
        });
    }, 150);
}

function setSource(value) {
    document.getElementById("data-source").value = value;
    var items = document.querySelectorAll("#source-dropdown .dropdown-item");
    items.forEach(function (item) {
        if (item.getAttribute("data-value") === value) {
            document.getElementById("source-label").textContent = item.textContent;
            item.classList.add("selected");
        } else {
            item.classList.remove("selected");
        }
    });
}

var lastCommittedDir = "";

var justFocused = false;

function onDirFocus() {
    justFocused = true;
    showRecents();
}

function onDirClick() {
    if (!justFocused) {
        showRecents();
    }
}

function showRecents() {
    if (!bridge) return;
    bridge.get_recents(function (response) {
        var recents = JSON.parse(response);
        var box = document.getElementById("dir-suggestions");
        if (recents.length === 0) {
            hideSuggestions();
            return;
        }
        box.innerHTML = "";
        selectedIndex = -1;
        var label = document.createElement("div");
        label.textContent = "RECENT";
        label.className = "suggestions-label";
        box.appendChild(label);
        recents.forEach(function (r) {
            var path = typeof r === "string" ? r : r.path;
            var source = typeof r === "string" ? "bluetopo" : (r.source || "bluetopo");
            var div = document.createElement("div");
            div.className = "recent-item";
            var pathSpan = document.createElement("span");
            pathSpan.className = "recent-path";
            pathSpan.textContent = path;
            var sourceSpan = document.createElement("span");
            sourceSpan.className = "recent-source";
            sourceSpan.textContent = source;
            div.appendChild(pathSpan);
            div.appendChild(sourceSpan);
            div.onclick = function () {
                var input = document.getElementById("project-dir");
                input.value = path;
                setSource(source);
                hideSuggestions();
                clearAllLayers();
                glowElement(input);
                glowElement(document.getElementById("source-select"));
            };
            box.appendChild(div);
        });
        box.style.display = "block";
    });
}

var selectedIndex = -1;

document.getElementById("project-dir").addEventListener("keydown", function (e) {
    var box = document.getElementById("dir-suggestions");
    var items = box.querySelectorAll("div");
    if (items.length === 0) return;

    if (e.key === "ArrowDown") {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
        updateSelection(items);
    } else if (e.key === "ArrowUp") {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        updateSelection(items);
    } else if (e.key === "Tab") {
        if (items.length > 0) {
            e.preventDefault();
            selectedIndex = (selectedIndex + 1) % items.length;
            updateSelection(items);
            var input = document.getElementById("project-dir");
            input.value = items[selectedIndex].textContent;
            input.setSelectionRange(input.value.length, input.value.length);
        }
    } else if (e.key === "Enter") {
        e.preventDefault();
        var input = document.getElementById("project-dir");
        if (selectedIndex >= 0 && selectedIndex < items.length) {
            input.value = items[selectedIndex].textContent;
            input.setSelectionRange(input.value.length, input.value.length);
        }
        hideSuggestions();
        input.blur();
        glowElement(input);
        clearAllLayers();
    } else if (e.key === "Escape") {
        hideSuggestions();
    }
});

function updateSelection(items) {
    items.forEach(function (item, i) {
        item.classList.toggle("active", i === selectedIndex);
    });
    if (selectedIndex >= 0 && items[selectedIndex]) {
        items[selectedIndex].scrollIntoView({ block: "nearest" });
    }
}

function hideSuggestions() {
    document.getElementById("dir-suggestions").style.display = "none";
    selectedIndex = -1;
}

// Hide suggestions when focus leaves or clicking elsewhere
document.getElementById("project-dir").addEventListener("blur", function () {
    // Small delay so click on suggestion registers before hiding
    setTimeout(hideSuggestions, 150);
    if (this.value) {
        glowElement(this);
    }
    if (this.value !== lastCommittedDir) {
        lastCommittedDir = this.value;
        clearAllLayers();
    }
});

document.addEventListener("click", function (e) {
    if (!e.target.closest("#project-dir") && !e.target.closest("#dir-suggestions")) {
        hideSuggestions();
    }
});

function browseDir() {
    if (!bridge) return;
    bridge.browse_directory(function (path) {
        if (path) {
            var input = document.getElementById("project-dir");
            input.value = path;
            glowElement(input);
            clearAllLayers();
        }
    });
}

// ── Custom data source dropdown ──────────────────────

var sourceOpen = false;

function toggleSourceDropdown() {
    sourceOpen = !sourceOpen;
    document.getElementById("source-dropdown").style.display = sourceOpen ? "block" : "none";
}

function pickSource(el) {
    var value = el.getAttribute("data-value");
    var label = el.textContent;
    document.getElementById("data-source").value = value;
    document.getElementById("source-label").textContent = label;
    // Update selected state
    var items = document.querySelectorAll("#source-dropdown .dropdown-item");
    items.forEach(function (item) {
        item.classList.toggle("selected", item === el);
    });
    toggleSourceDropdown();
    glowElement(document.getElementById("source-select"));
    clearAllLayers();
}

// Close dropdown when clicking outside
document.addEventListener("click", function (e) {
    if (!e.target.closest("#source-select") && !e.target.closest("#source-dropdown")) {
        if (sourceOpen) {
            sourceOpen = false;
            document.getElementById("source-dropdown").style.display = "none";
        }
    }
});

// Mark initial selection
document.addEventListener("DOMContentLoaded", function () {
    var items = document.querySelectorAll("#source-dropdown .dropdown-item");
    if (items.length > 0) items[0].classList.add("selected");
});

// ── Toast & status bar ──────────────────────────────

var docsUrl = "https://noaa-ocs-hydrography.github.io/BlueTopo/";

function switchView(view) {
    document.getElementById("btn-view-app").classList.toggle("active", view === "app");
    document.getElementById("btn-view-docs").classList.toggle("active", view === "docs");
    var overlay = document.getElementById("docs-overlay");
    if (view === "docs") {
        document.getElementById("docs-frame").src = docsUrl;
        overlay.style.display = "block";
    } else {
        overlay.style.display = "none";
    }
}

function getToastBottom() {
    var base = 24 + 34 + 34 + 10; // statusbar + fetchbar + mosaicbar + padding
    var logHeader = document.getElementById("log-header");
    if (logHeader) base += logHeader.offsetHeight;
    if (logOpen) {
        var logPane = document.getElementById("log-pane");
        if (logPane) base += logPane.offsetHeight;
    }
    return base;
}

function showToast(msg, cls) {
    var container = document.getElementById("toast-container");
    var toast = document.createElement("div");
    toast.className = "toast" + (cls ? " " + cls : "");
    toast.textContent = msg;
    toast.style.bottom = getToastBottom() + "px";
    container.appendChild(toast);
    var duration = cls === "toast-welcome" ? 6000 : 4000;
    setTimeout(function () { toast.remove(); }, duration);
}

function setStatus(left, right) {
    document.getElementById("statusbar-left").textContent = left || "";
    document.getElementById("statusbar-right").textContent = right || "";
}

// ── Log streaming & results ─────────────────────────

var currentCommand = null;

var logOpen = false;

function showLog() {
    if (!logOpen) {
        logOpen = true;
        document.getElementById("log-pane").style.display = "block";
    }
}

function toggleLog() {
    logOpen = !logOpen;
    document.getElementById("log-pane").style.display = logOpen ? "block" : "none";
}

function appendLog(line) {
    var pre = document.getElementById("results");
    pre.textContent += line + "\n";
    var pane = document.getElementById("log-pane");
    pane.scrollTop = pane.scrollHeight;
}

function clearLog() {
    document.getElementById("results").textContent = "";
}

function showError(msg) {
    showLog();
    appendLog("Error: " + msg);
}

function stripAnsi(s) {
    return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// Called from Python via runJavaScript
function onLogLine(line) {
    line = stripAnsi(line);
    // tqdm lines contain "Tiles" and a percentage — replace instead of append
    if (line.indexOf("Tiles") >= 0 && line.indexOf("%") >= 0) {
        updateProgress(line);
    } else {
        appendLog(line);
    }
}

function updateProgress(line) {
    // Extract just the meaningful parts: "BlueTopo Fetch:  73% | 198/270 Tiles 00:10"
    var clean = line.replace(/\|[^|]*\|/, "|").replace(/[#█▏▎▍▌▋▊▉ ]+\|/, " | ");
    var pre = document.getElementById("results");
    var lines = pre.textContent.split("\n");
    // Replace last line if it was also a progress line
    if (lines.length > 1 && lines[lines.length - 2].indexOf("Tiles") >= 0) {
        lines[lines.length - 2] = clean;
        pre.textContent = lines.join("\n");
    } else {
        appendLog(clean);
    }
    var pane = document.getElementById("log-pane");
    pane.scrollTop = pane.scrollHeight;
}

function onCommandDone(data) {
    try {
        if (data.ok) {
            setStatus("Complete");
            showToast("Complete");
            // If fetch downloaded new tiles, refresh or invalidate tracked layer
            var fetched = data.result && data.result.downloaded && data.result.downloaded.length > 0;
            if (fetched) {
                if (trackedActive) {
                    reloadTrackedLayer();
                } else {
                    trackedCache.time = 0;
                }
            }
        } else {
            appendLog("Error: " + data.error);
            setStatus("Failed");
        }
    } finally {
        var doneLabel = "· " + currentCommand.charAt(0).toUpperCase() + currentCommand.slice(1) + " Done";
        currentCommand = null;
        setButtonsDisabled(false);
        document.getElementById("log-command").textContent = doneLabel;
    }
}

function getDir() {
    return document.getElementById("project-dir").value;
}

function getSource() {
    return document.getElementById("data-source").value;
}

function setButtonsDisabled(disabled) {
    var btns = ["btn-fetch", "btn-mosaic"];
    var msg = disabled ? "Waiting for current task to finish" : "";
    btns.forEach(function (id) {
        var btn = document.getElementById(id);
        btn.disabled = disabled;
        btn.title = msg;
    });
    var dot = document.getElementById("log-dot");
    if (dot) dot.classList.toggle("active", disabled);
}

function runCommand(name, fn) {
    if (!bridge) { showError("Bridge not ready"); return; }
    if (currentCommand) { showError("A command is already running."); return; }
    if (name === "fetch" && trackedLoading) { showToast("Waiting for your project to finish loading..."); return; }
    var dir = getDir();
    if (!dir) { showError("Please enter a project directory."); return; }

    currentCommand = name;
    clearLog();
    showLog();
    setButtonsDisabled(true);
    setStatus(name.charAt(0).toUpperCase() + name.slice(1) + "...");
    var runLabel = name === "fetch" ? "Fetching..." : "Mosaicing...";
    document.getElementById("log-command").textContent = "· " + runLabel;
    try {
        fn(dir);
    } catch (e) {
        currentCommand = null;
        setButtonsDisabled(false);
        showError(String(e));
    }
}

// ── Geometry field autocomplete ──────────────────────

function looksLikePath(val) {
    if (!val) return false;
    if (val.charAt(0) === "/" || val.charAt(0) === "\\") return true;
    if (val.length >= 2 && val.charAt(1) === ":" && /[a-zA-Z]/.test(val.charAt(0))) return true;
    if (val.charAt(0) === "~") return true;
    return false;
}

var geomDebounce = null;

function onGeomInput() {
    clearTimeout(geomDebounce);
    var val = document.getElementById("opt-geometry").value;
    if (!looksLikePath(val) || !bridge) {
        hideGeomSuggestions();
        return;
    }
    geomDebounce = setTimeout(function () {
        bridge.complete_path(val, function (response) {
            var paths = JSON.parse(response);
            var box = document.getElementById("geom-suggestions");
            if (paths.length === 0) {
                hideGeomSuggestions();
                return;
            }
            box.innerHTML = "";
            paths.forEach(function (p) {
                var div = document.createElement("div");
                div.textContent = p;
                div.onclick = function () {
                    document.getElementById("opt-geometry").value = p;
                    hideGeomSuggestions();
                };
                box.appendChild(div);
            });
            box.style.display = "block";
        });
    }, 150);
}

var geomSelectedIndex = -1;

document.getElementById("opt-geometry").addEventListener("keydown", function (e) {
    var box = document.getElementById("geom-suggestions");
    var items = box.querySelectorAll("div");
    if (items.length === 0) return;

    if (e.key === "ArrowDown") {
        e.preventDefault();
        geomSelectedIndex = Math.min(geomSelectedIndex + 1, items.length - 1);
        updateGeomSelection(items);
    } else if (e.key === "ArrowUp") {
        e.preventDefault();
        geomSelectedIndex = Math.max(geomSelectedIndex - 1, 0);
        updateGeomSelection(items);
    } else if (e.key === "Tab") {
        if (items.length > 0) {
            e.preventDefault();
            geomSelectedIndex = (geomSelectedIndex + 1) % items.length;
            updateGeomSelection(items);
            this.value = items[geomSelectedIndex].textContent;
            this.setSelectionRange(this.value.length, this.value.length);
        }
    } else if (e.key === "Enter") {
        e.preventDefault();
        if (geomSelectedIndex >= 0 && geomSelectedIndex < items.length) {
            this.value = items[geomSelectedIndex].textContent;
            this.setSelectionRange(this.value.length, this.value.length);
        }
        hideGeomSuggestions();
    } else if (e.key === "Escape") {
        hideGeomSuggestions();
    }
});

function updateGeomSelection(items) {
    items.forEach(function (item, i) {
        item.classList.toggle("active", i === geomSelectedIndex);
    });
    if (geomSelectedIndex >= 0 && items[geomSelectedIndex]) {
        items[geomSelectedIndex].scrollIntoView({ block: "nearest" });
    }
}

function hideGeomSuggestions() {
    document.getElementById("geom-suggestions").style.display = "none";
    geomSelectedIndex = -1;
}

document.getElementById("opt-geometry").addEventListener("blur", function () {
    setTimeout(hideGeomSuggestions, 150);
});

function browseGeometry() {
    if (!bridge) return;
    bridge.browse_geometry(function (path) {
        if (path) {
            document.getElementById("opt-geometry").value = path;
        }
    });
}

function getMosaicOptions() {
    var opts = {
        hillshade: document.getElementById("opt-hillshade").classList.contains("on"),
    };
    var w = document.getElementById("opt-workers").value;
    if (w) opts.workers = parseInt(w, 10);
    var r = document.getElementById("opt-resolution").value;
    if (r) opts.resolution_target = parseFloat(r);
    return JSON.stringify(opts);
}

function runFetch() {
    runCommand("fetch", function (dir) {
        var geom = document.getElementById("opt-geometry").value || "";
        var resFilter = document.getElementById("opt-fetch-resolution").value || "";
        bridge.fetch(dir, geom, getSource(), resFilter);
    });
}

function runMosaic() {
    runCommand("mosaic", function (dir) {
        bridge.mosaic(dir, getSource(), getMosaicOptions());
    });
}


