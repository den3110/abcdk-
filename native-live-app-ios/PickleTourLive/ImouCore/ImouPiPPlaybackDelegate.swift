// ImouPiPPlaybackDelegate.swift
// AVPictureInPictureController requires a playbackDelegate that handles
// playback control callbacks (play/pause/skip/etc). For live camera
// streams most of these are no-ops — the camera is real-time, no seek.
// We report "live, never paused" + ignore skip/scrubbing requests.

import AVKit
import CoreMedia

@available(iOS 15.0, *)
final class ImouPiPPlaybackDelegate: NSObject,
    AVPictureInPictureSampleBufferPlaybackDelegate {

  static let shared = ImouPiPPlaybackDelegate()

  func pictureInPictureController(
    _ pip: AVPictureInPictureController,
    setPlaying playing: Bool
  ) {
    // We never actually pause the layer for live streams; PiP UI shows
    // play/pause button but pressing it has no effect on the camera feed.
    // (Could be wired up to Player.renderer.setPaused if useful.)
  }

  func pictureInPictureControllerTimeRangeForPlayback(
    _ pip: AVPictureInPictureController
  ) -> CMTimeRange {
    // Returning .positiveInfinity .duration tells PiP this is live —
    // no scrubber UI is shown.
    return CMTimeRange(start: .negativeInfinity, duration: .positiveInfinity)
  }

  func pictureInPictureControllerIsPlaybackPaused(
    _ pip: AVPictureInPictureController
  ) -> Bool {
    return false
  }

  func pictureInPictureController(
    _ pip: AVPictureInPictureController,
    didTransitionToRenderSize newRenderSize: CMVideoDimensions
  ) {
    // Track if needed for analytics; not used here.
  }

  func pictureInPictureController(
    _ pip: AVPictureInPictureController,
    skipByInterval skipInterval: CMTime,
    completion: @escaping () -> Void
  ) {
    // No-op for live; required by protocol.
    completion()
  }
}
