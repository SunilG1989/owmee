#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../src/navigation/addressGate.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: sourcePath,
});

const testModule = { exports: {} };
const requireFromSource = Module.createRequire(sourcePath);
const compiled = vm.runInThisContext(Module.wrap(outputText), { filename: sourcePath });
compiled(
  testModule.exports,
  requireFromSource,
  testModule,
  sourcePath,
  path.dirname(sourcePath),
);

const { ADDRESS_GATE_RETRY_DELAYS_MS, resolveAddressGate } = testModule.exports;

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('keeps retry delays short and bounded', () => {
  assert.deepEqual(ADDRESS_GATE_RETRY_DELAYS_MS, [500, 1200]);
});

test('clears the cached address list before reading addresses', async () => {
  const calls = [];
  const decision = await resolveAddressGate({
    clearAddressCache: () => calls.push('clear'),
    listAddresses: async () => {
      calls.push('list');
      return { data: [] };
    },
  });

  assert.equal(decision, 'needs_address');
  assert.deepEqual(calls, ['clear', 'list']);
});

test('requires address capture for new users with no saved addresses', async () => {
  const decision = await resolveAddressGate({
    listAddresses: async () => ({ data: [] }),
  });

  assert.equal(decision, 'needs_address');
});

test('allows returning users with at least one saved address', async () => {
  const decision = await resolveAddressGate({
    listAddresses: async () => ({ data: [{ id: 'addr_1' }] }),
  });

  assert.equal(decision, 'has_address');
});

test('rejects malformed address responses so the caller can retry', async () => {
  await assert.rejects(
    () => resolveAddressGate({ listAddresses: async () => ({ data: null }) }),
    /ADDRESS_GATE_BAD_RESPONSE/,
  );
});

test('propagates backend failures so the caller can retry or show recovery', async () => {
  await assert.rejects(
    () => resolveAddressGate({
      listAddresses: async () => {
        throw new Error('network down');
      },
    }),
    /network down/,
  );
});

(async () => {
  for (const { name, fn } of tests) {
    await fn();
    console.log(`ok - ${name}`);
  }
  console.log(`${tests.length} address-gate tests passed`);
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
