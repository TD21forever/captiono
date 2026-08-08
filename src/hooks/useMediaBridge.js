import { useCallback, useEffect, useRef, useState } from "react";

const DEMO_START_SECONDS = 178;
const DEMO_DURATION_SECONDS = 420;

function getChromeApi() {
  return typeof globalThis.chrome === "object" ? globalThis.chrome : null;
}

function getPageBridge() {
  const bridge = globalThis.__captionReviewPageBridge;
  return bridge?.request && bridge?.subscribe ? bridge : null;
}

function sameMediaBinding(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  return ["pageUrl", "title", "mediaSrc", "provider", "mediaId"].every(
    (key) => Object.is(left[key], right[key]),
  );
}

function mergeMediaState(current, next) {
  if (!next || typeof next !== "object") return current;
  const changed = Object.entries(next).some(([key, value]) =>
    key === "mediaBinding"
      ? !sameMediaBinding(current.mediaBinding, value)
      : !Object.is(current[key], value),
  );
  return changed ? { ...current, ...next } : current;
}

export function useMediaBridge() {
  const [media, setMedia] = useState({
    connected: false,
    currentTime: 188,
    duration: DEMO_DURATION_SECONDS,
    paused: true,
    title: "Captiono 示例",
    url: "",
    mediaSrc: "",
    provider: "",
    mediaId: "",
    seeking: false,
  });
  const demoTimerRef = useRef(null);

  useEffect(() => {
    const pageBridge = getPageBridge();
    if (pageBridge) {
      let active = true;
      const unsubscribe = pageBridge.subscribe((message) => {
        if (active && message?.type === "MEDIA_STATE" && message.state) {
          setMedia((current) => mergeMediaState(current, message.state));
        }
      });
      void pageBridge.request({ type: "GET_MEDIA_STATE" }).then((state) => {
        if (active && state) {
          setMedia((current) => mergeMediaState(current, state));
        }
      });
      return () => {
        active = false;
        unsubscribe();
      };
    }

    const chromeApi = getChromeApi();
    if (!chromeApi?.runtime?.onMessage) {
      return undefined;
    }

    const handleMessage = (message) => {
      if (message?.type === "MEDIA_STATE" && message.state) {
        setMedia((current) => mergeMediaState(current, message.state));
      }
    };

    chromeApi.runtime.onMessage.addListener(handleMessage);

    if (chromeApi.tabs?.query) {
      chromeApi.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (!tab?.id) return;
        chromeApi.tabs.sendMessage(
          tab.id,
          { type: "GET_MEDIA_STATE" },
          (state) => {
            if (!chromeApi.runtime.lastError && state) {
              setMedia((current) => mergeMediaState(current, state));
            }
          },
        );
      });
    }

    return () => chromeApi.runtime.onMessage.removeListener(handleMessage);
  }, []);

  useEffect(() => {
    if (media.connected || media.paused) {
      if (demoTimerRef.current) {
        window.clearInterval(demoTimerRef.current);
        demoTimerRef.current = null;
      }
      return undefined;
    }

    demoTimerRef.current = window.setInterval(() => {
      setMedia((current) => ({
        ...current,
        currentTime:
          current.currentTime >= 223
            ? DEMO_START_SECONDS
            : current.currentTime + 0.5,
      }));
    }, 500);

    return () => {
      if (demoTimerRef.current) {
        window.clearInterval(demoTimerRef.current);
        demoTimerRef.current = null;
      }
    };
  }, [media.connected, media.paused]);

  const sendToPage = useCallback((message) => {
    const pageBridge = getPageBridge();
    if (pageBridge) {
      void pageBridge.request(message).then((state) => {
        if (state) setMedia((current) => mergeMediaState(current, state));
      });
      return;
    }

    const chromeApi = getChromeApi();
    if (!chromeApi?.tabs?.query) return;
    chromeApi.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.id) chromeApi.tabs.sendMessage(tab.id, message);
    });
  }, []);

  const seek = useCallback(
    (seconds) => {
      setMedia((current) => ({ ...current, currentTime: seconds }));
      sendToPage({ type: "SEEK_TO", seconds });
    },
    [sendToPage],
  );

  const playFrom = useCallback(
    (seconds) => {
      setMedia((current) => ({
        ...current,
        currentTime: seconds,
        paused: false,
      }));
      sendToPage({ type: "SEEK_TO", seconds, play: true });
    },
    [sendToPage],
  );

  const togglePlay = useCallback(() => {
    setMedia((current) => ({ ...current, paused: !current.paused }));
    sendToPage({ type: "TOGGLE_PLAY" });
  }, [sendToPage]);

  return { media, playFrom, seek, togglePlay };
}
