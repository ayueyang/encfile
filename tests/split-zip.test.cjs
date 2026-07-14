const assert = require('assert');
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const cipherPath = path.join(root, 'public', 'js', 'ciphers.js');
const zipCorePath = path.join(root, 'public', 'vendor', 'zip-core.min.js');
const splitZipPath = path.join(root, 'public', 'js', 'split-zip.js');
for (const file of [cipherPath, zipCorePath, splitZipPath]) assert.ok(fs.existsSync(file), `${file} must exist`);

function find7Zip() {
    const candidates = [
        'C:\\Program Files\\7-Zip\\7z.exe',
        'C:\\Program Files (x86)\\7-Zip\\7z.exe',
        '7z',
        '7za',
    ];
    for (const candidate of candidates) {
        const result = childProcess.spawnSync(candidate, [], { encoding: 'utf8' });
        if (!result.error || result.error.code !== 'ENOENT') return candidate;
    }
    throw new Error('7-Zip is required for the split archive regression');
}

function fixture(size, seed = 7) {
    const bytes = new Uint8Array(size);
    for (let index = 0; index < bytes.length; index++) bytes[index] = (index * 31 + seed) & 0xff;
    return bytes;
}

async function run() {
    const context = vm.createContext({
        console,
        Blob,
        Uint8Array,
        Uint16Array,
        Uint32Array,
        ArrayBuffer,
        DataView,
        TextEncoder,
        TextDecoder,
        ReadableStream,
        WritableStream,
        TransformStream,
        Response,
        URL,
        crypto: crypto.webcrypto,
        navigator: { hardwareConcurrency: 2 },
        md5(value) {
            return crypto.createHash('md5').update(String(value)).digest('hex');
        },
        setTimeout,
        clearTimeout,
    });
    vm.runInContext(fs.readFileSync(zipCorePath, 'utf8'), context);
    vm.runInContext(fs.readFileSync(splitZipPath, 'utf8'), context);
    vm.runInContext(fs.readFileSync(cipherPath, 'utf8'), context);

    const splitApi = context.EncfileSplitZip;
    const cipherApi = context.EncfileCiphers;
    assert.ok(splitApi, 'EncfileSplitZip global must be defined');
    assert.ok(cipherApi, 'EncfileCiphers global must be defined');
    const sevenZip = find7Zip();
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'encfile-split-'));

    async function createExtractAndVerify({ caseName, filename, input, volumeSize, readChunk }) {
        const caseDir = path.join(tempRoot, caseName);
        const extractDir = path.join(caseDir, 'out');
        fs.mkdirSync(extractDir, { recursive: true });
        const reads = [];
        const volumes = [];
        const result = await splitApi.create({
            filename,
            size: input.length,
            volumeSize,
            chunkSize: 64 * 1024,
            async readChunk(offset, length) {
                reads.push({ offset, length });
                return readChunk(offset, length);
            },
            async onVolume(volume) {
                const bytes = new Uint8Array(await volume.blob.arrayBuffer());
                fs.writeFileSync(path.join(caseDir, volume.filename), bytes);
                volumes.push({ filename: volume.filename, size: bytes.length, final: volume.final });
            },
        });

        assert.strictEqual(result.volumeCount, volumes.length);
        assert.strictEqual(volumes.at(-1).final, true);
        assert.ok(reads.every(read => read.length > 0 && read.length <= 64 * 1024));
        for (let index = 1; index < reads.length; index++) {
            assert.strictEqual(reads[index].offset, reads[index - 1].offset + reads[index - 1].length);
        }

        const archive = path.join(caseDir, `${filename}.zip`);
        const extraction = childProcess.spawnSync(sevenZip, ['x', '-y', `-o${extractDir}`, archive], { encoding: 'utf8' });
        assert.strictEqual(extraction.status, 0, `${extraction.stdout}\n${extraction.stderr}`);
        const restored = fs.readFileSync(path.join(extractDir, filename));
        assert.deepStrictEqual(restored, Buffer.from(input), `${caseName} restored data differs from source`);
        return { reads, volumes };
    }

    try {
        const input = fixture(400_123);
        for (const algorithm of ['aesctr', 'chacha20', 'rc4']) {
            const password = `${algorithm}-password`;
            const encryptor = await cipherApi.create(algorithm, password, input.length);
            const encrypted = await encryptor.transform(input, 0);
            const decryptor = await cipherApi.create(algorithm, password, input.length);
            const result = await createExtractAndVerify({
                caseName: algorithm,
                filename: `${algorithm}-fixture.bin`,
                input,
                volumeSize: 128 * 1024,
                readChunk(offset, length) {
                    return decryptor.transform(encrypted.slice(offset, offset + length), offset);
                },
            });
            assert.ok(result.volumes.length >= 4, `${algorithm} must generate multiple volumes`);
        }

        const empty = await createExtractAndVerify({
            caseName: 'empty-unicode',
            filename: '空文件 测试.txt',
            input: new Uint8Array(),
            volumeSize: 1024,
            readChunk() {
                throw new Error('empty input must not be read');
            },
        });
        assert.deepStrictEqual(empty.volumes.map(volume => volume.filename), ['空文件 测试.txt.zip']);

        const manyInput = fixture(130_123, 19);
        const many = await createExtractAndVerify({
            caseName: 'many-volumes',
            filename: 'many.bin',
            input: manyInput,
            volumeSize: 1024,
            readChunk(offset, length) {
                return manyInput.slice(offset, offset + length);
            },
        });
        assert.ok(many.volumes.length > 100, 'fixture must exercise volume numbers above 99');

        await assert.rejects(
            splitApi.create({
                filename: 'cancel.bin',
                size: 4096,
                volumeSize: 1024,
                readChunk(offset, length) {
                    return fixture(length, offset & 0xff);
                },
                async onVolume() {
                    throw new Error('output cancelled');
                },
            }),
            /output cancelled/
        );

        console.log('split ZIP three-cipher extraction, bounded reads, Unicode, empty, and 100+ volumes: PASS');
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
