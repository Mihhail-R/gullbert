import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateDialogue } from "../scripts/dialogue.mjs";
import { dialogue } from "../web-dist/simulation/dialogue.js";
import { Gullbert } from "../web-dist/simulation/engine.js";
import { Mood } from "../web-dist/simulation/behaviors/moods.js";
import { reach } from "./simulation-helpers.mjs";
import {
  Belongings,
  GREETING_COOLDOWN_MS,
} from "../web-dist/simulation/belongings.js";

const authored = JSON.parse(
  readFileSync(
    new URL("../src/simulation/dialogue.json", import.meta.url),
    "utf8",
  ),
);

test("built dialogue matches the validated authored catalog", () => {
  validateDialogue(authored);
  assert.deepEqual(dialogue, authored);
});

test("content validation reports empty banks, blank lines, duplicates and bad placeholders", () => {
  const cases = [
    [
      (c) => {
        c.gullbert.general.remarks = [];
      },
      /general.remarks/,
    ],
    [
      (c) => {
        c.gullbert.touch.fineOneHeadScratch = " ";
      },
      /fineOneHeadScratch/,
    ],
    [
      (c) => {
        c.gullbert.hats.captain.push(c.gullbert.hats.captain[0]);
      },
      /duplicate/,
    ],
    [
      (c) => {
        c.gullbert.greetings.treasure[0] = "my {itme}.";
      },
      /unknown placeholder/,
    ],
    [
      (c) => {
        c.gullbert.greetings.treasure[0] = "my treasure.";
      },
      /need \{item\}/,
    ],
    [
      (c) => {
        c.guests.pigeon.inspect[0] = { gullbert: "", visitor: "" };
      },
      /at least one line/,
    ],
    [
      (c) => {
        delete c.guests.pigeon.inspect[0].visitor;
      },
      /both speakers/,
    ],
  ];

  for (const [edit, error] of cases) {
    const copy = structuredClone(authored);
    edit(copy);
    assert.throws(() => validateDialogue(copy), error);
  }
});

test("a single remaining greeting or mood option remains speakable on repetition", () => {
  const moodLines = dialogue.gullbert.moods.curious;
  const greetingLines = dialogue.gullbert.greetings.return;
  const savedMood = [...moodLines];
  const savedGreetings = [...greetingLines];

  try {
    moodLines.splice(1);
    greetingLines.splice(1);
    const mood = new Mood(
      () => 0,
      () => {},
    );
    mood.set("curious", 0);
    assert.equal(mood.remark(1), moodLines[0]);
    const belongings = new Belongings(800, 600);
    belongings.greet(0, () => 0);
    assert.equal(
      belongings.greet(GREETING_COOLDOWN_MS, () => 0),
      greetingLines[0],
    );
    assert.equal(
      belongings.greet(2 * GREETING_COOLDOWN_MS, () => 0),
      greetingLines[0],
    );
  } finally {
    moodLines.splice(0, moodLines.length, ...savedMood);
    greetingLines.splice(0, greetingLines.length, ...savedGreetings);
  }
});

test("repeat guest visits rotate paired dialogue independently for each species", () => {
  const sim = new Gullbert(900, 650, () => 0.5);
  sim.configure({ paused: true, sound: false, mischief: 0 });
  const previous = new Map();

  for (let visit = 0; visit < 3; visit++) {
    for (const [command, species, phase, beat] of [
      ["invite_pigeon", "pigeon", "faceoff", "faceoffWithoutSnacks"],
      ["gull_argument", "seagull", "posture", "posture"],
    ]) {
      sim.action(command);
      reach(sim, phase);
      const alternatives = dialogue.guests[species][beat];
      const opening = sim.inspect().bubble;
      const exchange = alternatives.find((pair) => pair.gullbert === opening);
      assert.ok(exchange, `${species} speaks an authored exchange`);
      assert.notEqual(opening, previous.get(species));
      previous.set(species, opening);

      for (let tick = 0; tick < 200 && !sim.present().guestSpeech; tick++) {
        sim.step(0.05);
      }

      assert.equal(sim.present().guestSpeech?.text, exchange.visitor);
      sim.action("cancel");
    }
  }
});
