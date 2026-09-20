"""Serve HLS+audio web view on http://localhost:8765/

Equivalent to: `python -m imou web`
"""

from imou import Client
from imou.webview import WebViewServer

WebViewServer(Client(), port=8765).serve_forever()
