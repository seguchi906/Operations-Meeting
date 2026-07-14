import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", process.pid + "-" + Date.now());
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the operations meeting workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>定例会議ワークスペース<\/title>/i);
  assert.match(html, /会議資料作成/);
  assert.match(html, /議題・担当者/);
  assert.match(html, /トランスクリプト/);
  assert.match(html, /議事録作成/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("ships finished metadata and a project-owned social card", async () => {
  const [page, layout, packageJson, css, socialCard] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    stat(new URL("../public/og.png", import.meta.url)),
  ]);

  assert.match(page, /会議資料作成/);
  assert.match(page, /AIで再生成/);
  assert.match(layout, /定例会議ワークスペース/);
  assert.match(layout, /\/og\.png/);
  assert.match(css, /grid-template-columns:\s*224px 286px/);
  assert.doesNotMatch(page, /_sites-preview|SkeletonPreview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.ok(socialCard.size > 100_000);
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
});
