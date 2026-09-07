import test from 'node:test';
import assert from 'node:assert/strict';
import { combinedTerminalKey, keyboardTerminalKey, isTerminalKey } from '../public/key-combinations.js';
import { HerdrClient, InputValidationError } from '../src/herdr-client.mjs';

test('combines screen modifiers with keyboard modifiers once', () => {
  assert.equal(combinedTerminalKey('end', ['ctrl']), 'ctrl+end');
  assert.equal(keyboardTerminalKey({key:'C',ctrlKey:true,shiftKey:true}, ['ctrl','alt']), 'ctrl+alt+shift+c');
  assert.equal(keyboardTerminalKey({key:'PageDown'}, ['ctrl']), 'ctrl+pagedown');
  assert.equal(keyboardTerminalKey({key:'Tab'}, ['shift']), 'shift+tab');
  assert.equal(keyboardTerminalKey({key:'Control'}, ['ctrl']), null);
  assert.equal(keyboardTerminalKey({key:'c',isComposing:true}, ['ctrl']), null);
  assert.equal(keyboardTerminalKey({key:'c',metaKey:true}, ['ctrl']), 'ctrl+meta+c');
});

test('validates chords before forwarding one CLI argument per key', async () => {
  const calls=[];
  const client=new HerdrClient({runner:async (_bin,args)=>{calls.push(args);return {stdout:''};}});
  const keys=['ctrl+c','shift+tab','alt+x','ctrl+alt+x','up','down','esc','f12'];
  await client.sendKeys('w1:p1',keys);
  assert.deepEqual(calls[0].slice(-keys.length),keys);
  for(const key of ['ctrl+','ctrl+c\n','--help','', 'ctrl+\u0000']) {
    assert.equal(isTerminalKey(key),false);
    await assert.rejects(()=>client.sendKeys('w1:p1',[key]),InputValidationError);
  }
  assert.equal(calls.length,1);
});

test('sends Home End and paging chords as terminal sequences for Herdr 0.8.2', async () => {
  const calls=[];
  const client=new HerdrClient({runner:async (_bin,args)=>{calls.push(args);return {stdout:''};}});
  await client.sendKeys('w1:p1',['home','ctrl+end','pageup','shift+pagedown']);
  assert.deepEqual(calls, [
    ['pane','send-text','w1:p1','\x1b[H\x1b[1;5F\x1b[5~\x1b[6;2~'],
  ]);
});


test('preserves the order of native and encoded keys', async () => {
  const calls=[];
  const client=new HerdrClient({runner:async (_bin,args)=>{calls.push(args);return {stdout:''};}});
  await client.sendKeys('w1:p1',['ctrl+c','ctrl+alt+delete','-','enter']);
  assert.deepEqual(calls, [
    ['pane','send-keys','w1:p1','ctrl+c'],
    ['pane','send-text','w1:p1','\x1b[3;7~'],
    ['pane','send-keys','w1:p1','minus','enter'],
  ]);
});


test('forwards unknown key names and symbols without predicting support', async () => {
  const calls=[];
  const client=new HerdrClient({runner:async (_bin,args)=>{calls.push(args);return {stdout:''};}});
  assert.equal(keyboardTerminalKey({key:'?'},['ctrl']), 'ctrl+?');
  assert.equal(keyboardTerminalKey({key:'+'},['ctrl']), 'ctrl+plus');
  const keys=['ctrl+unknown','alt+?','ctrl+%','meta+end','constructor'];
  await client.sendKeys('w1:p1',keys);
  assert.deepEqual(calls[0],['pane','send-keys','w1:p1',...keys]);
});
