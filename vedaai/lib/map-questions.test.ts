import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractedToMarkersAndLabels,
  matchMapAnswers,
  normalizeMarkerNumber,
  parseMapExtractJson,
  parseMapGradesJson,
  type MapLabel,
  type MapMarker,
} from "./map-questions";

describe("normalizeMarkerNumber", () => {
  it("collapses 1 / 01 / #1", () => {
    assert.equal(normalizeMarkerNumber(1), "1");
    assert.equal(normalizeMarkerNumber("01"), "1");
    assert.equal(normalizeMarkerNumber("#3"), "3");
    assert.equal(normalizeMarkerNumber(null), "");
  });
});

describe("parseMapExtractJson", () => {
  it("strips fences and keeps unlabeled markers", () => {
    const raw = `\`\`\`json
[{"markerNumber":1,"x":0.2,"y":0.3,"studentLabel":"Delhi"},{"markerNumber":null,"x":1.2,"y":-0.1,"studentLabel":null}]
\`\`\``;
    const items = parseMapExtractJson(raw, 1);
    assert.equal(items.length, 2);
    assert.equal(items[0].markerNumber, 1);
    assert.equal(items[0].studentLabel, "Delhi");
    assert.equal(items[1].markerNumber, null);
    assert.equal(items[1].studentLabel, null);
    assert.equal(items[1].x, 1);
    assert.equal(items[1].y, 0);
    assert.equal(items[1].page, 1);
  });

  it("returns [] on non-JSON instead of throwing", () => {
    assert.deepEqual(parseMapExtractJson("not json", 1), []);
  });
});

describe("matchMapAnswers", () => {
  const markers: MapMarker[] = [
    { id: "m1", markerNumber: "1", x: 0.2, y: 0.2, page: 1 },
    { id: "m2", markerNumber: "2", x: 0.3, y: 0.5, page: 1 },
    { id: "m3", markerNumber: "3", x: 0.6, y: 0.4, page: 1 },
  ];

  it("matches by number only — no positional fallback", () => {
    const labels: MapLabel[] = [
      { markerNumber: "2", labelText: "Mumbai", page: 1 },
      { markerNumber: "1", labelText: "Delhi", page: 1 },
    ];
    const result = matchMapAnswers(markers, labels);
    assert.equal(result.matched.length, 2);
    assert.equal(result.matched[0].marker.id, "m2");
    assert.equal(result.matched[1].marker.id, "m1");
    assert.equal(result.unansweredMarkers.length, 1);
    assert.equal(result.unansweredMarkers[0].id, "m3");
    assert.equal(result.orphanLabels.length, 0);
  });

  it("orphans a label whose number is missing on the map", () => {
    const labels: MapLabel[] = [
      { markerNumber: "9", labelText: "Paris", page: 1 },
    ];
    const result = matchMapAnswers(markers, labels);
    assert.equal(result.matched.length, 0);
    assert.equal(result.orphanLabels.length, 1);
    assert.equal(result.unansweredMarkers.length, 3);
  });
});

describe("extractedToMarkersAndLabels", () => {
  it("drops empty labels from the label list", () => {
    const { markers, labels } = extractedToMarkersAndLabels([
      {
        markerNumber: 1,
        x: 0.2,
        y: 0.2,
        page: 1,
        studentLabel: "Delhi",
      },
      { markerNumber: 3, x: 0.5, y: 0.5, page: 1, studentLabel: null },
    ]);
    assert.equal(markers.length, 2);
    assert.equal(labels.length, 1);
    const result = matchMapAnswers(markers, labels);
    assert.equal(result.unansweredMarkers[0].markerNumber, "3");
  });
});

describe("parseMapGradesJson", () => {
  it("keeps incorrect + correctAnswer", () => {
    const grades = parseMapGradesJson(
      '[{"markerNumber":"5","studentLabel":"Paris","verdict":"incorrect","correctAnswer":"Nagpur"}]',
    );
    assert.equal(grades[0].verdict, "incorrect");
    assert.equal(grades[0].correctAnswer, "Nagpur");
  });
});
