(function (global) {
    'use strict';

    const DEFAULT_CHUNK_SIZE = 64 * 1024;

    function volumeFilename(filename, index, final) {
        return final ? `${filename}.zip` : `${filename}.z${String(index).padStart(2, '0')}`;
    }

    async function create(options) {
        if (!global.zip) throw new Error('ZIP 组件加载失败，请刷新页面后重试');

        const {
            filename,
            readChunk,
            onVolume,
            onProgress,
        } = options;
        const size = Number(options.size);
        const volumeSize = Number(options.volumeSize);
        const chunkSize = Math.min(Number(options.chunkSize) || DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_SIZE, volumeSize);

        if (!filename) throw new Error('ZIP 文件名不能为空');
        if (!Number.isSafeInteger(size) || size < 0) throw new Error('文件大小无效');
        if (!Number.isSafeInteger(volumeSize) || volumeSize <= 0) throw new Error('分卷大小无效');
        if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) throw new Error('读取块大小无效');
        if (typeof readChunk !== 'function') throw new Error('缺少分块读取函数');
        if (typeof onVolume !== 'function') throw new Error('缺少分卷输出函数');

        let inputOffset = 0;
        let activeWriter = null;
        let volumeCount = 0;
        let totalOutputSize = 0;

        const readable = new ReadableStream({
            async pull(controller) {
                if (inputOffset >= size) {
                    controller.close();
                    return;
                }

                const requestedLength = Math.min(chunkSize, size - inputOffset);
                const chunk = await readChunk(inputOffset, requestedLength);
                const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
                if (!bytes.length || bytes.length > requestedLength) {
                    throw new Error('分块读取返回了无效长度');
                }

                controller.enqueue(bytes);
                inputOffset += bytes.length;
                if (onProgress) await onProgress(inputOffset, size);
            }
        });

        async function emitActiveWriter(final) {
            if (!activeWriter) return;
            const blob = await activeWriter.getData();
            activeWriter = null;
            volumeCount++;
            totalOutputSize += blob.size;
            await onVolume({
                index: volumeCount,
                final,
                filename: volumeFilename(filename, volumeCount, final),
                blob,
            });
        }

        async function* writerGenerator() {
            while (true) {
                await emitActiveWriter(false);
                activeWriter = new global.zip.BlobWriter('application/octet-stream');
                yield activeWriter;
            }
        }

        try {
            const splitWriter = new global.zip.SplitDataWriter(writerGenerator(), volumeSize);
            const zipWriter = new global.zip.ZipWriter(splitWriter, {
                supportZip64SplitFile: false,
            });

            await zipWriter.add(filename, { readable, size }, {
                level: 0,
                dataDescriptor: true,
                dataDescriptorSignature: true,
                useWebWorkers: false,
            });
            await zipWriter.close();
            await emitActiveWriter(true);
        } finally {
            activeWriter = null;
        }

        return { volumeCount, totalOutputSize };
    }

    global.EncfileSplitZip = Object.freeze({ create, volumeFilename });
})(globalThis);
