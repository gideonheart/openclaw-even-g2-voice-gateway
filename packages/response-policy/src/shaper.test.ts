import { describe, it, expect } from "vitest";
import { shapeResponse, normalizeText } from "./shaper.js";

describe("normalizeText", () => {
  it("strips control characters", () => {
    expect(normalizeText("hello\x00world")).toBe("helloworld");
    expect(normalizeText("hello\x07world")).toBe("helloworld");
  });

  it("preserves tabs and newlines", () => {
    expect(normalizeText("hello\tworld")).toBe("hello\tworld");
    expect(normalizeText("hello\nworld")).toBe("hello\nworld");
  });

  it("unifies line endings", () => {
    expect(normalizeText("hello\r\nworld")).toBe("hello\nworld");
    expect(normalizeText("hello\rworld")).toBe("hello\nworld");
  });

  it("collapses excessive newlines but preserves paragraphs", () => {
    expect(normalizeText("hello\n\nworld")).toBe("hello\n\nworld");
    expect(normalizeText("hello\n\n\n\nworld")).toBe("hello\n\nworld");
  });

  it("trims whitespace", () => {
    expect(normalizeText("  hello  ")).toBe("hello");
  });
});

describe("shapeResponse", () => {
  it("returns empty segments for empty text", () => {
    const result = shapeResponse("");
    expect(result.segments).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("returns single segment for short text", () => {
    const result = shapeResponse("Hello, world!");
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.text).toBe("Hello, world!");
    expect(result.segments[0]?.index).toBe(0);
    expect(result.segments[0]?.continuation).toBe(false);
    expect(result.truncated).toBe(false);
  });

  it("splits paragraphs into separate segments", () => {
    const text = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
    const result = shapeResponse(text);
    expect(result.segments).toHaveLength(3);
    expect(result.segments[0]?.text).toBe("First paragraph.");
    expect(result.segments[1]?.text).toBe("Second paragraph.");
    expect(result.segments[2]?.text).toBe("Third paragraph.");
  });

  it("marks continuation segments", () => {
    const longParagraph = "A".repeat(300) + ". " + "B".repeat(300) + ".";
    const result = shapeResponse(longParagraph, { maxSegmentChars: 350, maxSegments: 10, maxTotalChars: 5000 });

    expect(result.segments.length).toBeGreaterThan(1);
    expect(result.segments[0]?.continuation).toBe(false);
    expect(result.segments[1]?.continuation).toBe(true);
  });

  it("truncates text beyond maxTotalChars", () => {
    const longText = "Hello world. ".repeat(500);
    const result = shapeResponse(longText, { maxSegmentChars: 500, maxSegments: 20, maxTotalChars: 100 });
    expect(result.truncated).toBe(true);
  });

  it("respects maxSegments limit", () => {
    const manyParagraphs = Array.from(
      { length: 50 },
      (_, i) => `Paragraph ${i + 1}.`,
    ).join("\n\n");

    const result = shapeResponse(manyParagraphs, {
      maxSegmentChars: 500,
      maxSegments: 5,
      maxTotalChars: 50000,
    });
    expect(result.segments.length).toBeLessThanOrEqual(5);
  });

  it("prefers splitting at sentence boundaries", () => {
    const text =
      "First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence.";
    const result = shapeResponse(text, {
      maxSegmentChars: 50,
      maxSegments: 20,
      maxTotalChars: 5000,
    });

    // Each segment should end at a sentence boundary
    for (const segment of result.segments) {
      const lastChar = segment.text[segment.text.length - 1];
      expect(lastChar === "." || lastChar === "!" || lastChar === "?").toBe(
        true,
      );
    }
  });

  it("handles text with no paragraph breaks", () => {
    const text = "Single block of text with no breaks.";
    const result = shapeResponse(text);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.text).toBe(text);
  });

  it("normalizes control characters in input", () => {
    const text = "Hello\x00 world\x07!";
    const result = shapeResponse(text);
    expect(result.segments[0]?.text).toBe("Hello world!");
  });

  it("indexes segments sequentially across paragraphs", () => {
    const text = "First.\n\nSecond.\n\nThird.";
    const result = shapeResponse(text);
    expect(result.segments.map((s) => s.index)).toEqual([0, 1, 2]);
  });
});
