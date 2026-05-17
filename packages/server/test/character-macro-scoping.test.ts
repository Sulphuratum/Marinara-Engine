import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { DB } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrate.js";
import {
  apiConnections,
  characters,
  chats,
  lorebookEntries,
  lorebooks,
  messages,
  promptPresets,
  promptSections,
} from "../src/db/schema/index.js";
import { generateRoutes } from "../src/routes/generate.routes.js";

const now = "2026-05-16T12:00:00.000Z";

function characterData(name: string, description: string, mesExample: string) {
  return {
    name,
    description,
    personality: "",
    scenario: "",
    first_mes: "",
    mes_example: mesExample,
    creator_notes: "",
    system_prompt: "",
    post_history_instructions: "",
    alternate_greetings: [],
    tags: [],
    creator: "",
    character_version: "",
    extensions: {},
  };
}

function generationParameters() {
  return {
    temperature: 1,
    topP: 1,
    topK: 0,
    minP: 0,
    maxTokens: 64,
    maxContext: 4096,
    frequencyPenalty: 0,
    presencePenalty: 0,
    reasoningEffort: null,
    verbosity: null,
    assistantPrefill: "",
    customParameters: {},
    squashSystemMessages: false,
    showThoughts: true,
    useMaxContext: false,
    stopSequences: [],
    strictRoleFormatting: false,
    singleUserMessage: false,
  };
}

function readRequestBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? (JSON.parse(body) as Record<string, unknown>) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function writeChatCompletion(res: ServerResponse, content: string) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      id: "chatcmpl-character-macro",
      object: "chat.completion",
      created: 0,
      model: "character-macro-model",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
  );
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function messageText(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  return messages
    .map((message) => {
      if (!message || typeof message !== "object") return "";
      return String((message as { content?: unknown }).content ?? "");
    })
    .join("\n");
}

test("individual group generation resolves {{char}} for the selected responder", async () => {
  const providerRequests: Record<string, unknown>[] = [];
  const providerServer = createServer(async (req, res) => {
    providerRequests.push(await readRequestBody(req));
    const replyNumber = providerRequests.length;
    writeChatCompletion(res, replyNumber === 1 ? "Alice replies." : "Bob replies.");
  });
  const providerUrl = await new Promise<string>((resolve, reject) => {
    providerServer.once("error", reject);
    providerServer.listen(0, "127.0.0.1", () => {
      const address = providerServer.address();
      assert.ok(address && typeof address === "object");
      resolve(`http://127.0.0.1:${address.port}/v1`);
    });
  });

  const client = createClient({ url: "file::memory:" });
  const db = drizzle(client) as unknown as DB;

  try {
    await runMigrations(db);

    await db.insert(apiConnections).values({
      id: "conn-character-macro",
      name: "Character macro connection",
      provider: "custom",
      baseUrl: providerUrl,
      apiKeyEncrypted: "",
      model: "character-macro-model",
      maxContext: 4096,
      isDefault: "false",
      useForRandom: "false",
      enableCaching: "false",
      defaultForAgents: "false",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(characters).values([
      {
        id: "char-alice",
        data: JSON.stringify(characterData("Alice", "Alice is a mage.", "Alice: hello from Alice")),
        comment: "",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "char-bob",
        data: JSON.stringify(characterData("Bob", "{{char}} is a knight.", "{{char}}: hello from Bob")),
        comment: "",
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(promptPresets).values({
      id: "preset-character-macro",
      name: "Character macro repro preset",
      description: "",
      sectionOrder: JSON.stringify(["section-output", "section-character", "section-examples", "section-lorebook"]),
      groupOrder: "[]",
      variableGroups: "[]",
      variableValues: JSON.stringify({ pov: "limited narration from {{char}}'s perspective" }),
      parameters: JSON.stringify(generationParameters()),
      wrapFormat: "xml",
      defaultChoices: "{}",
      isDefault: "false",
      author: "test",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(promptSections).values([
      {
        id: "section-output",
        presetId: "preset-character-macro",
        identifier: "output",
        name: "Output Format",
        content: "Write {{pov}}.",
        role: "system",
        enabled: "true",
        isMarker: "false",
        groupId: null,
        markerConfig: null,
        injectionPosition: "ordered",
        injectionDepth: 0,
        injectionOrder: 100,
        wrapInXml: "false",
        xmlTagName: "",
        forbidOverrides: "false",
      },
      {
        id: "section-character",
        presetId: "preset-character-macro",
        identifier: "character",
        name: "Character Info",
        content: "",
        role: "system",
        enabled: "true",
        isMarker: "true",
        groupId: null,
        markerConfig: JSON.stringify({ type: "character", characterFields: ["description"] }),
        injectionPosition: "ordered",
        injectionDepth: 0,
        injectionOrder: 100,
        wrapInXml: "false",
        xmlTagName: "",
        forbidOverrides: "false",
      },
      {
        id: "section-examples",
        presetId: "preset-character-macro",
        identifier: "dialogueExamples",
        name: "Dialogue Examples",
        content: "",
        role: "system",
        enabled: "true",
        isMarker: "true",
        groupId: null,
        markerConfig: JSON.stringify({ type: "dialogue_examples" }),
        injectionPosition: "ordered",
        injectionDepth: 0,
        injectionOrder: 100,
        wrapInXml: "false",
        xmlTagName: "",
        forbidOverrides: "false",
      },
      {
        id: "section-lorebook",
        presetId: "preset-character-macro",
        identifier: "lorebook",
        name: "Lorebook",
        content: "",
        role: "system",
        enabled: "true",
        isMarker: "true",
        groupId: null,
        markerConfig: JSON.stringify({ type: "lorebook" }),
        injectionPosition: "ordered",
        injectionDepth: 0,
        injectionOrder: 100,
        wrapInXml: "false",
        xmlTagName: "",
        forbidOverrides: "false",
      },
    ]);

    await db.insert(lorebooks).values({
      id: "lorebook-character-macro",
      name: "Character macro lorebook",
      description: "",
      category: "test",
      scanDepth: 2,
      tokenBudget: 2048,
      recursiveScanning: "false",
      maxRecursionDepth: 3,
      characterId: null,
      personaId: null,
      chatId: "chat-character-macro",
      isGlobal: "false",
      enabled: "true",
      tags: "[]",
      generatedBy: null,
      sourceAgentId: null,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(lorebookEntries).values({
      id: "lore-entry-character-macro",
      lorebookId: "lorebook-character-macro",
      folderId: null,
      name: "Constant entry",
      content: "LORE_NAME={{char}}",
      description: "",
      keys: "[]",
      secondaryKeys: "[]",
      enabled: "true",
      constant: "true",
      selective: "false",
      selectiveLogic: "and",
      probability: null,
      scanDepth: null,
      matchWholeWords: "false",
      caseSensitive: "false",
      useRegex: "false",
      characterFilterMode: "any",
      characterFilterIds: "[]",
      characterTagFilterMode: "any",
      characterTagFilters: "[]",
      generationTriggerFilterMode: "any",
      generationTriggerFilters: "[]",
      additionalMatchingSources: "[]",
      position: 0,
      depth: 4,
      order: 100,
      role: "system",
      sticky: null,
      cooldown: null,
      delay: null,
      ephemeral: null,
      group: "",
      groupWeight: null,
      locked: "false",
      tag: "",
      relationships: "{}",
      dynamicState: "{}",
      activationConditions: "[]",
      schedule: null,
      preventRecursion: "false",
      excludeFromVectorization: "false",
      embedding: null,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(chats).values({
      id: "chat-character-macro",
      name: "Character macro repro",
      mode: "roleplay",
      characterIds: JSON.stringify(["char-alice", "char-bob"]),
      promptPresetId: "preset-character-macro",
      connectionId: "conn-character-macro",
      metadata: JSON.stringify({
        groupChatMode: "individual",
        groupResponseOrder: "sequential",
        activeLorebookIds: ["lorebook-character-macro"],
      }),
      createdAt: now,
      updatedAt: now,
    });

    const app = Fastify({ logger: false });
    app.decorate("db", db);
    try {
      await app.register(generateRoutes, { prefix: "/api/generate" });
      await app.ready();

      const response = await app.inject({
        method: "POST",
        url: "/api/generate/",
        payload: {
          chatId: "chat-character-macro",
          connectionId: "conn-character-macro",
          userMessage: "Hello",
          streaming: false,
        },
      });

      assert.equal(response.statusCode, 200);
      assert.equal(providerRequests.length, 2);

      const bobRequest = providerRequests.find((body) => messageText(body).includes("Respond ONLY as Bob."));
      assert.ok(bobRequest, "expected a Bob provider request");
      const bobPrompt = messageText(bobRequest);

      assert.match(bobPrompt, /limited narration from Bob's perspective/);
      assert.doesNotMatch(bobPrompt, /limited narration from Alice's perspective/);
      assert.match(bobPrompt, /Bob is a knight\./);
      assert.doesNotMatch(bobPrompt, /Alice is a knight\./);
      assert.match(bobPrompt, /Bob: hello from Bob/);
      assert.doesNotMatch(bobPrompt, /Alice: hello from Bob/);
      assert.match(bobPrompt, /LORE_NAME=Bob/);
      assert.doesNotMatch(bobPrompt, /LORE_NAME=Alice/);

      const savedMessages = await db.select().from(messages);
      const bobMessage = savedMessages.find(
        (message) => message.role === "assistant" && message.characterId === "char-bob",
      );
      assert.ok(bobMessage, "expected Bob's assistant message to be saved");

      providerRequests.length = 0;
      const regenResponse = await app.inject({
        method: "POST",
        url: "/api/generate/",
        payload: {
          chatId: "chat-character-macro",
          connectionId: "conn-character-macro",
          userMessage: null,
          regenerateMessageId: bobMessage.id,
          streaming: false,
        },
      });

      assert.equal(regenResponse.statusCode, 200);
      assert.equal(providerRequests.length, 1);
      const regenPrompt = messageText(providerRequests[0]!);
      assert.match(regenPrompt, /Respond ONLY as Bob\./);
      assert.match(regenPrompt, /limited narration from Bob's perspective/);
      assert.doesNotMatch(regenPrompt, /limited narration from Alice's perspective/);
      assert.match(regenPrompt, /LORE_NAME=Bob/);
      assert.doesNotMatch(regenPrompt, /LORE_NAME=Alice/);
    } finally {
      await app.close();
    }
  } finally {
    client.close();
    await closeServer(providerServer);
  }
});
