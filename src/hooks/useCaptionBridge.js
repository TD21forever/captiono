import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CAPTION_COMMAND,
  CAPTION_STATUS,
  createCaptionState,
  normalizeCaptionState,
} from "../lib/captionSources.js";

function getChromeApi() {
  return typeof globalThis.chrome === "object" ? globalThis.chrome : null;
}

function getPageBridge() {
  const bridge = globalThis.__captionReviewPageBridge;
  return bridge?.request && bridge?.subscribe ? bridge : null;
}

function sendRuntimeMessage(chromeApi, message) {
  return new Promise((resolve) => {
    try {
      chromeApi.runtime.sendMessage(message, (response) => {
        const runtimeError = chromeApi.runtime.lastError;
        if (runtimeError) {
          resolve({
            status: CAPTION_STATUS.UNAVAILABLE,
            reason: "page-bridge-unreachable",
            message: runtimeError.message,
          });
          return;
        }
        resolve(
          response ?? {
            status: CAPTION_STATUS.UNAVAILABLE,
            reason: "empty-page-bridge-response",
            message: "当前页面没有返回字幕状态。",
          },
        );
      });
    } catch (error) {
      resolve({
        status: CAPTION_STATUS.ERROR,
        reason: "caption-request-failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

export function useCaptionBridge(media = null) {
  const [state, setState] = useState(() =>
    createCaptionState({
      status: CAPTION_STATUS.IDLE,
      reason: "not-requested",
    }),
  );
  const requestSequenceRef = useRef(0);

  const expectedMedia = useMemo(
    () =>
      media
        ? {
            url: media.url,
            title: media.title,
            mediaSrc: media.mediaSrc,
            provider: media.provider,
            mediaId: media.mediaId,
          }
        : null,
    [
      media?.mediaId,
      media?.mediaSrc,
      media?.provider,
      media?.title,
      media?.url,
    ],
  );

  const applyState = useCallback(
    (nextState) => {
      const normalized = normalizeCaptionState(nextState, expectedMedia);
      setState(normalized);
      return normalized;
    },
    [expectedMedia],
  );

  const request = useCallback(
    async (message) => {
      const sequence = ++requestSequenceRef.current;
      const applyIfCurrent = (nextState) =>
        sequence === requestSequenceRef.current
          ? applyState(nextState)
          : null;
      const pageBridge = getPageBridge();
      if (pageBridge) {
        setState((current) => ({
          ...createCaptionState(),
          status: CAPTION_STATUS.LOADING,
          reason: "requesting-page-captions",
          message: "",
          mediaBinding: expectedMedia ?? current.mediaBinding ?? null,
        }));
        try {
          return applyIfCurrent(await pageBridge.request(message));
        } catch (error) {
          return applyIfCurrent({
            status: CAPTION_STATUS.ERROR,
            reason: "caption-request-failed",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const chromeApi = getChromeApi();
      if (!chromeApi?.runtime?.sendMessage) {
        return applyIfCurrent({
          status: CAPTION_STATUS.UNAVAILABLE,
          reason: "extension-runtime-unavailable",
          message: "请在普通视频网页中打开 Captiono 扩展。",
        });
      }

      setState((current) => ({
        ...createCaptionState(),
        status: CAPTION_STATUS.LOADING,
        reason: "requesting-page-captions",
        message: "",
        mediaBinding: expectedMedia ?? current.mediaBinding ?? null,
      }));
      const response = await sendRuntimeMessage(chromeApi, message);
      return applyIfCurrent(response);
    },
    [applyState, expectedMedia],
  );

  useEffect(() => {
    const pageBridge = getPageBridge();
    if (pageBridge) {
      let active = true;
      const unsubscribe = pageBridge.subscribe((message) => {
        if (active && message?.type === "CAPTION_STATE" && message.state) {
          applyState(message.state);
        }
      });
      void request({ type: CAPTION_COMMAND.GET });
      return () => {
        active = false;
        requestSequenceRef.current += 1;
        unsubscribe();
      };
    }

    const chromeApi = getChromeApi();
    if (!chromeApi?.runtime?.onMessage) {
      applyState({
        status: CAPTION_STATUS.UNAVAILABLE,
        reason: "extension-runtime-unavailable",
        message: "网页预览不会伪造字幕，请在浏览器扩展中连接视频。",
      });
      return undefined;
    }

    const handleMessage = (message) => {
      if (message?.type === "CAPTION_STATE" && message.state) {
        applyState(message.state);
      }
    };

    chromeApi.runtime.onMessage.addListener(handleMessage);
    void request({ type: CAPTION_COMMAND.GET });

    return () => {
      requestSequenceRef.current += 1;
      chromeApi.runtime.onMessage.removeListener(handleMessage);
    };
  }, [applyState, request]);

  const refresh = useCallback(
    () => request({ type: CAPTION_COMMAND.REFRESH }),
    [request],
  );

  const selectTrack = useCallback(
    (trackId) =>
      request({
        type: CAPTION_COMMAND.SELECT_TRACK,
        trackId: String(trackId ?? ""),
      }),
    [request],
  );

  const selectLanguage = useCallback(
    (language) =>
      request({
        type: CAPTION_COMMAND.SELECT_TRACK,
        language: String(language ?? ""),
      }),
    [request],
  );

  return {
    state,
    status: state.status,
    document: state.document,
    tracks: state.document?.tracks ?? state.tracks,
    cues: state.document?.cues ?? [],
    selectedTrackId: state.document?.selectedTrackId ?? "",
    refresh,
    selectTrack,
    selectLanguage,
  };
}
