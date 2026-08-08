import assert from "node:assert/strict";
import test from "node:test";

import {
  rangeTextLengthIgnoringUi,
  rectRelativeTo,
} from "../src/lib/floatingGeometry.js";

test("converts viewport rectangles to stage-local coordinates", () => {
  const stage = {
    left: 320,
    top: 180,
  };
  const selection = {
    bottom: 476,
    height: 76,
    left: 548,
    right: 812,
    top: 400,
    width: 264,
  };

  assert.deepEqual(rectRelativeTo(selection, stage), {
    bottom: 296,
    height: 76,
    left: 228,
    right: 492,
    top: 220,
    width: 264,
  });
});

test("keeps viewport coordinates when no containing stage exists", () => {
  const rect = {
    bottom: 88,
    height: 48,
    left: 24,
    right: 224,
    top: 40,
    width: 200,
  };

  assert.deepEqual(rectRelativeTo(rect), rect);
  assert.equal(rectRelativeTo(null), null);
});

test("excludes inline annotation markers from transcript character offsets", () => {
  let markerRemoved = false;
  const fragment = {
    querySelectorAll(selector) {
      assert.equal(selector, "[data-selection-ignore]");
      return [
        {
          remove() {
            markerRemoved = true;
          },
        },
      ];
    },
    get textContent() {
      return markerRemoved ? "before after" : "before1 after";
    },
  };

  assert.equal(
    rangeTextLengthIgnoringUi({ cloneContents: () => fragment }),
    "before after".length,
  );
  assert.equal(rangeTextLengthIgnoringUi(null), 0);
});
