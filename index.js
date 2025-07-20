
const fs = require('fs');
const mime = require('mime-types');
const sharp = require('sharp');
const path = require('path');
const colors = require('colors');
const chokidar = require('chokidar');

function trimTrailingSlashes(path) {
    return path.replace(/[\/\\]+$/, '');
}

function isImage(filePath) {
    const mimeType = mime.lookup(filePath);
    return mimeType && mimeType.startsWith('image/');
}

function getMapping(config, filename) {
    for (map of config.mapping) {
        if (filename.includes(map.source)) {
            return map;
        }
    }

    return null;
}
async function resizeAndCopyImage(source, dest, maxWidth) {
    await sharp(source)
        .resize(maxWidth, maxWidth)
        .png()
        .toFile(dest);
}

async function readOrCreateImage(filePath, size = 512) {
    try {
        fs.accessSync(filePath, fs.constants.R_OK | fs.constants.W_OK);

        return await sharp(filePath).resize(size, size);
    } catch (err) {
        if (err.code === 'ENOENT') {
            await sharp({
                create: {
                    width: size,
                    height: size,
                    channels: 3,
                    background: { r: 0, g: 0, b: 0 }
                }
            }).toFile(filePath);

            return await sharp(filePath);
        } else {
            throw err;
        }
    }
}

async function copyImageToChannel(source, dest, maxSize, channel) {

    if (channel < 0 || channel > 3) {
        return;
    }

    await readOrCreateImage(dest, maxSize);

    const destBuffer = await sharp(dest)
        .resize(maxSize, maxSize)
        .raw()
        .toBuffer({ resolveWithObject: true });

    const sourceBuffer = await sharp(source)
        .resize(maxSize, maxSize)
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const rgbBuffer = Buffer.alloc(maxSize * maxSize * 3);
    for (let i = 0; i < maxSize * maxSize; i++) {
        destBuffer.data[i * 3 + channel] = sourceBuffer.data[i];
    }

    const tempFile = 'temporary.' + crypto.randomUUID();
    await sharp(destBuffer.data, {
        raw: {
            width: maxSize,
            height: maxSize,
            channels: 3
        }
    })
        .png()
        .toFile(tempFile)
        .then(() => {
            fs.renameSync(tempFile, dest);
        })
        .catch(err => {
            console.error('Error:', err);
        });
}

async function processFiles(files, configData, materialFolder) {
    for (file of files) {
        if (isImage(file)) {
            const mapping = getMapping(configData, file);
            if (mapping) {
                const sourceFile = path.resolve(path.join(
                    path.normalize(trimTrailingSlashes(configData.sourcePath)),
                    materialFolder,
                    file
                ));
                const destFile = path.resolve(path.join(
                    path.normalize(trimTrailingSlashes(configData.destPath)),
                    materialFolder,
                    mapping.dest + ".png"
                ));

                if (mapping.channel != undefined) {
                    await copyImageToChannel(sourceFile, destFile, mapping.size, mapping.channel);
                    console.log(" ", sourceFile, "[", mapping.channel.toString().white, "]", " => ".yellow, mapping.dest.yellow);
                } else {
                    await resizeAndCopyImage(sourceFile, destFile, mapping.size);
                    console.log(" ", sourceFile, " => ".yellow, mapping.dest.yellow);
                }
            }
        }
    }
}

async function processFolder(folder, configData) {
    const sourcePath = path.resolve(path.normalize(configData.sourcePath));
    const destPath = path.resolve(path.normalize(configData.destPath));

    const folderPath = path.join(sourcePath, folder);

    fs.mkdirSync(path.join(destPath, folder), { recursive: true });

    const files = fs.readdirSync(folderPath);
    try {
        console.log("Process folder: ".green, folder.yellow);

        await processFiles(files, configData, folder);
    } catch (err) {
        console.error('Error reading directory:', err);
    }
}

async function process(configData) {
    const sourcePath = path.resolve(path.normalize(configData.sourcePath));

    const files = fs.readdirSync(sourcePath);
    for (folder of files) {
        const folderPath = path.join(sourcePath, folder);
        if (fs.statSync(folderPath).isDirectory()) {
            await processFolder(folder, configData);
        }
    }
}

async function onFileChange(configData, filePath) {
    const materialFolder = path.basename(path.dirname(filePath));
    const filename = path.basename(filePath);
    await processFiles(
        [filename],
        configData,
        materialFolder
    );
}

async function onFileRemoved(configData, filePath) {
    const materialFolder = path.basename(path.dirname(filePath));
    await processFolder(materialFolder, configData);
}

try {
    const configPath = './config.json';

    const data = fs.readFileSync(configPath, 'utf8');
    const configData = JSON.parse(data);

    process(configData);

    const sourcePath = path.resolve(path.normalize(configData.sourcePath));

    const watcher = chokidar.watch(sourcePath, {
        ignored: /(^|[\/\\])\../, // ignore dotfiles
        persistent: true,
        ignoreInitial: true,
        depth: Infinity,
        awaitWriteFinish: {
            stabilityThreshold: 1000,
            pollInterval: 100
        },
        alwaysStat: true  
    });

    watcher
        .on('add', path => onFileChange(configData, path))
        .on('change', path => onFileChange(configData, path))
        .on('unlink', path => onFileRemoved(configData, path));
    // .on('addDir', path => console.log(`Directory added: ${path}`))
    // .on('unlinkDir', path => console.log(`Directory removed: ${path}`));

} catch (err) {
    console.error('Error reading directory:', err);
}
