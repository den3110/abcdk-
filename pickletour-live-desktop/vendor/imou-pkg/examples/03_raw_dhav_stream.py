"""Pipe the live DHAV stream through your own ffmpeg/PyAV pipeline.

This is the building block for custom workflows (object detection, etc.).
"""

import subprocess

from imou import Client

cam = Client().devices()[0]

# Anything DHAV-aware can consume the bytes — ffmpeg here just remuxes to mp4.
ff = subprocess.Popen(
    ["ffmpeg", "-y", "-f", "dhav", "-i", "pipe:0",
     "-t", "8", "-c", "copy", "/tmp/raw_demo.mp4"],
    stdin=subprocess.PIPE,
)

with cam.open_rtsp(with_audio=True) as rtsp:
    for chunk in rtsp:
        try:
            ff.stdin.write(chunk)
        except BrokenPipeError:
            break

ff.stdin.close()
ff.wait()
print("→ /tmp/raw_demo.mp4")
