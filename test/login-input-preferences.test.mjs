import test from 'node:test';
import assert from 'node:assert/strict';
import {preferredLoginMethod, shouldBrowseInputHistory} from '../public/ui-model.js';

test('initial login preference follows device and explicit history overrides it',()=>{
 assert.equal(preferredLoginMethod({touchInput:true,passkeyAvailable:true}),'passkey');
 assert.equal(preferredLoginMethod({touchInput:false,passkeyAvailable:true}),'password');
 assert.equal(preferredLoginMethod({lastMethod:'password',touchInput:true,passkeyAvailable:true}),'password');
 assert.equal(preferredLoginMethod({lastMethod:'passkey',touchInput:false,passkeyAvailable:true}),'passkey');
 assert.equal(preferredLoginMethod({lastMethod:'passkey',passkeyAvailable:false}),'password');
});

test('history only intercepts unselected text at absolute input boundaries',()=>{
 const value='first line\nsecond line\nthird line';
 for(const key of ['ArrowUp','ArrowDown']){
  assert.equal(shouldBrowseInputHistory({key,value,selectionStart:15,selectionEnd:15}),false);
  assert.equal(shouldBrowseInputHistory({key,value,selectionStart:0,selectionEnd:value.length}),false);
 }
 assert.equal(shouldBrowseInputHistory({key:'ArrowUp',value,selectionStart:0,selectionEnd:0}),true);
 assert.equal(shouldBrowseInputHistory({key:'ArrowDown',value,selectionStart:value.length,selectionEnd:value.length}),true);
 assert.equal(shouldBrowseInputHistory({key:'ArrowUp',value:'',selectionStart:0,selectionEnd:0}),true);
});
