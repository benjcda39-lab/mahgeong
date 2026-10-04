import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { boardKey } from '../../lan/leaderboard.mjs';
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const pure = html.match(/<script>([\s\S]*)<\/script>\s*$/)[1].split('// ---------- state ----------')[0];
const sandbox = vm.createContext({document: {addEventListener() {}}, window: {innerWidth: 1280}, localStorage: {getItem: () => null}});
const rules = vm.runInContext(pure + ';({decks:DECKS,DATA,STATES,LOCAL_FLAGS,BY_CODE,capacity,makeTiles,practiceFlagKey})', sandbox);
for (const [deck, expected] of [['unleashed',257], ['subdivisions',261]]) {
  test(`${deck}: unique IDs, full roster and local assets`, () => {
    const pool = rules.decks[deck].pool('all');
    assert.equal(pool.length, expected);
    assert.equal(new Set(pool.map(c => c[0])).size, expected);
    assert.deepEqual(Array.from(rules.decks[deck].kinds), ['flag', 'capital']);
    for (const c of pool) {
      const path = rules.LOCAL_FLAGS[c[0]] || (c[0] === 'NP' ? 'flags/np.svg' : c[0].startsWith('us-') ? `flags/${c[0]}.png` : `flags/extra/world-${c[0].toLowerCase()}.svg`);
      assert.ok(existsSync(new URL('../../' + path, import.meta.url)), c[1]);
      assert.equal(rules.BY_CODE[c[0]][1], c[1]);
    }
  });
  test(`${deck}: all board sizes and deals deduplicate designs and separate scores`, () => {
    const pool = rules.decks[deck].pool('all');
    for (const size of [12,18,24,30]) for (const deal of ['fair','classic']) {
      for (let i=0;i<30;i++) {
        const tiles=rules.makeTiles('flag',size,deal,pool,['flag', 'capital']);
        assert.equal(tiles.length,size*2);
        const codes=[...new Set(tiles.map(t=>t.code))];
        assert.equal(new Set(codes.map(c=>rules.practiceFlagKey(rules.BY_CODE[c],'flag',pool))).size,size);
      }
      assert.equal(boardKey({kind:'practice',deck,region:'all',mode:'flag',size,deal},rules), `practice:${deck}:all:flag:${size}:${deal}`);
    }
    assert.equal(boardKey({kind:'practice',deck,region:'europe',mode:'flag',size:12,deal:'fair'},rules),null);
  });
}
test('Subdivisions includes every existing US state without replacing the US states deck',()=> {
  const pool=rules.decks.subdivisions.pool('all');
  assert.equal(rules.decks.states.pool('all').length,50);
  for(const s of rules.STATES) assert.ok(pool.some(c=>c[0]===s[0]));
});

test('new Capitals and Mix modes never deal capital-less entries',()=>{for(const deck of ['unleashed','subdivisions'])for(const mode of ['capital','mix'])for(const size of [12,18,24,30])for(const deal of ['fair','classic']){const tiles=rules.makeTiles(mode,size,deal,rules.decks[deck].pool('all'),['flag','capital']);assert.equal(tiles.length,size*2);for(const t of tiles)assert.ok(rules.BY_CODE[t.code][2],t.code);}});
