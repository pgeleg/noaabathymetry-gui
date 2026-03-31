"""Entry point for the noaabathymetry GUI application."""

import sys
from PySide6.QtWidgets import QApplication
from src.window import MainWindow


def main():
    app = QApplication(sys.argv)
    app.setApplicationName("National Bathymetric Source")
    window = MainWindow()
    window.show()

    # Close PyInstaller splash screen if present (Windows/Linux only)
    try:
        import pyi_splash
        pyi_splash.close()
    except ImportError:
        pass

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
