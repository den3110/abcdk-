"""Save a JPEG + record a 10-second MP4 clip from the first camera."""

from imou import Client

cam = Client().devices()[0]
print("Camera:", cam.name)

cam.snapshot("/tmp/snap.jpg")
print("→ /tmp/snap.jpg")

cam.record("/tmp/clip.mp4", seconds=10, with_audio=True)
print("→ /tmp/clip.mp4")
