'use strict';

const fs = require('fs');
const path = require('path');
const { launchHeadlessChrome, openPage } = require('../../src/media/headless-chrome-cdp');

const LT_DIR = path.join(__dirname, '..', '..', 'template', 'lower-thirds');
const THUMB_DIR = path.join(LT_DIR, 'thumbnails');

if (!fs.existsSync(THUMB_DIR)) {
    fs.mkdirSync(THUMB_DIR, { recursive: true });
}

const templates = [
    'lt-classic-box',
    'lt-slide-bar',
    'lt-minimal-fade',
    'lt-split-color',
    'lt-frosted-glass',
    'lt-underline-reveal',
    'lt-tag-badge',
    'lt-gradient-wave',
    'lt-corner-bracket'
];

async function generateThumbnails() {
    console.log('Generating lower-third thumbnails...');
    const chrome = await launchHeadlessChrome();
    try {
        const page = await openPage(chrome.httpPort, { width: 1920, height: 1080 });

        for (const template of templates) {
            console.log(`Processing ${template}...`);
            const fileUrl = `file://${path.join(LT_DIR, template + '.html')}`;

            await page.navigate(fileUrl, { timeoutMs: 30000 });

            // Evaluate code in the context of the page to load data and play
            await page.evaluate(() => {
                window.update({
                    data: { title: "Alex Rivera", subtitle: "Lead Designer" },
                    style: {
                        primaryColor: "#00bcd4",
                        textColor: "#ffffff",
                        speed: 100 // Super fast animation
                    }
                });
                window.play();
            });

            // Wait a short moment for the super-fast animation to finish
            await new Promise(r => setTimeout(r, 200));

            const savePath = path.join(THUMB_DIR, `${template}.png`);
            const png = await page.screenshot({});
            fs.writeFileSync(savePath, png);
            console.log(`Saved ${savePath}`);
        }

        await page.close().catch(() => {});
    } finally {
        chrome.kill();
    }
    console.log('Thumbnail generation complete.');
}

generateThumbnails().catch(console.error);
