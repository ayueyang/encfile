(function (global) {
    'use strict';

    const encoder = new TextEncoder();
    const RC4_SEGMENT_SIZE = 1_000_000;
    const CHACHA_COUNTER_RANGE = 0x1_0000_0000;
    const ALGORITHMS = Object.freeze({
        aesctr: Object.freeze({ id: 'aesctr', label: 'AES-CTR', suffix: '.ctr' }),
        chacha20: Object.freeze({ id: 'chacha20', label: 'CHACHA20', suffix: '.chacha20' }),
        rc4: Object.freeze({ id: 'rc4', label: 'RC4（废弃）', suffix: '.rc4', deprecated: true }),
    });
    const SUFFIX_ALIASES = Object.freeze([
        ['.chacha20', 'chacha20'],
        ['.ctr', 'aesctr'],
        ['.rc4', 'rc4'],
    ]);

    function hexToBytes(hex) {
        const result = new Uint8Array(hex.length / 2);
        for (let index = 0; index < hex.length; index += 2) {
            result[index / 2] = parseInt(hex.slice(index, index + 2), 16);
        }
        return result;
    }

    function bytesToHex(bytes) {
        return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    }

    function md5Bytes(value) {
        if (typeof global.md5 !== 'function') throw new Error('MD5 组件加载失败，请刷新页面后重试');
        return hexToBytes(global.md5(String(value)));
    }

    async function digest(name, value) {
        return new Uint8Array(await global.crypto.subtle.digest(name, encoder.encode(String(value))));
    }

    async function derivePassword(password, salt) {
        if (password.length === 32) return password;
        const material = await global.crypto.subtle.importKey(
            'raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
        );
        const bits = await global.crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt: encoder.encode(salt), iterations: 1000, hash: 'SHA-256' },
            material,
            128
        );
        return bytesToHex(new Uint8Array(bits));
    }

    function addCounter(counter, increment) {
        const result = new Uint8Array(counter);
        let carry = increment;
        for (let index = result.length - 1; index >= 0 && carry > 0; index--) {
            const sum = result[index] + (carry % 256);
            result[index] = sum & 0xff;
            carry = Math.floor(carry / 256) + Math.floor(sum / 256);
        }
        return result;
    }

    async function createAesCtr(password, fileSize) {
        const outward = await derivePassword(password, 'AES-CTR');
        const keyBytes = md5Bytes(outward + fileSize);
        const baseCounter = md5Bytes(String(fileSize));
        const key = await global.crypto.subtle.importKey(
            'raw', keyBytes, { name: 'AES-CTR', length: 128 }, false, ['encrypt', 'decrypt']
        );

        return {
            async transform(input, offset) {
                const data = input instanceof Uint8Array ? input : new Uint8Array(input);
                const blockOffset = offset % 16;
                const counter = addCounter(baseCounter, Math.floor(offset / 16));
                let source = data;
                if (blockOffset) {
                    source = new Uint8Array(blockOffset + data.length);
                    source.set(data, blockOffset);
                }
                const output = new Uint8Array(await global.crypto.subtle.encrypt(
                    { name: 'AES-CTR', counter, length: 128 }, key, source
                ));
                return blockOffset ? output.slice(blockOffset) : output;
            }
        };
    }

    function rotateLeft(value, bits) {
        return (value << bits) | (value >>> (32 - bits));
    }

    function quarterRound(state, a, b, c, d) {
        state[a] = (state[a] + state[b]) >>> 0; state[d] = rotateLeft(state[d] ^ state[a], 16);
        state[c] = (state[c] + state[d]) >>> 0; state[b] = rotateLeft(state[b] ^ state[c], 12);
        state[a] = (state[a] + state[b]) >>> 0; state[d] = rotateLeft(state[d] ^ state[a], 8);
        state[c] = (state[c] + state[d]) >>> 0; state[b] = rotateLeft(state[b] ^ state[c], 7);
    }

    function readUint32LE(bytes, offset) {
        return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
    }

    function writeUint32LE(value, bytes, offset) {
        bytes[offset] = value & 0xff;
        bytes[offset + 1] = (value >>> 8) & 0xff;
        bytes[offset + 2] = (value >>> 16) & 0xff;
        bytes[offset + 3] = (value >>> 24) & 0xff;
    }

    function chachaBlock(key, nonce, counter) {
        const state = new Uint32Array(16);
        state.set([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);
        for (let index = 0; index < 8; index++) state[4 + index] = readUint32LE(key, index * 4);
        state[12] = counter >>> 0;
        state[13] = readUint32LE(nonce, 0);
        state[14] = readUint32LE(nonce, 4);
        state[15] = readUint32LE(nonce, 8);
        const working = new Uint32Array(state);
        for (let round = 0; round < 10; round++) {
            quarterRound(working, 0, 4, 8, 12); quarterRound(working, 1, 5, 9, 13);
            quarterRound(working, 2, 6, 10, 14); quarterRound(working, 3, 7, 11, 15);
            quarterRound(working, 0, 5, 10, 15); quarterRound(working, 1, 6, 11, 12);
            quarterRound(working, 2, 7, 8, 13); quarterRound(working, 3, 4, 9, 14);
        }
        const output = new Uint8Array(64);
        for (let index = 0; index < 16; index++) writeUint32LE((working[index] + state[index]) >>> 0, output, index * 4);
        return output;
    }

    async function createChaCha20(password, fileSize) {
        const outward = await derivePassword(password, 'CHA20');
        const key = await digest('SHA-256', outward + fileSize);
        const baseNonce = md5Bytes(String(fileSize)).slice(0, 12);
        return {
            async transform(input, offset) {
                const data = input instanceof Uint8Array ? input : new Uint8Array(input);
                const output = new Uint8Array(data.length);
                let position = 0;
                while (position < data.length) {
                    const absolute = offset + position;
                    const blockIndex = Math.floor(absolute / 64);
                    const blockOffset = absolute % 64;
                    const nonce = new Uint8Array(baseNonce);
                    const carry = Math.floor((blockIndex + 1) / CHACHA_COUNTER_RANGE);
                    if (carry) {
                        const tail = (readUint32LE(nonce, 8) + carry) >>> 0;
                        writeUint32LE(tail, nonce, 8);
                    }
                    const stream = chachaBlock(key, nonce, (blockIndex + 1) >>> 0);
                    const length = Math.min(64 - blockOffset, data.length - position);
                    for (let index = 0; index < length; index++) {
                        output[position + index] = data[position + index] ^ stream[blockOffset + index];
                    }
                    position += length;
                }
                return output;
            }
        };
    }

    function initRc4(key) {
        const state = new Uint8Array(256);
        for (let index = 0; index < 256; index++) state[index] = index;
        for (let index = 0, j = 0; index < 256; index++) {
            j = (j + state[index] + key[index % key.length]) & 0xff;
            const temp = state[index]; state[index] = state[j]; state[j] = temp;
        }
        return state;
    }

    function rc4SegmentKey(baseKey, segmentOffset) {
        const key = new Uint8Array(baseKey);
        const view = new DataView(new ArrayBuffer(4));
        view.setInt32(0, segmentOffset, false);
        for (let index = 0; index < 4; index++) key[key.length - 4 + index] ^= view.getUint8(index);
        return key;
    }

    function rc4TransformSegment(baseKey, data, relativeOffset, segmentOffset) {
        const state = initRc4(rc4SegmentKey(baseKey, segmentOffset));
        let i = 0;
        let j = 0;
        const end = relativeOffset + data.length;
        const output = new Uint8Array(data.length);
        for (let position = 0; position < end; position++) {
            i = (i + 1) & 0xff;
            j = (j + state[i]) & 0xff;
            const temp = state[i]; state[i] = state[j]; state[j] = temp;
            const streamByte = state[(state[i] + state[j]) & 0xff];
            if (position >= relativeOffset) output[position - relativeOffset] = data[position - relativeOffset] ^ streamByte;
        }
        return output;
    }

    async function createRc4(password, fileSize) {
        const outward = await derivePassword(password, 'RC4');
        const baseKey = md5Bytes(outward + fileSize);
        return {
            async transform(input, offset) {
                const data = input instanceof Uint8Array ? input : new Uint8Array(input);
                const output = new Uint8Array(data.length);
                let processed = 0;
                while (processed < data.length) {
                    const absolute = offset + processed;
                    const segmentOffset = Math.floor(absolute / RC4_SEGMENT_SIZE) * RC4_SEGMENT_SIZE;
                    const relativeOffset = absolute - segmentOffset;
                    const length = Math.min(RC4_SEGMENT_SIZE - relativeOffset, data.length - processed);
                    const transformed = rc4TransformSegment(
                        baseKey, data.slice(processed, processed + length), relativeOffset, segmentOffset
                    );
                    output.set(transformed, processed);
                    processed += length;
                }
                return output;
            }
        };
    }

    async function create(algorithm, password, fileSize) {
        if (!ALGORITHMS[algorithm]) throw new Error('不支持的加密算法');
        if (algorithm === 'aesctr') return createAesCtr(password, fileSize);
        if (algorithm === 'chacha20') return createChaCha20(password, fileSize);
        return createRc4(password, fileSize);
    }

    function resolveFileAlgorithm(filename, fallbackAlgorithm) {
        const lower = filename.toLowerCase();
        for (const [suffix, algorithm] of SUFFIX_ALIASES) {
            if (lower.endsWith(suffix) && filename.length > suffix.length) {
                return { algorithm, filename: filename.slice(0, -suffix.length), detected: true };
            }
        }
        return { algorithm: fallbackAlgorithm, filename, detected: false };
    }

    function encryptedFilename(filename, algorithm) {
        return filename + ALGORITHMS[algorithm].suffix;
    }

    global.EncfileCiphers = Object.freeze({
        algorithms: ALGORITHMS,
        create,
        encryptedFilename,
        resolveFileAlgorithm,
    });
})(globalThis);
