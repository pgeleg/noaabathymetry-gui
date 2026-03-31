"""Main application window with embedded web views."""

import os
from PySide6.QtCore import QUrl
from PySide6.QtWidgets import QMainWindow
from PySide6.QtWebEngineCore import QWebEngineSettings
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebChannel import QWebChannel
from src.bridge import Bridge


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("National Bathymetric Source")
        self.resize(1200, 800)

        self.web = QWebEngineView()
        self.setCentralWidget(self.web)

        settings = self.web.settings()
        settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True)

        self.bridge = Bridge(self)
        self.channel = QWebChannel()
        self.channel.registerObject("bridge", self.bridge)
        self.web.page().setWebChannel(self.channel)

        web_dir = os.path.join(os.path.dirname(__file__), "web")
        index_path = os.path.join(web_dir, "index.html")
        self.web.setUrl(QUrl.fromLocalFile(index_path))

    def closeEvent(self, event):
        """Kill everything on close — no orphan threads."""
        event.accept()
        os._exit(0)
