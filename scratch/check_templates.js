
const fs = require('fs');
const path = require('path');

// Mock a simple check for templates in the running system if possible
// But we can't easily access the running process state.
// Let's check the templates directory contents and see if anything looks wrong.

const templateDir = '/home/casparcg/highascg/template';
if (fs.existsSync(templateDir)) {
    console.log('Template directory exists:', templateDir);
    const files = fs.readdirSync(templateDir);
    console.log('Files:', files);
} else {
    console.log('Template directory MISSING:', templateDir);
}

const templatesDir = '/home/casparcg/highascg/templates';
if (fs.existsSync(templatesDir)) {
    console.log('Templates directory exists:', templatesDir);
    const files = fs.readdirSync(templatesDir);
    console.log('Files:', files);
} else {
    console.log('Templates directory MISSING:', templatesDir);
}
