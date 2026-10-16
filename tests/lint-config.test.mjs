import assert from "node:assert/strict";
import test from "node:test";
import { ESLint } from "eslint";

const eslint = new ESLint();

test("complexity above ten warns without becoming a lint error", async () => {
  const branch = "  if (ready) {\n    work();\n  }\n";
  const atLimit = `function act() {\n${Array(9)
    .fill(branch)
    .join("\n")}}\n`;
  const aboveLimit = `function act() {\n${Array(10)
    .fill(branch)
    .join("\n")}}\n`;
  const options = { filePath: "src/style-fixture.ts" };
  const [accepted] = await eslint.lintText(atLimit, options);
  const [warned] = await eslint.lintText(aboveLimit, options);

  assert.equal(accepted.warningCount, 0);
  assert.equal(accepted.errorCount, 0);
  assert.equal(warned.errorCount, 0);
  assert.equal(warned.warningCount, 1);
  assert.equal(warned.messages[0].ruleId, "complexity");
  assert.equal(warned.messages[0].severity, 1);
});

async function lint(code) {
  const [result] = await eslint.lintText(code, { filePath: "src/style-fixture.ts" });
  assert.equal(result.fatalErrorCount, 0);
  return result.messages;
}

test("style accepts spaced TypeScript guards and grouped switch labels", async () => {
  const messages = await lint(`function act(mode: string): void {
  if (!mode) {
    return;
  }

  switch (mode) {
    case "walk":
    case "run":
      move();
      break;

    default:
      rest();
  }
}
`);
  assert.deepEqual(messages, []);
});

test("style reports missing braces, padding, and nested ternaries", async () => {
  const messages = await lint(`function act(ready: boolean) {
  if (!ready) return;
  const pose = ready ? (moving ? "walk" : "stand") : "rest";
  return pose;
}
`);
  const rules = messages.map((message) => message.ruleId);
  assert.ok(rules.includes("curly"));
  assert.ok(rules.includes("@stylistic/padding-line-between-statements"));
  assert.ok(rules.includes("no-nested-ternary"));
});

test("style checks the exact width boundary and chained transformations", async () => {
  assert.deepEqual(await lint(`//${"x".repeat(98)}\n`), []);
  const wide = await lint(`//${"x".repeat(99)}\n`);
  assert.ok(wide.some((message) => message.ruleId === "@stylistic/max-len"));

  const chain = await lint("const names = items.filter(active).map(name).sort();\n");
  assert.ok(chain.some((message) => message.ruleId === "@stylistic/newline-per-chained-call"));
});

test("style accepts expanded calls and fixes layout without repeated changes", async () => {
  const code = `function act() {
  if (!ready) return;
  send(first,
    second, third);
}
`;
  const fixer = new ESLint({ fix: true });
  const [first] = await fixer.lintText(code, { filePath: "src/style-fixture.ts" });
  assert.equal(first.errorCount, 0);
  const [second] = await fixer.lintText(first.output, { filePath: "src/style-fixture.ts" });
  assert.equal(second.errorCount, 0);
  assert.equal(second.output, undefined);
});
