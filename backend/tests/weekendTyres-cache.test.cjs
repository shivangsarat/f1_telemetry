const { test } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { getWeekendTyres } = require('../dist/services/dataService');
test('four devices/drivers share upstream session fetches, including empty results', async () => {
 const original = axios.get;
 const calls=[];
 const session={session_key:998877,meeting_key:998877,session_name:'Practice 2',date_start:new Date(Date.now()-60000).toISOString(),date_end:new Date(Date.now()+60000).toISOString()};
 axios.get=async url=>{calls.push(url);return {data:url.includes('/sessions?')?[session]:[]};};
 try {
  await Promise.all([44,12,44,12].map(driver=>getWeekendTyres(998877,driver,Date.now())));
  await getWeekendTyres(998877,44,Date.now());
  assert.equal(calls.filter(url=>url.includes('/stints?')).length,1);
  assert.equal(calls.filter(url=>url.includes('/laps?')).length,1);
  assert.ok(calls.every(url=>!url.includes('driver_number=')));
 } finally {axios.get=original;}
});
