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

test("renders the operations meeting workspace static page", async () => {
  const html = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>定例会議ワークスペース<\/title>/i);
  assert.match(html, /認証/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("ships finished metadata and a project-owned social card", async () => {
  const [page, layout, packageJson, css, socialCard] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    stat(new URL("../public/og-decision.png", import.meta.url)),
  ]);

  assert.match(page, /会議資料/);
  assert.match(page, /AIで.*生成/);
  assert.match(layout, /定例会議ワークスペース/);
  assert.match(layout, /\/og-decision\.png/);
  assert.match(css, /--background|--surface/);
  assert.doesNotMatch(page, /_sites-preview|SkeletonPreview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.ok(socialCard.size > 100_000);
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
});

test("ships the decision-support workflow without browser database or AI clients", async () => {
  const [page, actions, types, prompt] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/meeting-types.ts", import.meta.url), "utf8"),
    readFile(new URL("../prompts/decision-support.md", import.meta.url), "utf8"),
  ]);

  assert.match(page, /AIで整理/);
  assert.match(page, /本人確認/);
  assert.match(page, /今回の判断準備率/);
  assert.match(page, /判断情報が未完成の報告があります/);
  assert.match(actions, /decision-support|analyzeDecisionSupportAction/);
  assert.match(actions, /responseJsonSchema/);
  assert.match(actions, /再生成指示/);
  assert.match(actions, /4項目を生成できませんでした/);
  assert.match(prompt, /最も大きく、会議で優先して扱うべき問題を1つ選び/);
  assert.match(prompt, /4項目をすべて埋める/);
  assert.match(page, /AI案を4項目に入力し、保存しました/);
  assert.match(page, /mat-decision-support/);
  assert.match(page, /previousItem\.decisionSupport/);
  assert.match(types, /problem\?: string/);
  assert.match(types, /decisionSupportVersion\?: 1/);
  await assert.rejects(access(new URL("../app/gemini-client.ts", import.meta.url)));
  await assert.rejects(access(new URL("../app/neon-client.ts", import.meta.url)));
});
