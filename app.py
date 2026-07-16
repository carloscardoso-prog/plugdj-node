import os
import webview

# Libera autoplay no QtWebEngine (necessário para o vídeo de fundo)
os.environ.setdefault(
    "QTWEBENGINE_CHROMIUM_FLAGS",
    "--autoplay-policy=no-user-gesture-required"
)

# Resolução exata da imagem de fundo (assets/home/join.jpg)
WIDTH = 1574
HEIGHT = 1080

if __name__ == "__main__":
    webview.create_window(
        "plug.dj",
        "index.html",
        width=WIDTH,
        height=HEIGHT,
        maximized=True,
    )
    webview.start()
