import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { describe, it } from 'node:test';

const heroes = JSON.parse(readFileSync('backend/specter_arena/specters/heroes.json', 'utf8')).heroes;
const index = JSON.parse(readFileSync('avatar-packs/index.json', 'utf8'));
const readme = readFileSync('avatar-packs/README.md', 'utf8');
const provenance = readFileSync('docs/provenance.md', 'utf8');
const STATES = ['idle.svg', 'working.svg', 'done.svg', 'error.svg'];
const DATA_URI = /data:image\/png;base64,([A-Za-z0-9+/=]+)/g;

/** @param {string} id @returns {any} */
const readPack = (id) => JSON.parse(readFileSync(`avatar-packs/packs/specters-${id}.pack.json`, 'utf8'));

/** @param {Buffer} data @returns {string} the id `git hash-object` gives a file with this content */
const gitBlobSha = (data) => createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');

describe('avatar packs match the roster', () => {
  it('has one pack per hero and nothing else', () => {
    assert.equal(heroes.length, 11);
    assert.equal(index.packCount, heroes.length);
    assert.deepEqual(
      index.packs.map((/** @type {{ id: string }} */ pack) => pack.id).sort(),
      heroes.map((/** @type {{ id: string }} */ hero) => `specters-${hero.id}`).sort(),
    );
  });

  for (const hero of heroes) {
    describe(hero.id, () => {
      const pack = readPack(hero.id);
      const entry = index.packs.find((/** @type {{ id: string }} */ item) => item.id === `specters-${hero.id}`);
      const artPath = `backend/specter_arena/specters/art/${hero.portraitSlug}.png`;
      const art = readFileSync(artPath);

      it('is named exactly as heroes.json names the hero', () => {
        const displayName = `${hero.name} — Specters of the Abyss`;
        assert.equal(pack.manifest.meta.name, displayName);
        assert.equal(entry.name, displayName);
        assert.ok(readme.includes(`- **${hero.name}** — [\`packs/specters-${hero.id}.pack.json\`]`), `README link for ${hero.name}`);
        assert.ok(readme.includes(`- **${hero.name}:**`), `README motion theme for ${hero.name}`);
      });

      it('has matching envelope ids and the four state files', () => {
        assert.equal(pack.kind, 'crew-companion-pack');
        assert.equal(pack.id, `specters-${hero.id}`);
        assert.equal(pack.manifest.meta.id, pack.id);
        assert.deepEqual(Object.keys(pack.files).sort(), [...STATES].sort());
        assert.equal(entry.file, `packs/specters-${hero.id}.pack.json`);
      });

      it('embeds the committed portrait byte for byte in every state', () => {
        for (const state of STATES) {
          const svg = pack.files[state];
          const embedded = [...svg.matchAll(DATA_URI)].map((match) => Buffer.from(match[1], 'base64'));
          assert.equal(embedded.length, 1, `${state}: exactly one embedded PNG`);
          assert.ok(embedded[0]?.equals(art), `${state}: embedded PNG differs from ${artPath}; changing the art needs a new pack id and a provenance row`);
        }
      });

      it('records the source blob of the committed portrait', () => {
        const sha = gitBlobSha(art);
        assert.equal(entry.sourcePath, artPath);
        assert.equal(entry.sourceBlobSha, sha);
        assert.equal(pack.provenance.sourcePath, artPath);
        assert.equal(pack.provenance.sourceBlobSha, sha);
        assert.ok(provenance.includes(sha), `docs/provenance.md names blob ${sha}`);
      });

      it('has an index size equal to the file size and carries no scripts or remote references', () => {
        assert.equal(entry.bytes, statSync(`avatar-packs/packs/specters-${hero.id}.pack.json`).size);
        for (const state of STATES) {
          const svg = pack.files[state];
          assert.doesNotMatch(svg, /<script|javascript:|\son[a-z]+=|(?:href|src)\s*=\s*["']https?:/i, state);
        }
      });
    });
  }
});
