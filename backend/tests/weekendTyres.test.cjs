const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reconstructTyres } = require('../dist/calculations/weekendTyres.js');
const run = (start, startAge, laps, compound = 'MEDIUM') => ({session:'FP2', sessionKey:1, stint:start, start, startAge, laps, compound});
test('ties select least recently used; preserve alternatives and mileage', () => {
 const result = reconstructTyres([run(3,12,5),run(1,0,12),run(2,0,12)]);
 const m1=result.sets.find(s=>s.id==='M1'),m2=result.sets.find(s=>s.id==='M2');
 assert.equal(m1.age,17);assert.equal(m2.age,12);
 assert.deepEqual(m1.history[1].alternatives,['M2']);
 assert.equal(m1.history[1].reason,'Least recently used matching set');
});
test('rotation updates after reuse',()=>{
 const result=reconstructTyres([run(1,0,12),run(2,0,12),run(3,12,0),run(4,12,5)]);
 assert.equal(result.sets.find(s=>s.id==='M2').age,17);
});
test('unknown starting age is never zero or forced reuse',()=>{
 const result=reconstructTyres([run(1,0,12),run(2,null,4)]);
 assert.equal(result.sets.find(s=>s.id==='M1').age,12);
 assert.equal(result.sets.find(s=>s.id==='M2').age,null);
 assert.equal(result.sets.find(s=>s.id==='M2').history[0].laps,4);
});
test('no matches do not overwrite higher mileage; compound identities are separate',()=>{
 const result=reconstructTyres([run(1,0,17),run(2,12,5),run(3,0,3,'SOFT')]);
 assert.equal(result.sets.find(s=>s.id==='M1').history.length,1);
 assert.equal(result.sets.find(s=>s.id==='M2').age,17);
 assert.equal(result.sets.find(s=>s.id==='S1').age,3);
});
test('unused allocation stays unknown; excess observations are flagged',()=>{
 const result=reconstructTyres([run(1,0,1,'HARD'),run(2,0,1,'HARD'),run(3,0,1,'HARD')]);
 assert.equal(result.sets.find(s=>s.id==='H3').extra,true);
 assert.equal(result.sets.find(s=>s.id==='S1').age,null);
 assert.equal(reconstructTyres([],true).sets.filter(s=>s.compound==='SOFT').length,6);
});
