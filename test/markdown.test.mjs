import test from "node:test";
import assert from "node:assert/strict";
import { renderInline, renderMarkdown } from "../src/markdown.mjs";

const body = (source) => renderMarkdown(source).split("<body>")[1].split("</body>")[0].trim();

test("draws the blocks a document is actually made of", () => {
  assert.match(body("# 제목"), /^<h1>제목<\/h1>$/u);
  assert.match(body("- 하나\n- 둘"), /<ul>\n<li>하나<\/li>\n<li>둘<\/li>\n<\/ul>/u);
  assert.match(body("1. 첫째\n2. 둘째"), /<ol>\n<li>첫째<\/li>/u);
  assert.match(body("> 인용"), /<blockquote>\n<p>인용<\/p>\n<\/blockquote>/u);
  assert.match(body("---"), /<hr \/>/u);
  assert.match(body("| a | b |\n|---|---|\n| 1 | 2 |"), /<th>a<\/th><th>b<\/th>.*<td>1<\/td>/su);
});

test("shows markup as characters, wherever it appears", () => {
  // The frame this lands in has no script, so this is not the barrier -- but a
  // document that says <script> is talking about the word, and should read as it.
  assert.match(body("<script>alert(1)</script>"), /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.match(body("```\nconst x = 1 < 2;\n```"), /const x = 1 &lt; 2;/u);
  assert.doesNotMatch(body("<img onerror=x>"), /<img/u);
});

test("links only where a link can go", () => {
  // A document is not allowed to point at javascript:, at data:, or at a bare
  // path that would resolve against this app's own origin.
  assert.match(renderInline("[여기](https://a.example/x)"), /<a href="https:\/\/a\.example\/x"/u);
  assert.match(renderInline("[여기](https://a.example)"), /rel="noopener noreferrer"/u);
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "/api/servers", "vbscript:x"]) {
    const rendered = renderInline(`[여기](${bad})`);
    assert.doesNotMatch(rendered, /<a /u, `${bad} must not become a link`);
    assert.match(rendered, /여기/u, `${bad} must keep its text`);
  }
});

test("leaves what is inside a code span alone", () => {
  // The emphasis rules would otherwise open an italic on `*args` and never
  // close it, swallowing the rest of the line.
  assert.equal(renderInline("`*args*` 와 *진짜*"), "<code>*args*</code> 와 <em>진짜</em>");
  assert.equal(renderInline("`a < b`"), "<code>a &lt; b</code>");
});

test("does not mistake a number for a code span it put back", () => {
  // The marker has to be something a document cannot contain. A plainer one --
  // a bare index between spaces -- would be replaced out of ordinary prose.
  assert.equal(renderInline("`x` 는 3 이고 12 도 그렇다"), "<code>x</code> 는 3 이고 12 도 그렇다");
});

test("closes what it opened, even when the document does not", () => {
  // An unterminated fence at the end of a file is common in a draft; leaving
  // <pre> open would swallow everything after it in the frame.
  assert.match(body("```\nx"), /<pre><code>\nx\n<\/code><\/pre>/u);
  assert.match(body("- 하나\n\n문단"), /<\/ul>\n<p>문단<\/p>/u);
  assert.match(body("| a |\n|---|\n| 1 |\n\n문단"), /<\/tbody><\/table><\/div>\n<p>문단<\/p>/u);
});

test("carries the name into the title and escapes it", () => {
  assert.match(renderMarkdown("x", "보고서 <b>"), /<title>보고서 &lt;b&gt;<\/title>/u);
});
