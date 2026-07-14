const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const cipherPath = path.resolve(__dirname, '..', 'public', 'js', 'ciphers.js');
assert.ok(fs.existsSync(cipherPath), 'public/js/ciphers.js must exist');

const context = vm.createContext({
    console,
    TextEncoder,
    Uint8Array,
    Uint32Array,
    DataView,
    ArrayBuffer,
    crypto: crypto.webcrypto,
    md5(value) {
        return crypto.createHash('md5').update(String(value)).digest('hex');
    },
});
vm.runInContext(fs.readFileSync(cipherPath, 'utf8'), context);

const vectors = [
    ['aesctr', '12345678', 'e5129a6343f3f9392740c8baa76a98ddd3311734c2'],
    ['chacha20', '12345678', '6fd33c8f2514e4364902bfa79100fffcb366b49182'],
    ['rc4', '12345678', '5f99e17bd941a5b2c0a751675b9e2abb5a2e34c2e9'],
    ['aesctr', '0123456789abcdef0123456789abcdef', '623aa9b420d0c126e77b95755d55ba0f2b73a49fd3'],
    ['chacha20', '0123456789abcdef0123456789abcdef', '411a067f82872bdc4131fbe3d93181c356234ad77e'],
    ['rc4', '0123456789abcdef0123456789abcdef', 'a6950c445718cce266a4d898c44c0f1fb0f04674fb'],
];

function toHex(bytes) {
    return Buffer.from(bytes).toString('hex');
}

async function run() {
    const api = context.EncfileCiphers;
    assert.ok(api, 'EncfileCiphers global must be defined');
    const plaintext = new TextEncoder().encode('encfile-compat-测试');

    for (const [algorithm, password, expected] of vectors) {
        const cipher = await api.create(algorithm, password, plaintext.length);
        const encrypted = await cipher.transform(plaintext, 0);
        assert.strictEqual(toHex(encrypted), expected, `${algorithm} source vector mismatch`);

        const decipher = await api.create(algorithm, password, plaintext.length);
        const decrypted = await decipher.transform(encrypted, 0);
        assert.deepStrictEqual(Buffer.from(decrypted), Buffer.from(plaintext), `${algorithm} round trip failed`);
    }

    const chunkFixture = new Uint8Array(1_000_111);
    for (let index = 0; index < chunkFixture.length; index++) chunkFixture[index] = index & 0xff;
    for (const algorithm of ['aesctr', 'chacha20', 'rc4']) {
        const wholeCipher = await api.create(algorithm, 'chunk-password', chunkFixture.length);
        const whole = await wholeCipher.transform(chunkFixture, 0);

        const chunkCipher = await api.create(algorithm, 'chunk-password', chunkFixture.length);
        const pieces = [];
        for (let offset = 0; offset < chunkFixture.length; offset += 65537) {
            pieces.push(await chunkCipher.transform(chunkFixture.slice(offset, offset + 65537), offset));
        }
        assert.deepStrictEqual(Buffer.concat(pieces.map(Buffer.from)), Buffer.from(whole), `${algorithm} chunk mismatch`);
    }

    const chachaWrapOffset = (0x1_0000_0000 - 1) * 64;
    const wrapCipher = await api.create('chacha20', 'wrap-password', 1);
    const wrapOutput = await wrapCipher.transform(new Uint8Array(16), chachaWrapOffset);
    assert.strictEqual(toHex(wrapOutput), '9916b9fddd7b356337cd17493ac06d27', 'chacha20 counter wrap mismatch');

    assert.deepStrictEqual(
        JSON.parse(JSON.stringify(api.resolveFileAlgorithm('movie.mp4.chacha20', 'aesctr'))),
        { algorithm: 'chacha20', filename: 'movie.mp4', detected: true }
    );
    assert.deepStrictEqual(
        JSON.parse(JSON.stringify(api.resolveFileAlgorithm('movie.mp4', 'rc4'))),
        { algorithm: 'rc4', filename: 'movie.mp4', detected: false }
    );
    assert.deepStrictEqual(
        JSON.parse(JSON.stringify(api.resolveFileAlgorithm('backup.enc', 'chacha20'))),
        { algorithm: 'chacha20', filename: 'backup.enc', detected: false }
    );
    assert.strictEqual(api.encryptedFilename('movie.mp4', 'aesctr'), 'movie.mp4.ctr');
    assert.strictEqual(api.encryptedFilename('movie.mp4', 'chacha20'), 'movie.mp4.chacha20');
    assert.strictEqual(api.encryptedFilename('movie.mp4', 'rc4'), 'movie.mp4.rc4');

    console.log('cipher compatibility vectors, chunking, and suffix rules: PASS');
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
