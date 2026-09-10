import test from "node:test";
import assert from "node:assert/strict";
import { renderInline, renderMarkdown } from "../src/markdown.mjs";

const body = (source) => renderMarkdown(source).split("<body>")[1].split("</body>")[0].trim();

test("draws the blocks a document is actually made of", () => {
  assert.match(body("# 제목"), /<h1>제목<\/h1>/u);
  assert.match(body("- 하나\n- 둘"), /<ul>[\s\S]*<li>하나<\/li>[\s\S]*<li>둘<\/li>[\s\S]*<\/ul>/u);
  assert.match(body("1. 첫째\n2. 둘째"), /<ol[^>]*>[\s\S]*<li>첫째<\/li>/u);
  assert.match(body("> 인용"), /<blockquote>[\s\S]*인용[\s\S]*<\/blockquote>/u);
  assert.match(body("---"), /<hr\s*\/?>/u);
  assert.match(body("| a | b |\n|---|---|\n| 1 | 2 |"), /<th>a<\/th>[\s\S]*<td>1<\/td>/u);
  assert.match(body("```\nx = 1\n```"), /<pre><code>x = 1/u);
});

test("gets right the shapes a line-at-a-time reader got wrong", () => {
  // These are why the parsing is not hand-rolled: each one is ordinary in a
  // real document, and each one used to come out as something else.
  assert.match(body("- 하나\n  - 하위"), /<ul>[\s\S]*하나[\s\S]*<ul>[\s\S]*<li>하위<\/li>[\s\S]*<\/ul>/u,
    "중첩 목록이 평평해지지 않는다");
  assert.match(body("- [ ] 할 일"), /<input[^>]*type="checkbox"/u, "체크박스가 상자로 나온다");
  assert.match(body("제목\n===="), /<h1>제목<\/h1>/u, "밑줄식 제목도 제목이다");
  assert.match(body("한 줄\n이어짐"), /<p>한 줄\n이어짐<\/p>/u, "이어 쓴 문단은 한 문단이다");
  assert.match(body("    x = 1"), /<pre><code>x = 1/u, "들여쓴 코드 블록도 코드다");
});

test("shows embedded markup as characters, wherever it appears", () => {
  // The frame this lands in has no script, so this is not the barrier -- but a
  // document that says <script> is talking about the word and should read as it.
  assert.match(body("<script>alert(1)</script>"), /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.doesNotMatch(body("<img onerror=x>"), /<img/u);
  assert.match(body("```\nconst x = 1 < 2;\n```"), /1 &lt; 2/u);
});

test("links only where a link can go", () => {
  // marked emits whatever href it was given; deciding which ones may become
  // links is this module's job, not its.
  assert.match(renderInline("[여기](https://a.example/x)"), /<a href="https:\/\/a\.example\/x"/u);
  assert.match(renderInline("[여기](https://a.example)"), /rel="noopener noreferrer"/u);
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "/api/servers", "vbscript:x", "#anchor"]) {
    const rendered = renderInline(`[여기](${bad})`);
    assert.doesNotMatch(rendered, /<a /u, `${bad} must not become a link`);
    assert.match(rendered, /여기/u, `${bad} must keep its text`);
  }
});

test("shows an image only from somewhere the frame may fetch", () => {
  // A relative path resolves against this app and the frame's policy refuses
  // it, which reads as a broken icon and no explanation.
  assert.match(renderInline("![그림](https://a.example/x.png)"), /<img src="https:\/\/a\.example\/x\.png"/u);
  assert.doesNotMatch(renderInline("![그림](./shot.png)"), /<img/u);
  assert.match(renderInline("![그림](./shot.png)"), /그림/u);
});

test("leaves what is inside a code span alone", () => {
  assert.match(renderInline("`*args*` 와 *진짜*"), /<code>\*args\*<\/code> 와 <em>진짜<\/em>/u);
  assert.match(renderInline("`a < b`"), /<code>a &lt; b<\/code>/u);
});

test("carries the name into the title and escapes it", () => {
  assert.match(renderMarkdown("x", "보고서 <b>"), /<title>보고서 &lt;b&gt;<\/title>/u);
});

test("returns a whole document, styled, in both themes", () => {
  // It is framed on its own, so it brings its own head: nothing of the app's
  // stylesheet reaches inside.
  const page = renderMarkdown("# x", "x");
  assert.match(page, /^<!doctype html>/u);
  assert.match(page, /<meta name="viewport"/u);
  assert.match(page, /prefers-color-scheme: dark/u);
});
