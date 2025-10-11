// services/obs.service.js
import OBSWebSocket from "obs-websocket-js";

const OBS_URL = process.env.OBS_WS_URL || "ws://127.0.0.1:4455";
const OBS_PASSWORD = process.env.OBS_WS_PASSWORD || "";
const SCENE_NAME = process.env.OBS_SCENE_NAME || "PickleTour LIVE";
const OVERLAY_SOURCE_NAME =
  process.env.OBS_OVERLAY_SOURCE || "PickleTour Overlay";
const W = Number(process.env.OBS_WIDTH || 1920);
const H = Number(process.env.OBS_HEIGHT || 1080);
const FPS = Number(process.env.OBS_FPS || 30);

let _obs = null;
let _connected = false;

// Kết nối (re-use 1 connection)
export async function getObs() {
  if (_obs && _connected) return _obs;
  _obs = new OBSWebSocket();
  await _obs.connect(OBS_URL, OBS_PASSWORD);
  _connected = true;
  _obs.on("ConnectionClosed", () => (_connected = false));
  return _obs;
}

async function ensureVideoSettings(obs) {
  try {
    await obs.call("SetVideoSettings", {
      baseWidth: W,
      baseHeight: H,
      outputWidth: W,
      outputHeight: H,
      fpsNumerator: FPS,
      fpsDenominator: 1,
    });
  } catch (e) {
    // Không chặn flow nếu OBS từ chối thay đổi (đang stream/record)
  }
}

async function ensureScene(obs, sceneName) {
  const { scenes } = await obs.call("GetSceneList");
  const have = scenes.find((s) => s.sceneName === sceneName);
  if (!have) await obs.call("CreateScene", { sceneName });
  // luôn switch về scene cần phát
  await obs.call("SetCurrentProgramScene", { sceneName });
}

async function ensureOverlayBrowserSource(obs, sceneName, sourceName, url) {
  // thử tìm input sẵn có
  const { inputs } = await obs.call("GetInputList");
  const exist = inputs.find(
    (i) => i.inputName === sourceName && i.inputKind === "browser_source"
  );

  if (!exist) {
    const r = await obs.call("CreateInput", {
      sceneName,
      inputName: sourceName,
      inputKind: "browser_source",
      inputSettings: {
        url,
        width: W,
        height: H,
        fps: FPS,
        reroute_audio: false,
      },
    });
    // đưa overlay lên top
    await obs.call("SetSceneItemIndex", {
      sceneName,
      sceneItemId: r.sceneItemId,
      sceneItemIndex: 999,
    });
  } else {
    // cập nhật URL/size nếu đã tồn tại
    await obs.call("SetInputSettings", {
      inputName: sourceName,
      inputSettings: {
        url,
        width: W,
        height: H,
        fps: FPS,
        reroute_audio: false,
      },
      overlay: true, // merge
    });
  }
}

async function setRtmpAndStart(obs, { server, key }) {
  // set custom RTMP
  await obs.call("SetStreamServiceSettings", {
    streamServiceType: "rtmp_custom",
    streamServiceSettings: {
      server,
      key,
      bwtest: false,
    },
  });

  const { outputActive } = await obs.call("GetStreamStatus");
  if (!outputActive) {
    await obs.call("StartStream");
  }
}

export async function startObsStreamingWithOverlay({
  server_url,
  stream_key,
  overlay_url,
}) {
  const obs = await getObs();
  await ensureVideoSettings(obs);
  await ensureScene(obs, SCENE_NAME);
  await ensureOverlayBrowserSource(
    obs,
    SCENE_NAME,
    OVERLAY_SOURCE_NAME,
    overlay_url
  );
  await setRtmpAndStart(obs, { server: server_url, key: stream_key });
  return {
    started: true,
    scene: SCENE_NAME,
    overlaySource: OVERLAY_SOURCE_NAME,
  };
}
