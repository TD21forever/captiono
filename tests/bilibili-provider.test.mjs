import assert from "node:assert/strict";
import test from "node:test";
import {
  BILIBILI_PAGE_SUBTITLE_SOURCE,
  isBilibiliPage,
  loadBilibiliCaptions,
} from "../extension/bilibili-provider.js";

function jsonResponse(payload, url) {
  return {
    headers: { get: () => null },
    ok: true,
    status: 200,
    url,
    async text() {
      return JSON.stringify(payload);
    },
  };
}

test("recognizes only Bilibili page origins", () => {
  assert.equal(isBilibiliPage("https://www.bilibili.com/video/BV123"), true);
  assert.equal(isBilibiliPage("https://api.bilibili.com/x/player/wbi/v2"), true);
  assert.equal(isBilibiliPage("https://example.com/video/BV123"), false);
});

test("loads the preferred English Bilibili subtitle and normalizes cues", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ init, url });
    if (url.includes("/x/player/wbi/v2")) {
      return jsonResponse(
        {
          data: {
            subtitle: {
              subtitles: [
                {
                  id: 11,
                  lan: "en-US",
                  lan_doc: "English (AI)",
                  type: 1,
                  subtitle_url:
                    "//i0.hdslb.com/bfs/subtitle/english-ai.json",
                },
                {
                  id: 12,
                  lan: "en-US",
                  lan_doc: "English",
                  type: 0,
                  subtitle_url:
                    "//i0.hdslb.com/bfs/subtitle/english-manual.json",
                },
                {
                  id: 13,
                  lan: "zh-CN",
                  lan_doc: "中文",
                  type: 0,
                  subtitle_url:
                    "//i0.hdslb.com/bfs/subtitle/chinese.json",
                },
              ],
            },
          },
        },
        url,
      );
    }
    assert.equal(
      url,
      "https://i0.hdslb.com/bfs/subtitle/english-manual.json",
    );
    return jsonResponse(
      {
        body: [
          { from: 3.08, to: 5.2, content: "It's <i>rooted</i> in reality." },
          { from: 5.2, to: 7.4, content: "A simple idea with a twist." },
        ],
      },
      url,
    );
  };

  const result = await loadBilibiliCaptions(
    {
      aid: 123,
      cid: 456,
      mediaId: "BV1xx411c7mD",
    },
    fetchImpl,
  );

  assert.equal(result.ok, true);
  assert.equal(result.source, BILIBILI_PAGE_SUBTITLE_SOURCE);
  assert.equal(result.selectedTrackId, "bilibili-12");
  assert.equal(result.language.code, "en-US");
  assert.equal(result.tracks.length, 3);
  assert.equal(result.tracks[1].isSelected, true);
  assert.deepEqual(result.cues, [
    {
      id: "bilibili-cue-1",
      sourceIndex: 0,
      startMs: 3080,
      endMs: 5200,
      text: "It's rooted in reality.",
      format: "bilibili-json",
    },
    {
      id: "bilibili-cue-2",
      sourceIndex: 1,
      startMs: 5200,
      endMs: 7400,
      text: "A simple idea with a twist.",
      format: "bilibili-json",
    },
  ]);
  assert.equal(calls[0].init.credentials, "include");
  assert.equal(calls[1].init.credentials, "omit");
});

test("resolves a BV page before requesting its subtitle manifest", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("/x/web-interface/view")) {
      return jsonResponse(
        {
          data: {
            aid: 777,
            pages: [
              { page: 1, cid: 1001 },
              { page: 2, cid: 1002 },
            ],
          },
        },
        url,
      );
    }
    if (url.includes("/x/player/wbi/v2")) {
      assert.match(url, /aid=777/);
      assert.match(url, /cid=1002/);
      return jsonResponse({ data: { subtitle: { subtitles: [] } } }, url);
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await loadBilibiliCaptions(
    { mediaId: "BV1xx411c7mD", page: 2 },
    fetchImpl,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "bilibili-no-caption-tracks");
  assert.equal(calls.length, 2);
});
